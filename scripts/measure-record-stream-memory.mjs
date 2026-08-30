/**
 * Measures the peak record memory of the materialized reader against the
 * bounded record stream.
 *
 * The point of the chunked path is that peak memory stops growing with the
 * file. This benchmark makes that claim measurable instead of asserted: run
 * it at two sizes and the streamed peak should stay flat while the
 * materialized peak grows roughly linearly.
 *
 * Each mode runs in its own process so one path cannot leave garbage behind
 * that distorts the other, and every sample is taken after a forced GC.
 *
 * usage: npm run bench:record-stream -- <registros> <materializado|em-blocos>
 */

import { readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { writeDbf } from '../dist/packages/export/src/dbf-writer.js';
import { streamDbfRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';

if (typeof global.gc !== 'function') {
  throw new Error('execute com --expose-gc (use npm run bench:record-stream)');
}

function normalizeWindowsNpmArgument(value) {
  if (!value || process.platform !== 'win32') return value;
  return value.replace(/^\^/, '').replace(/\^$/, '').replaceAll('^ ', ' ');
}

const COUNT = Number(normalizeWindowsNpmArgument(process.argv[2]) ?? 400_000) || 400_000;
const MODE = normalizeWindowsNpmArgument(process.argv[3]) ?? 'em-blocos';
const BATCH_SIZE = 5_000;

/** Shaped like a SINAN notification row: identifiers, codes, a date, a measure. */
const FIELDS = [
  { name: 'MUNIC', type: 'C', length: 6, decimalCount: 0 },
  { name: 'NOME', type: 'C', length: 40, decimalCount: 0 },
  { name: 'IDADE', type: 'N', length: 3, decimalCount: 0 },
  { name: 'SEXO', type: 'C', length: 1, decimalCount: 0 },
  { name: 'VALOR', type: 'N', length: 12, decimalCount: 2 },
  { name: 'DATA', type: 'D', length: 8, decimalCount: 0 },
  { name: 'CODIGO', type: 'I', length: 4, decimalCount: 0 },
];

const rows = Array.from({ length: COUNT }, (_, index) => ({
  MUNIC: String(120000 + (index % 5570)),
  NOME: `PACIENTE NUMERO ${index}`,
  IDADE: index % 100,
  SEXO: index % 2 ? 'M' : 'F',
  VALOR: (index % 10000) / 100,
  DATA: new Date(Date.UTC(2024, index % 12, 1 + (index % 27))),
  CODIGO: index,
}));

const bytes = writeDbf(rows, FIELDS, { dateOfLastUpdate: new Date('2026-08-28T00:00:00Z') });
rows.length = 0;
const header = readDbfHeader(bytes);

const mib = (value) => Math.round((value / (1024 * 1024)) * 10) / 10;
const heap = () => {
  global.gc();
  return process.memoryUsage().heapUsed;
};

const baseline = heap();
let peak = 0;
let counted = 0;
const byMunicipality = new Map();
// Module scope on purpose: a block-scoped array is provably dead by the time
// the sample is taken and V8 collects it, reporting a misleadingly small peak.
let materialized = null;

if (MODE === 'materializado') {
  materialized = [];
  for await (const record of readDbfRecords(bytes)) materialized.push(record);
  for (const record of materialized) {
    counted += 1;
    byMunicipality.set(record.MUNIC, (byMunicipality.get(record.MUNIC) ?? 0) + 1);
  }
  peak = heap() - baseline;
} else if (MODE === 'em-blocos') {
  streamDbfRecords(bytes, (batch) => {
    // The same aggregation the Worker will do, so the comparison is like for like.
    for (const record of batch.records) {
      counted += 1;
      byMunicipality.set(record.MUNIC, (byMunicipality.get(record.MUNIC) ?? 0) + 1);
    }
    const used = heap() - baseline;
    if (used > peak) peak = used;
  }, { batchSize: BATCH_SIZE });
} else {
  throw new Error(`modo desconhecido: ${MODE} (use materializado ou em-blocos)`);
}

console.log(JSON.stringify({
  mode: MODE,
  records: counted,
  recordLength: header.recordLength,
  dbfMiB: mib(bytes.byteLength),
  batchSize: MODE === 'em-blocos' ? BATCH_SIZE : null,
  aggregatedKeys: byMunicipality.size,
  peakRecordHeapMiB: mib(peak),
  recordsStillReferenced: materialized?.length ?? 0,
}));
