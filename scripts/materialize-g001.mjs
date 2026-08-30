import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import {
  DATASUS_DOWNLOAD_ENDPOINT,
  DATASUS_TRANSFER_ENDPOINT,
  buildAuxiliarySearchBody,
  buildDownloadBody,
  parsePreparedDownloadResponse,
  parseSearchResponse,
} from '../dist/packages/acquisition/src/datasus.js';

const outputArgument = process.argv[2];
if (!outputArgument) {
  throw new Error('usage: npm run materialize:g001 -- <output-directory>');
}
const outputDirectory = path.resolve(outputArgument);
const upstreamCommit = '42fef70c61592b5cf15c66d987d04e3d1c83fabe';
const dbcUrl = `https://raw.githubusercontent.com/Precisa-Saude/datasus-dbc/${upstreamCommit}/packages/dbc/test/fixtures/RDAC2401.dbc`;

async function fetchWithRetry(url, options) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, options);
    if (response.ok || response.status < 500) return response;
    lastStatus = response.status;
    await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
  }
  throw new Error(`${url} returned HTTP ${lastStatus} after retries`);
}

async function fetchBytes(url, options) {
  const response = await fetchWithRetry(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function postForm(url, body) {
  const response = await fetchWithRetry(url, { method: 'POST', body });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function baseName(value) {
  return value.replaceAll('\\', '/').split('/').at(-1)?.toUpperCase() ?? '';
}

await mkdir(outputDirectory, { recursive: true });
const dbc = await fetchBytes(dbcUrl);
const auxiliaryFiles = parseSearchResponse(await postForm(
  DATASUS_TRANSFER_ENDPOINT,
  buildAuxiliarySearchBody('SIHSUS'),
));
const bundle = auxiliaryFiles.find((file) => file.name.toUpperCase() === 'TAB_SIH.ZIP');
if (!bundle) throw new Error('official auxiliary catalog did not return TAB_SIH.zip');
const preparedUrl = parsePreparedDownloadResponse(await postForm(
  DATASUS_DOWNLOAD_ENDPOINT,
  buildDownloadBody([bundle]),
));
const outerArchive = await fetchBytes(preparedUrl);
const outerEntries = unzipSync(outerArchive);
const nestedArchive = Object.entries(outerEntries).find(([name]) => baseName(name) === 'TAB_SIH.ZIP')?.[1];
if (!nestedArchive) throw new Error('prepared archive did not contain TAB_SIH.zip');
const auxiliaryEntries = unzipSync(nestedArchive);

const selected = new Map([['RDAC2401.dbc', dbc]]);
for (const wanted of ['RD2008.DEF', 'COMPLEX2.CNV']) {
  const entry = Object.entries(auxiliaryEntries).find(([name]) => baseName(name) === wanted)?.[1];
  if (!entry) throw new Error(`TAB_SIH.zip did not contain ${wanted}`);
  selected.set(wanted, entry);
}

const files = [];
for (const [name, bytes] of selected) {
  await writeFile(path.join(outputDirectory, name), bytes);
  files.push({ name, bytes: bytes.byteLength, sha256: sha256(bytes) });
}
const manifest = {
  schema: 'tabwin-web.g001-acquisition',
  version: 1,
  acquiredAt: new Date().toISOString(),
  sources: { dbcUrl, auxiliaryCatalog: DATASUS_TRANSFER_ENDPOINT, preparedUrl },
  files,
};
await writeFile(path.join(outputDirectory, 'acquisition-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
