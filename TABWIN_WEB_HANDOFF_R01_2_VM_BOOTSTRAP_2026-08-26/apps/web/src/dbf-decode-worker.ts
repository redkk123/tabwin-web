import {
  dbcToDbf,
  readDbcMetadata,
  readDbfHeader,
  readDbfRecords,
  type DbfHeader,
  type DbfRecord,
} from '@precisa-saude/datasus-dbc';
import { assertMaterializedDbfFits, MAX_MATERIALIZED_DBF_BYTES } from '../../../packages/acquisition/src/decode-limits.ts';
import {
  streamDbcRecords,
  streamDbfRecords,
  type DbfStreamSummary,
} from '../../../packages/acquisition/src/dbf-record-stream.ts';
import { createTabulationAccumulator, type ConversionRegistry } from '../../../packages/core/src/execute.ts';
import { fieldsUsedByPlan } from '../../../packages/core/src/plan-fields.ts';
import type { QueryPlan, TabulationResult } from '../../../packages/core/src/model.ts';

interface DecodeRequest {
  type: 'decode';
  bytes: ArrayBuffer;
  isDbc: boolean;
}

/**
 * Tabulates without ever returning the records.
 *
 * This is the path for files the materialized route cannot open: records are
 * assembled in bounded batches and folded into the accumulator inside the
 * Worker, so only the finished table crosses back to the main thread.
 */
interface TabulateRequest {
  type: 'tabulate';
  bytes: ArrayBuffer;
  isDbc: boolean;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
  batchSize?: number;
}

interface DecodeProgress {
  type: 'progress';
  recordsRead: number;
  recordCount: number;
}

interface DecodeResult {
  type: 'result';
  header: DbfHeader;
  records: DbfRecord[];
}

interface TabulationMessage {
  type: 'tabulation';
  header: DbfHeader;
  result: TabulationResult;
  stream: Omit<DbfStreamSummary, 'header'>;
}

interface DecodeFailure {
  type: 'error';
  message: string;
}

const workerScope: Worker = self as unknown as Worker;
/** The decoded bytes and materialized records coexist while reporting a result. */
const PROGRESS_INTERVAL_RECORDS = 10_000;
const DEFAULT_TABULATION_BATCH = 5_000;

workerScope.addEventListener('message', (event: MessageEvent<DecodeRequest | TabulateRequest>) => {
  if (event.data.type === 'tabulate') {
    tabulate(event.data);
    return;
  }
  void decode(event.data);
});

async function decode(request: DecodeRequest): Promise<void> {
  try {
    const source = new Uint8Array(request.bytes);
    if (request.isDbc) {
      assertMaterializedDbfFits(readDbcMetadata(source), 'Este DBC');
    }
    const dbf = request.isDbc ? dbcToDbf(source) : source;
    if (dbf.byteLength > MAX_MATERIALIZED_DBF_BYTES) {
      throw new Error('DBF decodificado excede o limite local de memória de 256 MB');
    }
    const header = readDbfHeader(dbf);
    const minimumBytes = header.headerLength + header.recordCount * header.recordLength;
    if (minimumBytes > MAX_MATERIALIZED_DBF_BYTES) {
      throw new Error('Registros DBF excedem o limite local de memória de 256 MB');
    }
    const records: DbfRecord[] = [];
    for await (const record of readDbfRecords(dbf)) {
      records.push(record);
      if (records.length % PROGRESS_INTERVAL_RECORDS === 0) {
        const progress: DecodeProgress = { type: 'progress', recordsRead: records.length, recordCount: header.recordCount };
        workerScope.postMessage(progress);
      }
    }
    workerScope.postMessage({ type: 'progress', recordsRead: records.length, recordCount: header.recordCount } satisfies DecodeProgress);
    const result: DecodeResult = { type: 'result', header, records };
    workerScope.postMessage(result);
  } catch (error) {
    const failure: DecodeFailure = { type: 'error', message: error instanceof Error ? error.message : String(error) };
    workerScope.postMessage(failure);
  }
}

/**
 * Synchronous on purpose: the record stream drives a synchronous decoder, and
 * the accumulator it feeds is synchronous too. `postMessage` still reaches the
 * main thread from inside this loop, so progress is reported, but an incoming
 * cancel message cannot be processed while it runs — the caller terminates the
 * Worker instead, which is documented in `dbf-record-stream.ts`.
 */
function tabulate(request: TabulateRequest): void {
  try {
    const source = new Uint8Array(request.bytes);
    const accumulator = createTabulationAccumulator(request.plan, request.conversions ?? {});
    const batchSize = request.batchSize ?? DEFAULT_TABULATION_BATCH;
    let reported = 0;

    const consume = (batch: { records: DbfRecord[]; recordsRead: number; recordCount: number }): void => {
      accumulator.push(batch.records);
      if (batch.recordsRead - reported >= PROGRESS_INTERVAL_RECORDS || batch.recordsRead === batch.recordCount) {
        reported = batch.recordsRead;
        workerScope.postMessage({
          type: 'progress', recordsRead: batch.recordsRead, recordCount: batch.recordCount,
        } satisfies DecodeProgress);
      }
    };

    // Decode only what the plan reads. Record decoding is the dominant cost of
    // opening a DATASUS file, and a tabulation names a handful of fields out of
    // the hundred-odd a national file declares.
    const fields = fieldsUsedByPlan(request.plan);
    const summary = request.isDbc
      ? streamDbcRecords(source, consume, { batchSize, fields })
      : streamDbfRecords(source, consume, { batchSize, fields });
    const { header, ...stream } = summary;

    workerScope.postMessage({
      type: 'tabulation', header, result: accumulator.finish(), stream,
    } satisfies TabulationMessage);
  } catch (error) {
    const failure: DecodeFailure = { type: 'error', message: error instanceof Error ? error.message : String(error) };
    workerScope.postMessage(failure);
  }
}
