/**
 * Measures what the columnar projection actually buys, on a real DBC.
 *
 * The 4.7 cut can be argued about in the abstract forever. This answers three
 * concrete questions with numbers from a file that exists:
 *
 *   1. how many bytes the dictionary-encoded projection holds, against the same
 *      records as ordinary JavaScript objects;
 *   2. how long a tabulation takes from the projection versus from a re-decode;
 *   3. whether the L2 cache actually serves the second, narrower request from
 *      the wider projection it already holds.
 *
 * Usage:
 *   node scripts/measure-columnar-cache.mjs <arquivo.dbc> [campo,campo,...]
 *
 * The DBC stays outside the repository. Nothing here is a test: it prints
 * measurements, and the numbers move with the machine and the file.
 */

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { readDbcMetadata, readDbfHeader } from '@precisa-saude/datasus-dbc';
import { streamDbcRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';
import {
  createColumnarProjectionBuilder,
  createColumnarProjectionCache,
  executeColumnarProjection,
} from '../dist/packages/core/src/columnar-cache.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { executeInMemory } from '../dist/packages/core/src/execute.js';

const [, , path, fieldList] = process.argv;
if (!path) {
  console.error('uso: node scripts/measure-columnar-cache.mjs <arquivo.dbc> [campo,campo,...]');
  process.exit(1);
}

const bytes = new Uint8Array(await readFile(path));
const metadata = readDbcMetadata(bytes);
const header = readDbfHeader(bytes.subarray(0, metadata.headerSize));
const declared = header.fields.map((field) => field.name);
const fields = fieldList ? fieldList.split(',').map((name) => name.trim()) : declared.slice(0, 4);
for (const field of fields) {
  if (!declared.includes(field)) {
    console.error(`campo ${field} não existe. Disponíveis: ${declared.join(', ')}`);
    process.exit(1);
  }
}

/** Rough retained size of the same records as plain objects, for comparison. */
function estimatePlainBytes(records, fields) {
  let total = 0;
  for (const record of records) {
    // Per-property overhead is a rough constant; string payloads dominate and
    // are counted exactly. This is an order-of-magnitude comparison, not a heap
    // measurement, and the report says so.
    for (const field of fields) {
      const value = record[field];
      total += 16;
      if (typeof value === 'string') total += value.length * 2;
      else total += 8;
    }
  }
  return total;
}

console.log(`arquivo: ${path}`);
console.log(`registros declarados: ${metadata.recordCount}`);
console.log(`campos projetados: ${fields.join(', ')}\n`);

const decodeStart = performance.now();
const plainRecords = [];
const builder = createColumnarProjectionBuilder(fields, {});
streamDbcRecords(bytes, (batch) => {
  builder.push(batch.records);
  for (const record of batch.records) {
    const kept = {};
    for (const field of fields) kept[field] = record[field];
    plainRecords.push(kept);
  }
}, { fields });
const decodeMs = performance.now() - decodeStart;
const projection = builder.finish();

const plainBytes = estimatePlainBytes(plainRecords, fields);
console.log(`decodificação + construção: ${decodeMs.toFixed(0)} ms`);
console.log(`linhas na projeção: ${projection.rowCount}`);
console.log(`projeção colunar: ${(projection.estimatedBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`objetos equivalentes (estimativa): ${(plainBytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`razão: ${(plainBytes / Math.max(1, projection.estimatedBytes)).toFixed(2)}x\n`);

for (const column of projection.columns.values()) {
  console.log(`  ${column.field.padEnd(12)} ${String(column.dictionary.length).padStart(8)} distintos · `
    + `índice ${column.indexWidth} bytes · ${(column.estimatedBytes / 1024).toFixed(0)} KiB`);
}

const plan = compileQueryPlan({
  compatibilityProfile: 'tabwin-4.15',
  rows: { field: fields[0] },
  measure: { kind: 'count' },
  filters: [],
});

const fromPlain = performance.now();
const referenceResult = executeInMemory(plainRecords, plan);
const plainMs = performance.now() - fromPlain;

const fromColumnar = performance.now();
const columnarResult = executeColumnarProjection(projection, plan);
const columnarMs = performance.now() - fromColumnar;

const identical = JSON.stringify(referenceResult) === JSON.stringify(columnarResult);
console.log(`\ntabulação por ${fields[0]}: objetos ${plainMs.toFixed(0)} ms · colunar ${columnarMs.toFixed(0)} ms`);
console.log(`resultados idênticos: ${identical ? 'sim' : 'NÃO — investigar'}`);
if (!identical) process.exitCode = 1;

const cache = createColumnarProjectionCache(4);
cache.set(path, projection);
const narrower = cache.get(path, [fields[0]]);
console.log(`\ncache L2: pedido mais estreito servido por superset? ${narrower ? 'sim' : 'não'}`);
if (narrower) console.log(`  campos servidos: ${narrower.fields.join(', ')}`);
console.log(`entradas: ${cache.size}`);
