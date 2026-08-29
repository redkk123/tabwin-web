/**
 * Fetches an official DATASUS auxiliary bundle (DEF/CNV/DBF lookups) straight
 * from the official transfer endpoints, reusing this repository's own verified
 * request builders and response parsers rather than hand-rolled HTTP.
 *
 * Why this exists: `ftp.datasus.gov.br` is unreachable from this machine, but
 * the official transfer flow never asks the client to speak FTP. The client
 * posts to `datasus.saude.gov.br`, DATASUS itself fetches from its FTP, and
 * serves a prepared HTTPS archive back — all on a host this machine can reach.
 * That is exactly what the browser app already does through its Worker proxy.
 *
 * usage: node scripts/fetch-auxiliary-bundle.mjs <SYSTEM> <out-directory>
 *   e.g. node scripts/fetch-auxiliary-bundle.mjs SIHSUS C:/projetos/tabwin-private/oracle/aux
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DATASUS_DOWNLOAD_ENDPOINT,
  DATASUS_TRANSFER_ENDPOINT,
  buildAuxiliarySearchBody,
  buildDownloadBody,
  parsePreparedDownloadResponse,
  parseSearchResponse,
} from '../dist/packages/acquisition/src/datasus.js';

const system = process.argv[2] ?? 'SIHSUS';
const outDirectory = path.resolve(process.argv[3] ?? '.');
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

console.log(`[1/3] catálogo auxiliar de ${system}…`);
const searchText = await postForm(DATASUS_TRANSFER_ENDPOINT, buildAuxiliarySearchBody(system), 'catálogo');
const files = parseSearchResponse(searchText);
console.log(`      ${files.length} arquivo(s) auxiliar(es) oficiais:`);
for (const file of files) console.log(`        ${file.name}  <-  ${file.address}`);
if (!files.length) throw new Error('o catálogo oficial não devolveu nenhum arquivo auxiliar');

console.log('[2/3] pedindo preparação do download…');
const downloadText = await postForm(DATASUS_DOWNLOAD_ENDPOINT, buildDownloadBody(files), 'preparação');
const prepared = parsePreparedDownloadResponse(downloadText);
console.log(`      pronto em: ${prepared}`);

console.log('[3/3] baixando…');
const archive = await fetch(prepared);
if (!archive.ok) throw new Error(`download: HTTP ${archive.status}`);
const bytes = new Uint8Array(await archive.arrayBuffer());

await mkdir(outDirectory, { recursive: true });
const target = path.join(outDirectory, 'auxiliary.zip');
await writeFile(target, bytes);

const manifest = {
  schema: 'tabwin-web.auxiliary-acquisition',
  version: 1,
  acquiredAt: new Date().toISOString(),
  system,
  sources: {
    auxiliaryCatalog: DATASUS_TRANSFER_ENDPOINT,
    downloadEndpoint: DATASUS_DOWNLOAD_ENDPOINT,
    preparedUrl: prepared,
    officialFiles: files.map(({ name, address }) => ({ name, address })),
  },
  archive: { path: target, bytes: bytes.byteLength, sha256: sha256(bytes) },
};
await writeFile(path.join(outDirectory, 'acquisition-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\nOK: ${target}`);
console.log(`     ${bytes.byteLength} bytes · SHA-256 ${manifest.archive.sha256}`);
