/**
 * Bounded record streaming for DATASUS DBC and DBF sources.
 *
 * Reassembles complete xBase records from the bounded chunks emitted by
 * {@link implodeDecompressChunks} and hands them to a consumer in limited
 * batches. Neither the decoded DBF nor the complete record set is ever
 * materialized: peak cost is the compressed input, one chunk copy, one
 * record-sized carry buffer and a single batch of decoded records.
 *
 * Field decoding mirrors `readDbfRecords` from @precisa-saude/datasus-dbc.
 * That equivalence is not assumed: `tests/dbf-record-stream.test.mjs` pins it
 * against the published reader over adversarial chunk boundaries, every
 * supported field type and the real `RDAC2401.dbc`.
 */

import {
  readDbcMetadata,
  readDbfHeader,
  type DbfField,
  type DbfHeader,
  type DbfRecord,
  type DbfValue,
} from '@precisa-saude/datasus-dbc';
import { implodeDecompressChunks } from './implode-stream.js';

/** Text encodings the DATASUS record surface is known to use. */
export type DbfEncoding = 'windows-1252' | 'iso-8859-1' | 'utf-8';

const DEFAULT_BATCH_RECORDS = 5_000;
const MAX_BATCH_RECORDS = 200_000;
const DBF_CHUNK_BYTES = 4096;
const DELETED_MARKER = 0x2a;

export interface DbfRecordBatch {
  /** Decoded records in file order; deleted ones are absent unless requested. */
  records: DbfRecord[];
  /** Position of this batch's first record within the emitted sequence. */
  firstRecordIndex: number;
  /** Records consumed from the byte stream so far, deleted ones included. */
  recordsRead: number;
  /** Records the header declares, for progress reporting. */
  recordCount: number;
}

export type DbfBatchConsumer = (batch: DbfRecordBatch) => void;

export interface DbfRecordStreamOptions {
  encoding?: DbfEncoding;
  includeDeleted?: boolean;
  /** Records handed to the consumer at a time. Bounds peak record memory. */
  batchSize?: number;
  /**
   * Cooperative cancellation, checked after each batch. A Worker blocked in
   * this synchronous loop cannot receive messages, so a caller that must
   * interrupt an in-flight decode terminates the Worker instead.
   */
  shouldCancel?: () => boolean;
  /**
   * Decode only these fields, leaving the rest absent from each record.
   *
   * Record decoding dominates the cost of opening a DATASUS file — measured at
   * 91% of the time — and a tabulation reads only the handful of fields its
   * plan names. Projecting at the source is therefore the difference between
   * reading a national file in minutes and reading it in seconds.
   *
   * Values of the decoded fields are byte-for-byte what a full decode
   * produces: only the skipped fields change, and they change to absent.
   * Pair this with `fieldsUsedByPlan` so the executor never misses a value.
   */
  fields?: readonly string[];
}

export interface DbfStreamSummary {
  header: DbfHeader;
  declaredRecords: number;
  recordsRead: number;
  recordsEmitted: number;
  deletedSkipped: number;
  /** Bytes of record region decoded, excluding the DBF header. */
  bytesDecoded: number;
  chunkCount: number;
  maxChunkBytes: number;
  /** Bytes after the last declared record; the optional DBF EOF marker. */
  trailingBytes: number;
  cancelled: boolean;
}

/** Thrown internally to unwind the synchronous decoder when a caller cancels. */
class RecordStreamCancelled extends Error {
  constructor() {
    super('Leitura de registros cancelada');
    this.name = 'RecordStreamCancelled';
  }
}

/**
 * Tamanho até o qual montar a string byte a byte vence o `TextDecoder`.
 *
 * Medido neste projeto: para 2 bytes o caminho manual é ~11x mais rápido,
 * para 6 bytes ~3x, empata perto de 20 e perde daí em diante — o
 * `TextDecoder` tem custo fixo por chamada que domina em campo curto e se
 * dilui em campo longo. Os campos do DATASUS são quase todos códigos curtos
 * (UF com 2, ano com 4, município com 6), exatamente onde o manual ganha.
 */
