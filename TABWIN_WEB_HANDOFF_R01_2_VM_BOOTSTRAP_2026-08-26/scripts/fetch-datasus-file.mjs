/**
 * Fetches one official DATASUS data file (DBC) through the same official
 * transfer flow the browser app uses, reusing this repository's verified
 * request builders and parsers.
 *
 * Companion to `fetch-auxiliary-bundle.mjs`; see that file for why no FTP
 * access is needed.
 *
 * usage: node scripts/fetch-datasus-file.mjs <SYSTEM> <TYPE> <YEAR> <MONTH> <UF> <out-dir>
 *   e.g. node scripts/fetch-datasus-file.mjs SIHSUS RD 2024 02 AC C:/tmp/out
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import {
  DATASUS_DOWNLOAD_ENDPOINT,
  DATASUS_TRANSFER_ENDPOINT,
  buildDownloadBody,
  buildSearchBody,
  parsePreparedDownloadResponse,
  parseSearchResponse,
} from '../dist/packages/acquisition/src/datasus.js';

const [system, fileType, year, month, uf, outArg] = process.argv.slice(2);
if (!system || !fileType || !year || !outArg) {
  throw new Error('usage: node scripts/fetch-datasus-file.mjs <SYSTEM> <TYPE> <YEAR> <MONTH> <UF> <out-dir>');
}
const outDirectory = path.resolve(outArg);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const FORM_HEADERS = {
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  accept: 'application/json, text/javascript, */*; q=0.01',
  'x-requested-with': 'XMLHttpRequest',
};

async function postForm(endpoint, body, context) {
  const response = await fetch(endpoint, { method: 'POST', headers: FORM_HEADERS, body: body.toString() });
  if (!response.ok) throw new Error(`${context}: HTTP ${response.status}`);
  return response.text();
}

console.log(`[1/3] catálogo ${system}/${fileType} ${year}-${month ?? ''} ${uf ?? ''}…`);
const searchBody = buildSearchBody({ system, fileType, year, ...(month ? { month } : {}), ...(uf ? { uf } : {}) });
const files = parseSearchResponse(await postForm(DATASUS_TRANSFER_ENDPOINT, searchBody, 'catálogo'));
if (!files.length) throw new Error('o catálogo oficial não devolveu nenhum arquivo para essa consulta');
for (const file of files) console.log(`      ${file.name}  <-  ${file.address}`);

console.log('[2/3] preparando download…');
const prepared = parsePreparedDownloadResponse(await postForm(DATASUS_DOWNLOAD_ENDPOINT, buildDownloadBody(files), 'preparação'));
console.log(`      ${prepared}`);

console.log('[3/3] baixando…');
const response = await fetch(prepared);
if (!response.ok) throw new Error(`download: HTTP ${response.status}`);
const archive = new Uint8Array(await response.arrayBuffer());

await mkdir(outDirectory, { recursive: true });
const written = [];
for (const [name, bytes] of Object.entries(unzipSync(archive))) {
  if (!bytes.length) continue;
  const target = path.join(outDirectory, path.basename(name));
  await writeFile(target, bytes);
  written.push({ name: path.basename(name), bytes: bytes.byteLength, sha256: sha256(bytes) });
  console.log(`      ${path.basename(name)}  ${bytes.byteLength} bytes  ${sha256(bytes)}`);
}

await writeFile(path.join(outDirectory, `acquisition-${fileType}-${year}${month ?? ''}-${uf ?? 'BR'}.json`), JSON.stringify({
  schema: 'tabwin-web.datasus-file-acquisition',
  version: 1,
  acquiredAt: new Date().toISOString(),
  query: { system, fileType, year, month, uf },
  sources: {
    catalog: DATASUS_TRANSFER_ENDPOINT,
    downloadEndpoint: DATASUS_DOWNLOAD_ENDPOINT,
    preparedUrl: prepared,
    officialFiles: files.map(({ name, address }) => ({ name, address })),
  },
  files: written,
}, null, 2) + '\n');
console.log(`\nOK em ${outDirectory}`);
