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
import { dbcToDbf, readDbcMetadata, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { streamDbcRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { createTabulationAccumulator, executeInMemory } from '../dist/packages/core/src/execute.js';

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

// The Worker path: assemble in bounded batches and fold straight into the
// accumulator, never holding the records. It must equal the materialized
// tabulation cell for cell.
// The most discriminating character field, so the comparison covers many rows
// instead of collapsing into a single group.
const header = readDbfHeader(dbcToDbf(dbc));
const groupField = header.fields
  .filter((field) => field.type === 'C')
  .map((field) => ({
    name: field.name,
    distinct: new Set(referenceRecords.map((record) => String(record[field.name] ?? ''))).size,
  }))
  .sort((left, right) => right.distinct - left.distinct || left.name.localeCompare(right.name))[0]?.name
  ?? header.fields[0].name;
const plan = compileQueryPlan({
  rows: { field: groupField },
  measure: { kind: 'count' },
  filters: [],
});

const materializedTable = executeInMemory(referenceRecords, plan);
const streamedAccumulator = createTabulationAccumulator(plan);
streamDbcRecords(dbc, (batch) => streamedAccumulator.push(batch.records), { batchSize });
const streamedTable = streamedAccumulator.finish();

assert.deepEqual(streamedTable, materializedTable, 'a tabulação em blocos divergiu da materializada');

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
  tabulation: {
    groupField,
    rows: streamedTable.rows.length,
    recordsAccepted: streamedTable.recordsAccepted,
    identicalToMaterialized: true,
  },
  pass: true,
};

console.log(JSON.stringify(report, null, 2));
