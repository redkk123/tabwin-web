import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  dbcToDbf,
  readDbcMetadata,
  readDbfRecords,
} from '@precisa-saude/datasus-dbc';
import {
  compareWithGolden,
  compileQueryPlan,
  dimensionFromDefOption,
  executeInMemory,
} from '../dist/packages/core/src/index.js';
import {
  optionsForRole,
  parseTabWinBiffExport,
  parseCnv,
  parseDef,
} from '../dist/packages/formats/src/index.js';

function normalizeWindowsNpmArgument(value) {
  if (!value || process.platform !== 'win32') return value;
  return value.replace(/^\^/, '').replace(/\^$/, '').replaceAll('^ ', ' ');
}

const assetDirectoryArgument = normalizeWindowsNpmArgument(process.argv[2]);
const referenceExportArgument = normalizeWindowsNpmArgument(process.argv[3]);
if (!assetDirectoryArgument || !referenceExportArgument) {
  throw new Error('usage: npm run verify:g001 -- <asset-directory> <TabWin-reference.xls>');
}

const assetDirectory = path.resolve(assetDirectoryArgument);
const referenceExport = path.resolve(referenceExportArgument);
const textDecoder = new TextDecoder('windows-1252');
const expectedHashes = {
  'RDAC2401.dbc': '41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429',
  'RD2008.DEF': '15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652',
  'COMPLEX2.CNV': '680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F',
};

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function readVerifiedAsset(name) {
  const bytes = await readFile(path.join(assetDirectory, name));
  assert.equal(sha256(bytes), expectedHashes[name], `${name} SHA-256 mismatch`);
  return bytes;
}

function parseTabWinBiff2(bytes) {
  const parsed = parseTabWinBiffExport(bytes, textDecoder);
  const labels = new Map(parsed.labels.map(({ row, column, value }) => [`${row}:${column}`, value]));
  const numbers = new Map(parsed.numbers.map(({ row, column, value }) => [`${row}:${column}`, value]));

  const rowItems = [];
  for (const [address, label] of labels) {
    const [row, column] = address.split(':').map(Number);
    if (column !== 0 || row < 3 || !label || label === 'Total') continue;
    const value = numbers.get(`${row}:1`);
    assert.notEqual(value, undefined, `missing numeric value for ${label}`);
    rowItems.push({ row, label, value });
  }
  rowItems.sort((left, right) => left.row - right.row);
  assert.ok(rowItems.length > 0, 'reference export contains no result rows');
  const columnLabel = labels.get('2:1');
  assert.ok(columnLabel, 'reference export contains no measure label');
  return {
    schema: 'tabwin-web.golden-table',
    version: 1,
    id: 'G001',
    source: {
      referenceEngine: 'TabWin 4.15',
      notes: `Lossless BIFF export ${path.basename(referenceExport)}; SHA-256 ${sha256(bytes)}`,
    },
    rows: rowItems.map(({ label }) => ({ label })),
    columns: [{ label: columnLabel }],
    cells: rowItems.map(({ value }) => [value]),
  };
}

const [dbcBytes, defBytes, cnvBytes, referenceBytes] = await Promise.all([
  readVerifiedAsset('RDAC2401.dbc'),
  readVerifiedAsset('RD2008.DEF'),
  readVerifiedAsset('COMPLEX2.CNV'),
  readFile(referenceExport),
]);

const golden = parseTabWinBiff2(referenceBytes);
const definition = parseDef(textDecoder.decode(defBytes));
const rowOption = optionsForRole(definition, 'row')
  .find((option) => option.label === 'Complexidade do Procedimento');
assert.ok(rowOption, 'RD2008.DEF does not expose the G001 row option');
const rowDimension = dimensionFromDefOption(rowOption);
assert.equal(rowDimension.field, 'COMPLEX');
assert.equal(rowDimension.startPosition, 1);
assert.match(rowDimension.conversionId ?? '', /COMPLEX2\.CNV$/i);

const conversion = parseCnv(textDecoder.decode(cnvBytes));
const conversions = { [rowDimension.conversionId]: conversion };
const plan = compileQueryPlan({
  compatibilityProfile: 'tabwin-4.15',
  rows: rowDimension,
  measure: { kind: 'count' },
  filters: [],
  suppressZeroRows: false,
});

const metadata = readDbcMetadata(dbcBytes);
const records = [];
for await (const record of readDbfRecords(dbcToDbf(dbcBytes))) records.push(record);
assert.equal(records.length, metadata.recordCount, 'decoded record count mismatch');

const actual = executeInMemory(records, plan, conversions);
const comparison = compareWithGolden(actual, golden, { absoluteTolerance: 0 });
assert.equal(comparison.pass, true, JSON.stringify(comparison, null, 2));

console.log(JSON.stringify({
  pass: true,
  tolerance: 0,
  referenceExport: {
    path: referenceExport,
    bytes: referenceBytes.byteLength,
    sha256: sha256(referenceBytes),
  },
  records: {
    declared: metadata.recordCount,
    decoded: records.length,
    seen: actual.recordsSeen,
    accepted: actual.recordsAccepted,
  },
  rows: actual.rows.map((row, index) => ({ label: row.label, value: actual.cells[index][0] })),
  golden,
}, null, 2));
