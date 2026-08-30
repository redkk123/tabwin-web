/**
 * Shows where the time actually goes when opening a DATASUS DBC.
 *
 * The chunked decoder removed the memory wall. This benchmark exists to find
 * the next wall before designing around a guess, and it locates it precisely:
 * decompression is cheap, turning records into JavaScript objects is not.
 *
 * usage: npm run bench:decode-breakdown -- <arquivo.dbc>
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  dbcToDbf,
  implodeDecompress,
  readDbcMetadata,
  readDbfRecords,
} from '@precisa-saude/datasus-dbc';
import { implodeDecompressChunks } from '../dist/packages/acquisition/src/implode-stream.js';
import { streamDbcRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';

function normalizeWindowsNpmArgument(value) {
  if (!value || process.platform !== 'win32') return value;
  return value.replace(/^\^/, '').replace(/\^$/, '').replaceAll('^ ', ' ');
}

const dbcArgument = normalizeWindowsNpmArgument(process.argv[2]);
if (!dbcArgument) throw new Error('usage: npm run bench:decode-breakdown -- <arquivo.dbc>');
const dbcPath = path.resolve(dbcArgument);
const dbc = new Uint8Array(await readFile(dbcPath));
const metadata = readDbcMetadata(dbc);
const compressed = dbc.subarray(metadata.headerSize + 4);
const expectedRecordBytes = metadata.recordCount * metadata.recordSize + 1;

async function time(fn, runs = 5) {
  for (let index = 0; index < 2; index++) await fn();
  const start = performance.now();
  for (let index = 0; index < runs; index++) await fn();
  return (performance.now() - start) / runs;
}

const dclMaterialized = await time(() => { implodeDecompress(compressed, expectedRecordBytes); });
const dclChunked = await time(() => {
  implodeDecompressChunks(compressed, expectedRecordBytes, () => {}, { allowMissingFinalByte: true });
});
const publishedFull = await time(async () => {
  const dbf = dbcToDbf(dbc);
  // eslint-disable-next-line no-unused-vars
  for await (const record of readDbfRecords(dbf)) { /* count only */ }
});
const streamedFull = await time(() => {
  streamDbcRecords(dbc, () => { /* count only */ }, { batchSize: 5000 });
});

const round = (value) => Math.round(value * 10) / 10;
const compressedMiB = dbc.byteLength / (1024 * 1024);

console.log(JSON.stringify({
  file: path.basename(dbcPath),
  compressedMiB: Math.round(compressedMiB * 1000) / 1000,
  declaredRecords: metadata.recordCount,
  recordSize: metadata.recordSize,
  milliseconds: {
    dclDecompressionMaterialized: round(dclMaterialized),
    dclDecompressionChunked: round(dclChunked),
    publishedReaderBytesAndRecords: round(publishedFull),
    streamedBytesAndRecords: round(streamedFull),
  },
  recordDecodingShareOfTime: `${Math.round(100 * (1 - dclChunked / streamedFull))}%`,
  streamedVersusPublished: `${(streamedFull / publishedFull).toFixed(2)}x`,
  projectedSecondsPerPass: {
    basis: 'linear no tamanho comprimido; indicativo, não medido no arquivo grande',
    at63MiB: round((streamedFull / compressedMiB) * 63 / 1000),
  },
}, null, 2));
