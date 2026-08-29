/**
 * Owns the opened dataset so the main thread never holds records.
 *
 * Every consumer that used to read a resident record array — tabulation,
 * numeric profiling, the filter value list, selected-record export — asks this
 * Worker instead, and each request is answered by streaming the retained
 * sources in bounded batches. There is no separate path for large files: the
 * same code serves a 300 KiB SIH file and the 63 MiB national Dengue file.
 *
 * The measured reason this works: decoding records into JavaScript objects is
 * about 91% of the cost of opening a DBC, and a tabulation reads a handful of
 * the hundred-odd declared fields. Every request therefore projects to the
 * fields it actually needs.
 */

import {
  readDbcMetadata,
  readDbfHeader,
  type DbfField,
  type DbfHeader,
  type DbfRecord,
} from '@precisa-saude/datasus-dbc';
import {
  streamDbcRecords,
  streamDbfRecords,
  type DbfRecordBatch,
} from '../../../packages/acquisition/src/dbf-record-stream.ts';
import { createTabulationAccumulator, type ConversionRegistry } from '../../../packages/core/src/execute.ts';
import { fieldsUsedByPlan } from '../../../packages/core/src/plan-fields.ts';
import { createTabulationResultCache } from '../../../packages/core/src/tabulation-cache.ts';
import type { QueryPlan, TabulationResult } from '../../../packages/core/src/model.ts';
import {
  createDistinctValueCollector,
  createFieldCombinationProfiler,
  createNumericFieldProfiler,
  type FieldCombinationProfile,
  type NumericFieldProfile,
} from '../../../packages/analysis/src/data-quality.ts';
import { createSelectedRecordCollector } from '../../../packages/export/src/selected-records.ts';
import { writeDbf } from '../../../packages/export/src/dbf-writer.ts';

/** A source already parsed on the main thread, such as a CSV import. */
interface RecordSource {
  kind: 'records';
  name: string;
  records: DbfRecord[];
}

interface BinarySource {
  kind: 'binary';
  name: string;
  bytes: ArrayBuffer;
  isDbc: boolean;
}

type DatasetSource = RecordSource | BinarySource;

interface OpenRequest {
  type: 'open';
  requestId: number;
  sources: DatasetSource[];
  /** Declared fields for a record source, which carries no DBF header. */
  fields?: DbfField[];
}

interface TabulateRequest {
  type: 'tabulate';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
}

interface NumericProfileRequest {
  type: 'profile-numeric';
  requestId: number;
  field: string;
}

interface DistinctRequest {
  type: 'distinct';
  requestId: number;
  field: string;
  limit?: number;
}

interface CombinationProfileRequest {
  type: 'profile-combinations';
  requestId: number;
  fields: string[];
  limit?: number;
}

interface SelectedDbfRequest {
  type: 'selected-dbf';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
}

/** Adds a schema-compatible file to the open dataset without reopening it. */
interface AppendRequest {
  type: 'append';
  requestId: number;
  source: DatasetSource;
}

type DatasetRequest =
  | OpenRequest | AppendRequest | TabulateRequest
  | NumericProfileRequest | CombinationProfileRequest | DistinctRequest | SelectedDbfRequest;

const workerScope: Worker = self as unknown as Worker;
const BATCH_RECORDS = 5_000;
const PROGRESS_INTERVAL_RECORDS = 20_000;

let sources: DatasetSource[] = [];
let header: DbfHeader | null = null;
/**
 * L3 cache: memoizes a finished tabulation by its exact plan and conversions.
 * Cleared on every 'open'/'append' — a cached result answers for the plan
 * *and* the data it ran over, so once the data changes, nothing in it is
 * still valid, not just the entries that look related.
 */
const resultCache = createTabulationResultCache();

