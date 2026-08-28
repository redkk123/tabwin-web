import {
  dbcToDbf,
  readDbcMetadata,
  readDbfHeader,
  readDbfRecords,
  type DbfHeader,
  type DbfRecord,
} from '@precisa-saude/datasus-dbc';
import { assertMaterializedDbfFits, MAX_MATERIALIZED_DBF_BYTES } from '../../../packages/acquisition/src/decode-limits.ts';

interface DecodeRequest {
  type: 'decode';
  bytes: ArrayBuffer;
  isDbc: boolean;
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

interface DecodeFailure {
  type: 'error';
  message: string;
}

const workerScope: Worker = self as unknown as Worker;
/** The decoded bytes and materialized records coexist while reporting a result. */
const PROGRESS_INTERVAL_RECORDS = 10_000;

workerScope.addEventListener('message', (event: MessageEvent<DecodeRequest>) => {
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