const ASCII_FAST_PATH_MAX_BYTES = 16;

/** Espaço, tab, LF, VT, FF e CR — o que `String.prototype.trim` corta em ASCII. */
function isAsciiSpace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

/**
 * Texto de um campo, com o mesmo recorte que o código anterior fazia.
 *
 * `mode` reproduz exatamente as duas regras que existiam:
 *
 * - `'trailing-spaces'` era `decode(raw).replace(/ +$/, '')` — só espaço, só
 *   à direita. Espaço à esquerda pode ser significativo num código alinhado, e
 *   comê-lo mudaria o valor.
 * - `'both-ends'` era `decode(raw).trim()`.
 *
 * A otimização está em montar a string direto dos bytes quando o campo é curto
 * e puramente ASCII. Isso é seguro por definição do Windows-1252: 0x00–0x7F são
 * idênticos ao Unicode. Qualquer byte acima cai no decodificador de verdade —
 * acento em nome de município existe e não se adivinha —, e ali o recorte é
 * refeito com `trim` para o NBSP (0xA0) continuar sendo cortado como antes.
 */
function fieldText(
  raw: Uint8Array,
  decoder: TextDecoder,
  mode: 'trailing-spaces' | 'both-ends',
): string {
  const trimmable = mode === 'both-ends'
    ? isAsciiSpace
    : (byte: number): boolean => byte === 0x20;

  let end = raw.length;
  while (end > 0 && trimmable(raw[end - 1]!)) end--;
  let begin = 0;
  if (mode === 'both-ends') while (begin < end && trimmable(raw[begin]!)) begin++;
  if (begin >= end) return '';

  if (end - begin <= ASCII_FAST_PATH_MAX_BYTES) {
    let text = '';
    let at = begin;
    for (; at < end; at++) {
      const byte = raw[at]!;
      if (byte > 0x7f) break;
      text += String.fromCharCode(byte);
    }
    if (at === end) return text;
  }
  const decoded = decoder.decode(raw.subarray(begin, end));
  // Pode haver espaço não-ASCII (NBSP) que o corte por byte não pegou.
  return mode === 'both-ends' ? decoded.trim() : decoded.replace(/ +$/, '');
}

function decodeFieldValue(raw: Uint8Array, field: DbfField, decoder: TextDecoder): DbfValue {
  switch (field.type) {
    case 'C': {
      // Só o espaço à direita some: espaço à esquerda pode ser significativo
      // num código alinhado, e comê-lo mudaria o valor.
      const text = fieldText(raw, decoder, 'trailing-spaces');
      return text === '' ? null : text;
    }
    case 'N':
    case 'F': {
      const text = fieldText(raw, decoder, 'both-ends');
      if (text === '' || text === '*') return null;
      const value = Number(text);
      return Number.isFinite(value) ? value : null;
    }
    case 'I': {
      if (raw.length < 4) return null;
      return new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getInt32(0, true);
    }
    case 'D': {
      const text = fieldText(raw, decoder, 'both-ends');
      if (text.length !== 8 || !/^\d{8}$/.test(text)) return null;
      return new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8))));
    }
    case 'L': {
      const marker = String.fromCharCode(raw[0] ?? 0).toUpperCase();
      if (marker === 'T' || marker === 'Y') return true;
      if (marker === 'F' || marker === 'N') return false;
      return null;
    }
  }
}

/** A field descriptor with its precomputed offset inside the record body. */
interface PlacedField {
  field: DbfField;
  offset: number;
}

/**
 * Places the requested fields at their byte offsets, dropping the rest.
 *
 * Offsets come from every declared field in order, so skipping a field never
 * shifts the ones that follow.
 */
