/**
 * Compara tabular decodificando somente os campos do plano contra decodificar
 * todos os campos declarados, sobre o mesmo arquivo e o mesmo plano.
 *
 * usage: npm run bench:plan-projection -- <arquivo.dbc>
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readDbcMetadata, readDbfHeader } from '@precisa-saude/datasus-dbc';
import { streamDbcRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';
import { implodeDecompressChunks } from '../dist/packages/acquisition/src/implode-stream.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { fieldsUsedByPlan } from '../dist/packages/core/src/plan-fields.js';
import { createTabulationAccumulator } from '../dist/packages/core/src/execute.js';

const dbcArgument = process.platform === 'win32' && process.argv[2]
  ? process.argv[2].replace(/^^/, '').replace(/^$/, '').replaceAll('^ ', ' ')
  : process.argv[2];
if (!dbcArgument) throw new Error('usage: npm run bench:plan-projection -- <arquivo.dbc>');
const dbc = new Uint8Array(await readFile(dbcArgument));
const metadata = readDbcMetadata(dbc);
const header = readDbfHeader(dbc.subarray(0, metadata.headerSize));
const compressed = dbc.subarray(metadata.headerSize + 4);
const expected = metadata.recordCount * metadata.recordSize + 1;

// A plan built from the file's own header, so the benchmark runs on any DBC.
// Preference goes to the named SINAN fields when the file declares them, so a
// Dengue run stays comparable across invocations.
const declared = new Set(header.fields.map((field) => field.name));
const pick = (preferred, predicate) => preferred.find((name) => declared.has(name))
  ?? header.fields.find(predicate)?.name;

const rowField = pick(['ID_MUNICIP'], (field) => field.type === 'C');
const columnField = pick(['CS_SEXO'], (field) => field.type === 'C' && field.name !== rowField);
const numericField = pick(['NU_IDADE_N'], (field) => field.type === 'N');
if (!rowField || !columnField) throw new Error('DBF sem dois campos de caráter para tabular');

const plan = compileQueryPlan({
  rows: { field: rowField },
  columns: { field: columnField },
  measure: { kind: 'count' },
  ...(numericField
    ? { filters: [{ field: numericField, kind: 'numeric-range', minimum: 0 }] }
    : { filters: [] }),
});
const used = fieldsUsedByPlan(plan);

function seconds(fn) {
  const start = performance.now();
  const value = fn();
  return { seconds: Math.round((performance.now() - start) / 100) / 10, value };
}

const dcl = seconds(() => {
  let bytes = 0;
  implodeDecompressChunks(compressed, expected, (chunk) => { bytes += chunk.length; }, { allowMissingFinalByte: true });
  return bytes;
});

const projected = seconds(() => {
  const accumulator = createTabulationAccumulator(plan);
  streamDbcRecords(dbc, (batch) => accumulator.push(batch.records), { batchSize: 5000, fields: used });
  return accumulator.finish();
});

const full = seconds(() => {
  const accumulator = createTabulationAccumulator(plan);
  streamDbcRecords(dbc, (batch) => accumulator.push(batch.records), { batchSize: 5000 });
  return accumulator.finish();
});

const same = JSON.stringify(projected.value.cells) === JSON.stringify(full.value.cells)
  && JSON.stringify(projected.value.rows) === JSON.stringify(full.value.rows);

console.log(JSON.stringify({
  file: path.basename(dbcArgument),
  records: metadata.recordCount,
  totalFields: header.fields.length,
  planFields: used,
  secondsDecompressionOnly: dcl.seconds,
  secondsProjectedTabulation: projected.seconds,
  secondsFullFieldTabulation: full.seconds,
  speedup: `${(full.seconds / projected.seconds).toFixed(1)}x`,
  projectedEqualsFull: same,
  rows: projected.value.rows.length,
  columns: projected.value.columns.length,
  recordsAccepted: projected.value.recordsAccepted,
}, null, 2));
