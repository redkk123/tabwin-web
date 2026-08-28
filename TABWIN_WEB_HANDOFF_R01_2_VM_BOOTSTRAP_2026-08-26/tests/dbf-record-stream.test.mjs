import test from 'node:test';
import assert from 'node:assert/strict';
import { readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { writeDbf } from '../dist/packages/export/src/dbf-writer.js';
import {
  streamDbfRecords,
  streamRecordsFromChunks,
} from '../dist/packages/acquisition/src/dbf-record-stream.js';

const FIELDS = [
  { name: 'TEXTO', type: 'C', length: 12, decimalCount: 0 },
  { name: 'VALOR', type: 'N', length: 9, decimalCount: 2 },
  { name: 'QTD', type: 'N', length: 5, decimalCount: 0 },
  { name: 'DATA', type: 'D', length: 8, decimalCount: 0 },
  { name: 'ATIVO', type: 'L', length: 1, decimalCount: 0 },
  { name: 'CODIGO', type: 'I', length: 4, decimalCount: 0 },
];

/** Edge values first, then bulk rows so batching crosses many chunk boundaries. */
const ROWS = [
  { TEXTO: 'São José', VALOR: 12.5, QTD: 7, DATA: new Date('2024-01-31T00:00:00Z'), ATIVO: true, CODIGO: 120040 },
  { TEXTO: '', VALOR: null, QTD: null, DATA: null, ATIVO: false, CODIGO: 0 },
  { TEXTO: 'Açaí', VALOR: -3.25, QTD: 0, DATA: new Date('2026-12-01T00:00:00Z'), ATIVO: null, CODIGO: -5 },
  { TEXTO: 'x', VALOR: 0, QTD: 99999, DATA: new Date('1900-01-01T00:00:00Z'), ATIVO: true, CODIGO: 2147483647 },
  { TEXTO: 'doze caract', VALOR: 999999.99, QTD: -999, DATA: null, ATIVO: null, CODIGO: -2147483648 },
  ...Array.from({ length: 245 }, (_, index) => ({
    TEXTO: `linha ${index}`,
    VALOR: index / 4,
    QTD: index,
    DATA: new Date(Date.UTC(2020 + (index % 6), index % 12, 1 + (index % 27))),
    ATIVO: index % 3 === 0 ? true : index % 3 === 1 ? false : null,
    CODIGO: index * 7 - 100,
  })),
];

/** Record indices flipped to the xBase deleted marker after writing. */
const DELETED_INDICES = [2, 5, 249];

function buildFixture() {
  const bytes = writeDbf(ROWS, FIELDS, { dateOfLastUpdate: new Date('2026-08-28T00:00:00Z') });
  const header = readDbfHeader(bytes);
  for (const index of DELETED_INDICES) {
    bytes[header.headerLength + index * header.recordLength] = 0x2a;
  }
  return { bytes, header };
}

async function referenceRecords(bytes, options = {}) {
  const records = [];
  for await (const record of readDbfRecords(bytes, options)) records.push(record);
  return records;
}

function chunkProducer(bytes, header, chunkBytes) {
  return (onChunk) => {
    for (let offset = header.headerLength; offset < bytes.length; offset += chunkBytes) {
      onChunk(bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.length)));
    }
  };
}

function collect(bytes, header, chunkBytes, options = {}) {
  const batches = [];
  const summary = streamRecordsFromChunks(
    header,
    chunkProducer(bytes, header, chunkBytes),
    (batch) => batches.push(batch),
    options,
  );
  return { batches, summary, records: batches.flatMap((batch) => batch.records) };
}

test('streamed records match the published reader across adversarial chunk boundaries', async () => {
  const { bytes, header } = buildFixture();
  const expected = await referenceRecords(bytes);
  assert.equal(header.recordLength, 40);
  assert.equal(expected.length, ROWS.length - DELETED_INDICES.length);

  // 1..7 split records mid-field; 39/40/41 straddle the record boundary itself;
  // 4096 is the window the DCL decoder actually emits.
  for (const chunkBytes of [1, 2, 3, 5, 7, 39, 40, 41, 4096]) {
    const { records, summary } = collect(bytes, header, chunkBytes, { batchSize: 32 });
    assert.deepEqual(records, expected, `divergiu com blocos de ${chunkBytes} bytes`);
    assert.equal(summary.recordsRead, ROWS.length);
    assert.equal(summary.recordsEmitted, expected.length);
    assert.equal(summary.deletedSkipped, DELETED_INDICES.length);
    assert.equal(summary.trailingBytes, 1);
    assert.equal(summary.cancelled, false);
  }
});

test('streamed values decode every supported field type exactly', async () => {
  const { bytes, header } = buildFixture();
  const { records } = collect(bytes, header, 3, { batchSize: 64 });

  assert.deepEqual(records[0], {
    TEXTO: 'São José',
    VALOR: 12.5,
    QTD: 7,
    DATA: new Date('2024-01-31T00:00:00Z'),
    ATIVO: true,
    CODIGO: 120040,
  });
  // Empty character, blank numerics, blank date and a blank logical are all null.
  assert.deepEqual(records[1], {
    TEXTO: null, VALOR: null, QTD: null, DATA: null, ATIVO: false, CODIGO: 0,
  });
  assert.equal(records[2].CODIGO, 2147483647);
  assert.equal(records[3].VALOR, 999999.99);
  assert.equal(records[3].CODIGO, -2147483648);
  assert.equal(records[3].ATIVO, null);
});

