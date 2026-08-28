/**
 * Proves the bounded record stream against a real DATASUS DBC.
 *
 * The published reader materializes the whole DBF and every record object;
 * the streamed reader must produce exactly the same records without doing so.
 * Official DBCs are not redistributed in this repository, so the file is
 * supplied from the private oracle directory.
 *
 * usage: npm run verify:record-stream -- <arquivo.dbc> [lote]
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbcMetadata, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { streamDbcRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';

function normalizeWindowsNpmArgument(value) {
  if (!value || process.platform !== 'win32') return value;
  return value.replace(/^\^/, '').replace(/\^$/, '').replaceAll('^ ', ' ');
}

const dbcArgument = normalizeWindowsNpmArgument(process.argv[2]);
if (!dbcArgument) throw new Error('usage: npm run verify:record-stream -- <arquivo.dbc> [lote]');
const batchSize = Number(normalizeWindowsNpmArgument(process.argv[3]) ?? 2000) || 2000;

const dbcPath = path.resolve(dbcArgument);
const dbc = new Uint8Array(await readFile(dbcPath));
const metadata = readDbcMetadata(dbc);

// Reference path: materialize the entire DBF, then every record object.
const referenceDbf = dbcToDbf(dbc);
const referenceRecords = [];
for await (const record of readDbfRecords(referenceDbf)) referenceRecords.push(record);

// Streamed path: never holds more than one batch of records.
let compared = 0;
let peakBatchRecords = 0;
let batches = 0;
const summary = streamDbcRecords(dbc, (batch) => {
  batches += 1;
  peakBatchRecords = Math.max(peakBatchRecords, batch.records.length);
  assert.equal(batch.firstRecordIndex, compared, 'lote fora de ordem');
  for (const record of batch.records) {
    assert.deepEqual(record, referenceRecords[compared], `registro ${compared} divergiu do leitor publicado`);
    compared += 1;
  }
}, { batchSize });

assert.equal(compared, referenceRecords.length, 'o fluxo em blocos não entregou todos os registros');
assert.ok(peakBatchRecords <= batchSize, 'lote excedeu o limite pedido');
assert.ok(summary.maxChunkBytes <= 4096, 'o decodificador emitiu um bloco acima da janela de 4 KiB');

const report = {
  file: path.basename(dbcPath),
  sha256: createHash('sha256').update(dbc).digest('hex'),
  declared: {
    recordCount: metadata.recordCount,
    recordSize: metadata.recordSize,
    headerSize: metadata.headerSize,
  },
  reference: {
    materializedDbfBytes: referenceDbf.byteLength,
    records: referenceRecords.length,
  },
  streamed: {
    records: summary.recordsEmitted,
    recordsRead: summary.recordsRead,
    deletedSkipped: summary.deletedSkipped,
    bytesDecoded: summary.bytesDecoded,
    chunkCount: summary.chunkCount,
    maxChunkBytes: summary.maxChunkBytes,
    trailingBytes: summary.trailingBytes,
    batches,
    peakBatchRecords,
  },
  equalRecords: compared,
  divergentRecords: 0,
  pass: true,
};

console.log(JSON.stringify(report, null, 2));