function placeFields(fields: readonly DbfField[], requested: readonly string[] | undefined): PlacedField[] {
  const placed: PlacedField[] = [];
  const wanted = requested ? new Set(requested) : undefined;
  let offset = 0;
  for (const field of fields) {
    if (!wanted || wanted.has(field.name)) placed.push({ field, offset });
    offset += field.length;
  }
  if (wanted) {
    const missing = [...wanted].filter((name) => !fields.some((field) => field.name === name));
    if (missing.length) throw new Error(`Campo inexistente no DBF: ${missing.join(', ')}`);
  }
  return placed;
}

/** Decodes one record body, i.e. the record bytes after the deletion marker. */
function decodeRecordBody(body: Uint8Array, placed: readonly PlacedField[], decoder: TextDecoder): DbfRecord {
  const record: DbfRecord = {};
  for (const { field, offset } of placed) {
    record[field.name] = decodeFieldValue(body.subarray(offset, offset + field.length), field, decoder);
  }
  return record;
}

function resolveBatchSize(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_BATCH_RECORDS;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > MAX_BATCH_RECORDS) {
    throw new Error(`Tamanho de lote inválido para leitura em blocos: ${requested}`);
  }
  return requested;
}

/**
 * Drives record assembly over an arbitrary chunk producer.
 *
 * `produce` receives the sink and is responsible for emitting the record
 * region in chunks of any size, including chunks that split records at any
 * byte. Exported so other byte sources — a network stream, a sliced local
 * file — can reuse the assembly and batching rules unchanged.
 */
export function streamRecordsFromChunks(
  header: DbfHeader,
  produce: (onChunk: (chunk: Uint8Array) => void) => void,
  consume: DbfBatchConsumer,
  options: DbfRecordStreamOptions,
): DbfStreamSummary {
  const recordLength = header.recordLength;
  if (!Number.isSafeInteger(recordLength) || recordLength < 1) {
    throw new Error(`Cabeçalho DBF declara tamanho de registro inválido: ${recordLength}`);
  }
  const declaredRecords = header.recordCount;
  if (!Number.isSafeInteger(declaredRecords) || declaredRecords < 0) {
    throw new Error(`Cabeçalho DBF declara contagem de registros inválida: ${declaredRecords}`);
  }

  const batchSize = resolveBatchSize(options.batchSize);
  const includeDeleted = options.includeDeleted ?? false;
  const decoder = new TextDecoder(options.encoding ?? 'windows-1252');
  const placed = placeFields(header.fields, options.fields);
  const shouldCancel = options.shouldCancel;

  const carry = new Uint8Array(recordLength);
  let carryLength = 0;
  let recordsRead = 0;
  let recordsEmitted = 0;
  let deletedSkipped = 0;
  let bytesDecoded = 0;
  let chunkCount = 0;
  let maxChunkBytes = 0;
  let trailingBytes = 0;
  let cancelled = false;
  let batch: DbfRecord[] = [];

  function flush(): void {
    if (!batch.length) return;
    const records = batch;
    batch = [];
    consume({
      records,
      firstRecordIndex: recordsEmitted - records.length,
      recordsRead,
      recordCount: declaredRecords,
    });
    if (shouldCancel?.()) throw new RecordStreamCancelled();
  }

  /** `bytes` is exactly one record, either carried or read in place. */
  function acceptRecord(bytes: Uint8Array): void {
    recordsRead += 1;
    const deleted = bytes[0] === DELETED_MARKER;
    if (deleted && !includeDeleted) {
      deletedSkipped += 1;
      return;
    }
    const record = decodeRecordBody(bytes.subarray(1), placed, decoder);
    if (deleted) Object.defineProperty(record, '__deleted', { enumerable: true, value: true });
    batch.push(record);
    recordsEmitted += 1;
    if (batch.length >= batchSize) flush();
  }

  function onChunk(chunk: Uint8Array): void {
    chunkCount += 1;
    bytesDecoded += chunk.length;
    if (chunk.length > maxChunkBytes) maxChunkBytes = chunk.length;
    let offset = 0;
    while (offset < chunk.length) {
      if (recordsRead >= declaredRecords) {
        trailingBytes += chunk.length - offset;
        break;
      }
      if (carryLength > 0) {
        const take = Math.min(recordLength - carryLength, chunk.length - offset);
        carry.set(chunk.subarray(offset, offset + take), carryLength);
        carryLength += take;
        offset += take;
        if (carryLength === recordLength) {
          carryLength = 0;
          acceptRecord(carry);
        }
        continue;
      }
      const available = chunk.length - offset;
      if (available >= recordLength) {
        acceptRecord(chunk.subarray(offset, offset + recordLength));
        offset += recordLength;
        continue;
      }
      carry.set(chunk.subarray(offset), 0);
      carryLength = available;
      offset = chunk.length;
    }
    // A DBF may close with a single optional 0x1a marker. Anything longer means
    // the declared geometry disagrees with the bytes and must not pass silently.
    if (trailingBytes > 1) {
      throw new Error(
        `Fluxo DBF trouxe ${trailingBytes} bytes após os ${declaredRecords} registros declarados`,
      );
    }
  }

  if (shouldCancel?.()) {
    cancelled = true;
  } else {
    try {
      produce(onChunk);
      flush();
    } catch (error) {
      if (!(error instanceof RecordStreamCancelled)) throw error;
      cancelled = true;
    }
  }

  if (!cancelled) {
    if (carryLength > 0) {
      throw new Error(`Fluxo DBF terminou com ${carryLength} bytes de um registro incompleto`);
    }
    if (recordsRead !== declaredRecords) {
      throw new Error(
        `Fluxo DBF trouxe ${recordsRead} registros; o cabeçalho declara ${declaredRecords}`,
      );
    }
  }

  return {
    header,
    declaredRecords,
    recordsRead,
    recordsEmitted,
    deletedSkipped,
    bytesDecoded,
    chunkCount,
    maxChunkBytes,
    trailingBytes,
    cancelled,
  };
}