test('records arrive in bounded, ordered batches instead of one materialized array', async () => {
  const { bytes, header } = buildFixture();
  const expected = await referenceRecords(bytes);
  const { batches, summary } = collect(bytes, header, 4096, { batchSize: 32 });

  assert.ok(batches.length > 1, 'o consumidor deve receber vários lotes');
  assert.ok(batches.every((batch) => batch.records.length <= 32));
  assert.equal(batches.reduce((total, batch) => total + batch.records.length, 0), expected.length);

  let emitted = 0;
  let previousRead = 0;
  for (const batch of batches) {
    assert.equal(batch.firstRecordIndex, emitted);
    assert.equal(batch.recordCount, summary.declaredRecords);
    assert.ok(batch.recordsRead >= previousRead, 'progresso deve ser monotônico');
    previousRead = batch.recordsRead;
    emitted += batch.records.length;
  }
  assert.equal(previousRead, ROWS.length);
});

test('deleted records follow the published skip and include policy', async () => {
  const { bytes, header } = buildFixture();

  const skipped = collect(bytes, header, 7, { batchSize: 16 });
  assert.deepEqual(skipped.records, await referenceRecords(bytes));

  const included = collect(bytes, header, 7, { batchSize: 16, includeDeleted: true });
  assert.deepEqual(included.records, await referenceRecords(bytes, { includeDeleted: true }));
  assert.equal(included.summary.recordsEmitted, ROWS.length);
  assert.equal(included.summary.deletedSkipped, 0);
  assert.equal(included.records.filter((record) => record.__deleted === true).length, DELETED_INDICES.length);
});

test('whole-DBF streaming agrees with the published reader and tolerates the EOF byte', async () => {
  const { bytes } = buildFixture();
  const batches = [];
  const summary = streamDbfRecords(bytes, (batch) => batches.push(batch), { batchSize: 100 });
  assert.deepEqual(batches.flatMap((batch) => batch.records), await referenceRecords(bytes));
  assert.equal(summary.trailingBytes, 1);
  assert.equal(summary.maxChunkBytes, 4096);
});

test('cancellation stops at a batch boundary without failing or demanding every record', () => {
  const { bytes, header } = buildFixture();
  const batches = [];
  const summary = streamRecordsFromChunks(
    header,
    chunkProducer(bytes, header, 4096),
    (batch) => batches.push(batch),
    { batchSize: 32, shouldCancel: () => batches.length >= 2 },
  );

  assert.equal(summary.cancelled, true);
  assert.equal(batches.length, 2);
  assert.equal(summary.recordsEmitted, 64);
  assert.ok(summary.recordsRead < ROWS.length, 'cancelar deve interromper a leitura');
});

test('cancelling before the first byte yields an empty, explicitly cancelled stream', () => {
  const { bytes, header } = buildFixture();
  const batches = [];
  const summary = streamRecordsFromChunks(
    header,
    chunkProducer(bytes, header, 4096),
    (batch) => batches.push(batch),
    { shouldCancel: () => true },
  );
  assert.equal(batches.length, 0);
  assert.equal(summary.cancelled, true);
  assert.equal(summary.recordsRead, 0);
});

test('streaming rejects invalid batch sizes and geometry that disagrees with the bytes', () => {
  const { bytes, header } = buildFixture();

  for (const batchSize of [0, -1, 2.5, 1_000_000]) {
    assert.throws(
      () => collect(bytes, header, 4096, { batchSize }),
      /Tamanho de lote inválido/,
    );
  }

  // Cut on a record boundary: the count is short but no record is torn.
  const missingRecords = bytes.subarray(0, header.headerLength + 247 * header.recordLength);
  assert.throws(
    () => streamDbfRecords(missingRecords, () => {}, {}),
    /trouxe 247 registros; o cabeçalho declara 250/,
  );

  // Cut mid-record: the torn record is reported before the count mismatch.
  const tornRecord = bytes.subarray(0, header.headerLength + 247 * header.recordLength + 11);
  assert.throws(
    () => streamDbfRecords(tornRecord, () => {}, {}),
    /terminou com 11 bytes de um registro incompleto/,
  );

  const padded = new Uint8Array(bytes.length + 2);
  padded.set(bytes, 0);
  assert.throws(
    () => streamDbfRecords(padded, () => {}, {}),
    /bytes após os 250 registros declarados/,
  );
});

test('streaming refuses a header whose record geometry is unusable', () => {
  const { bytes, header } = buildFixture();
  assert.throws(
    () => streamRecordsFromChunks({ ...header, recordLength: 0 }, chunkProducer(bytes, header, 64), () => {}, {}),
    /tamanho de registro inválido/,
  );
  assert.throws(
    () => streamRecordsFromChunks({ ...header, recordCount: -1 }, chunkProducer(bytes, header, 64), () => {}, {}),
    /contagem de registros inválida/,
  );
});
