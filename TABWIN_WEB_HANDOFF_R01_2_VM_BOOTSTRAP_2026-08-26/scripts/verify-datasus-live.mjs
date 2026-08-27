import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { readDbcMetadata } from '@precisa-saude/datasus-dbc';
import {
  DATASUS_DOWNLOAD_ENDPOINT,
  DATASUS_TRANSFER_ENDPOINT,
  buildAuxiliarySearchBody,
  buildDownloadBody,
  buildSearchBody,
  parsePreparedDownloadResponse,
  parseSearchResponse,
} from '../dist/packages/acquisition/src/datasus.js';

async function post(endpoint, body) {
  const response = await fetch(endpoint, { method: 'POST', body });
  assert.equal(response.ok, true, `${endpoint} returned ${response.status}`);
  return response.text();
}

const query = { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC' };
const files = parseSearchResponse(await post(DATASUS_TRANSFER_ENDPOINT, buildSearchBody(query)));
const source = files.find((file) => file.name === 'RDAC2401.dbc');
assert.ok(source, 'official catalog did not return RDAC2401.dbc');

const preparedUrl = parsePreparedDownloadResponse(
  await post(DATASUS_DOWNLOAD_ENDPOINT, buildDownloadBody([source])),
);
const archiveResponse = await fetch(preparedUrl);
assert.equal(archiveResponse.ok, true, `prepared archive returned ${archiveResponse.status}`);
const archive = unzipSync(new Uint8Array(await archiveResponse.arrayBuffer()));
const dbc = Object.entries(archive).find(([name]) => name.toLowerCase().endsWith('rdac2401.dbc'));
assert.ok(dbc, 'prepared archive did not contain RDAC2401.dbc');
const metadata = readDbcMetadata(dbc[1]);

const auxiliaryFiles = parseSearchResponse(
  await post(DATASUS_TRANSFER_ENDPOINT, buildAuxiliarySearchBody('SIHSUS')),
);
const auxiliaryBundle = auxiliaryFiles.find((file) => file.name.toUpperCase() === 'TAB_SIH.ZIP');
assert.ok(auxiliaryBundle, 'official catalog did not return current TAB_SIH.zip');
const auxiliaryPreparedUrl = parsePreparedDownloadResponse(
  await post(DATASUS_DOWNLOAD_ENDPOINT, buildDownloadBody([auxiliaryBundle])),
);
const auxiliaryArchiveResponse = await fetch(auxiliaryPreparedUrl);
assert.equal(auxiliaryArchiveResponse.ok, true, `auxiliary archive returned ${auxiliaryArchiveResponse.status}`);
const auxiliaryOuter = unzipSync(new Uint8Array(await auxiliaryArchiveResponse.arrayBuffer()));
const nestedBundle = Object.entries(auxiliaryOuter).find(([name]) => name.toUpperCase().endsWith('TAB_SIH.ZIP'));
assert.ok(nestedBundle, 'prepared auxiliary archive did not contain TAB_SIH.zip');
const auxiliaryEntries = unzipSync(nestedBundle[1]);
const auxiliaryNames = Object.keys(auxiliaryEntries).map((name) => name.replaceAll('\\', '/').split('/').pop()?.toUpperCase());
assert.ok(auxiliaryNames.includes('RD2008.DEF'), 'TAB_SIH.zip did not contain RD2008.DEF');
assert.ok(auxiliaryNames.includes('COMPLEX2.CNV'), 'TAB_SIH.zip did not contain COMPLEX2.CNV');

console.log(JSON.stringify({
  catalogFile: source.name,
  preparedHost: new URL(preparedUrl).host,
  archiveBytes: dbc[1].byteLength,
  recordCount: metadata.recordCount,
  recordSize: metadata.recordSize,
  auxiliaryBundle: auxiliaryBundle.name,
  auxiliaryEntries: Object.keys(auxiliaryEntries).length,
  verifiedAuxiliaries: ['RD2008.DEF', 'COMPLEX2.CNV'],
}, null, 2));