/**
 * Streams records out of a DBC envelope without materializing the DBF.
 *
 * The DBF header lives uncompressed at the start of the envelope, so the
 * schema is known before a single record byte is decoded.
 */
export function streamDbcRecords(
  dbc: Uint8Array,
  consume: DbfBatchConsumer,
  options: DbfRecordStreamOptions = {},
): DbfStreamSummary {
  const metadata = readDbcMetadata(dbc);
  const header = readDbfHeader(dbc.subarray(0, metadata.headerSize));
  if (metadata.recordSize !== header.recordLength || metadata.recordCount !== header.recordCount) {
    throw new Error('Envelope DBC e cabeçalho DBF discordam sobre a geometria dos registros');
  }
  const compressed = dbc.subarray(metadata.headerSize + 4);
  const expectedRecordBytes = metadata.recordCount * metadata.recordSize + 1;
  return streamRecordsFromChunks(
    header,
    (onChunk) => {
      implodeDecompressChunks(compressed, expectedRecordBytes, onChunk, {
        allowMissingFinalByte: true,
        // `onChunk` termina com os bytes antes de devolver: decodifica cada
        // registro em primitivos ali mesmo e COPIA a sobra para `carry`. Nada
        // guarda a vista, então a cópia da janela era trabalho puro — 19% do
        // tempo de descompressão em perfil.
        reuseWindowBuffer: true,
      });
    },
    consume,
    options,
  );
}

/**
 * Streams records out of an already decoded DBF.
 *
 * The bytes are already resident, but the record objects are not: this keeps
 * the batch bound for local DBF files as well, and exercises the same
 * assembly path as the DBC route.
 */
export function streamDbfRecords(
  dbf: Uint8Array,
  consume: DbfBatchConsumer,
  options: DbfRecordStreamOptions = {},
): DbfStreamSummary {
  const header = readDbfHeader(dbf);
  return streamRecordsFromChunks(
    header,
    (onChunk) => {
      for (let offset = header.headerLength; offset < dbf.length; offset += DBF_CHUNK_BYTES) {
        onChunk(dbf.subarray(offset, Math.min(offset + DBF_CHUNK_BYTES, dbf.length)));
      }
    },
    consume,
    options,
  );
}