function post(message: unknown, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

function reportProgress(requestId: number, recordsRead: number, recordCount: number): void {
  post({ type: 'progress', requestId, recordsRead, recordCount });
}

/**
 * Streams every retained source in order through one consumer.
 *
 * Multiple files are not concatenated anywhere: they are streamed one after
 * another into the same accumulator, which is both cheaper and closer to what
 * combining sources actually means.
 */
function streamAll(
  requestId: number,
  fields: readonly string[] | undefined,
  consume: (batch: DbfRecordBatch) => void,
): number {
  const declared = header?.recordCount ?? 0;
  let readSoFar = 0;
  let reported = 0;

  for (const source of sources) {
    const forward = (batch: DbfRecordBatch): void => {
      consume(batch);
      const total = readSoFar + batch.recordsRead;
      if (total - reported >= PROGRESS_INTERVAL_RECORDS) {
        reported = total;
        reportProgress(requestId, total, declared);
      }
    };

    if (source.kind === 'records') {
      for (let offset = 0; offset < source.records.length; offset += BATCH_RECORDS) {
        const records = source.records.slice(offset, offset + BATCH_RECORDS);
        forward({
          records,
          firstRecordIndex: offset,
          recordsRead: offset + records.length,
          recordCount: source.records.length,
        });
      }
      readSoFar += source.records.length;
      continue;
    }

    const bytes = new Uint8Array(source.bytes);
    const summary = source.isDbc
      ? streamDbcRecords(bytes, forward, { batchSize: BATCH_RECORDS, ...(fields ? { fields } : {}) })
      : streamDbfRecords(bytes, forward, { batchSize: BATCH_RECORDS, ...(fields ? { fields } : {}) });
    readSoFar += summary.recordsRead;
  }

  reportProgress(requestId, readSoFar, declared || readSoFar);
  return readSoFar;
}

function headerForSources(request: OpenRequest): DbfHeader {
  const [first] = request.sources;
  if (!first) throw new Error('Nenhuma fonte foi enviada ao trabalhador local');
  if (first.kind === 'records') {
    const fields = request.fields ?? [];
    if (!fields.length) throw new Error('Uma fonte de registros exige a lista de campos');
    const records = request.sources.reduce(
      (total, source) => total + (source.kind === 'records' ? source.records.length : 0), 0);
    return {
      version: 0x03,
      dateOfLastUpdate: new Date(),
      recordCount: records,
      headerLength: 32 + fields.length * 32 + 1,
      recordLength: 1 + fields.reduce((sum, field) => sum + field.length, 0),
      fields,
    };
  }

  let recordCount = 0;
  let first_header: DbfHeader | null = null;
  for (const source of request.sources) {
    if (source.kind !== 'binary') throw new Error('Fontes de tipos diferentes não podem ser combinadas');
    const bytes = new Uint8Array(source.bytes);
    const current = source.isDbc
      ? readDbfHeader(bytes.subarray(0, readDbcMetadata(bytes).headerSize))
      : readDbfHeader(bytes);
    if (!first_header) first_header = current;
    else if (schemaSignature(first_header) !== schemaSignature(current)) {
      throw new Error(`${source.name}: esquema incompatível com o primeiro arquivo`);
    }
    recordCount += current.recordCount;
  }
  return { ...first_header!, recordCount };
}

function schemaSignature(value: DbfHeader): string {
  return value.fields.map((field) => `${field.name}:${field.type}:${field.length}:${field.decimalCount}`).join('|');
}

function handle(request: DatasetRequest): void {
  switch (request.type) {
    case 'open': {
      // Computed against the *new* sources before anything module-level
      // changes, so a schema/format error here leaves the previous dataset —
      // and its still-valid cache — untouched.
      const nextHeader = headerForSources(request);
      sources = request.sources;
      header = nextHeader;
      resultCache.clear();
      post({ type: 'opened', requestId: request.requestId, header, recordCount: header.recordCount });
      return;
    }
    case 'append': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto para combinar');
      const source = request.source;
      if (source.kind !== 'binary') throw new Error('Só arquivos DBC/DBF podem ser combinados');
      const bytes = new Uint8Array(source.bytes);
      const incoming = source.isDbc
        ? readDbfHeader(bytes.subarray(0, readDbcMetadata(bytes).headerSize))
        : readDbfHeader(bytes);
      if (schemaSignature(header) !== schemaSignature(incoming)) {
        throw new Error(
          `${source.name}: esquema incompatível; arquivos combinados precisam ter os mesmos campos, tipos, tamanhos e decimais`,
        );
      }
      sources = [...sources, source];
      header = { ...header, recordCount: header.recordCount + incoming.recordCount };
      resultCache.clear();
      post({ type: 'opened', requestId: request.requestId, header, recordCount: header.recordCount });
      return;
    }
    case 'tabulate': {
      const conversions = request.conversions ?? {};
      const cached = resultCache.get({ plan: request.plan, conversions });
      if (cached) {
        post({ type: 'tabulation', requestId: request.requestId, result: cached, cached: true });
        return;
      }
      const accumulator = createTabulationAccumulator(request.plan, conversions);
      streamAll(request.requestId, fieldsUsedByPlan(request.plan), (batch) => accumulator.push(batch.records));
      const result: TabulationResult = accumulator.finish();
      resultCache.set({ plan: request.plan, conversions }, result);
      post({ type: 'tabulation', requestId: request.requestId, result, cached: false });
      return;
    }
    case 'profile-numeric': {
      const profiler = createNumericFieldProfiler(request.field);
      streamAll(request.requestId, [request.field], (batch) => profiler.push(batch.records));
      const profile: NumericFieldProfile = profiler.finish();
      post({ type: 'numeric-profile', requestId: request.requestId, profile });
      return;
    }
    case 'profile-combinations': {
      const profiler = createFieldCombinationProfiler(request.fields, { limit: request.limit ?? 50 });
      streamAll(request.requestId, request.fields, (batch) => profiler.push(batch.records));
      const profile: FieldCombinationProfile = profiler.finish();
      post({ type: 'combination-profile', requestId: request.requestId, profile });
      return;
    }
    case 'distinct': {
      const collector = createDistinctValueCollector(request.field, request.limit ?? 500);
      streamAll(request.requestId, [request.field], (batch) => collector.push(batch.records));
      const collected = collector.finish();
      post({ type: 'distinct-values', requestId: request.requestId, ...collected });
      return;
    }
    case 'selected-dbf': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const collector = createSelectedRecordCollector(request.plan, request.conversions ?? {});
      // No projection here: the exported DBF must carry every declared field.
      streamAll(request.requestId, undefined, (batch) => collector.push(batch.records));
      const bytes = writeDbf(collector.finish(), header.fields, { dateOfLastUpdate: header.dateOfLastUpdate });
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: 'selected-dbf-ready', requestId: request.requestId, bytes: buffer }, [buffer]);
      return;
    }
  }
}

workerScope.addEventListener('message', (event: MessageEvent<DatasetRequest>) => {
  try {
    handle(event.data);
  } catch (error) {
    post({
      type: 'error',
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
