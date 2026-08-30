/**
 * Zero-tolerance verification of the G001–G005 golden corpus against the real
 * TabWin 4.15 exports, using the real RDAC2401.dbc / RD2008.DEF / CNV assets.
 *
 * Generalizes `verify-g001-local.mjs`, which hardcoded one case with a single
 * measure column. The normalization here reads any TabWin table export — 1D or
 * row × column — by locating the header row and stopping the column scan at the
 * engine's own "Total" column, and the row scan at its "Total" row. Those
 * totals are TabWin's presentation, not part of the analytical result our
 * executor produces, so they are evidence to record, never cells to compare.
 *
 * Assets stay outside the repository (they are large and redistribution-bound),
 * so this is a local script, not part of `npm run check`. The committed
 * fixtures under `fixtures/golden/` carry the normalized expectation instead.
 *
 * usage: node scripts/verify-goldens-local.mjs <asset-directory> <capture-root>
 *   asset-directory : holds RDAC2401.dbc, RD2008.DEF, COMPLEX2.CNV, CARATEND*.CNV
 *   capture-root    : holds g00N-capture/reference-tabwin415/result.xls
 */

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
  parseCnv,
  parseDef,
  parseTabWinBiffExport,
} from '../dist/packages/formats/src/index.js';

function normalizeWindowsNpmArgument(value) {
  if (!value || process.platform !== 'win32') return value;
  return value.replace(/^\^/, '').replace(/\^$/, '').replaceAll('^ ', ' ');
}

const assetDirectory = path.resolve(normalizeWindowsNpmArgument(process.argv[2]) ?? '');
const captureRoot = path.resolve(normalizeWindowsNpmArgument(process.argv[3]) ?? '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('usage: node scripts/verify-goldens-local.mjs <asset-directory> <capture-root>');
}

const textDecoder = new TextDecoder('windows-1252');
const EXPECTED_ASSET_HASHES = {
  'RDAC2401.dbc': '41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429',
  'RD2008.DEF': '15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652',
  'COMPLEX2.CNV': '680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F',
  'CARATEND.CNV': 'E57C08CD045E6EAB1403013D96C7782C963D17BDDF4864840A964B99155D27F8',
  'CARATENDc.CNV': '03773387349528331EEDB6E2158BFEE02AEC245A770826A28F45733BA3679537',
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

async function readVerifiedAsset(name) {
  const bytes = await readFile(path.join(assetDirectory, name));
  assert.equal(sha256(bytes), EXPECTED_ASSET_HASHES[name], `${name} SHA-256 mismatch`);
  return bytes;
}

/**
 * Normalizes a TabWin BIFF export into a GoldenTableV1.
 *
 * Layout observed in every real 4.15 export captured so far:
 *   r0            optional title (the .TAB path, or blank)
 *   r1            subtitle ("<measure> por <column> segundo <row>")
 *   r2            header: c0 = row dimension label, c1.. = column labels, last = "Total"
 *   r3..          data rows: c0 = row label, then values, last = row total
 *   last          "Total" row of column totals
 *
 * The trailing Total column/row are TabWin presentation. They are returned
 * separately as evidence, never folded into the comparable cells.
 */
function normalizeTabWinExport(bytes, id) {
  const parsed = parseTabWinBiffExport(bytes, textDecoder);
  const labels = new Map(parsed.labels.map(({ row, column, value }) => [`${row}:${column}`, value]));
  const numbers = new Map(parsed.numbers.map(({ row, column, value }) => [`${row}:${column}`, value]));

  const headerRow = 2;
  const columnLabels = [];
  for (let column = 1; ; column++) {
    const label = labels.get(`${headerRow}:${column}`);
    if (label === undefined || label === '' || label === 'Total') break;
    columnLabels.push(label);
  }
  assert.ok(columnLabels.length > 0, `${id}: export has no column headers at row ${headerRow}`);

  const rows = [];
  const totalsRow = [];
  for (let row = headerRow + 1; ; row++) {
    const label = labels.get(`${row}:0`);
    if (label === undefined) break;
    if (label === '') continue;
    const values = columnLabels.map((_, index) => {
      const value = numbers.get(`${row}:${index + 1}`);
      assert.notEqual(value, undefined, `${id}: missing value at r${row}c${index + 1} (${label})`);
      return value;
    });
    if (label === 'Total') { totalsRow.push(...values); continue; }
    rows.push({ label, values });
  }
  assert.ok(rows.length > 0, `${id}: export contains no result rows`);

  return {
    golden: {
      schema: 'tabwin-web.golden-table',
      version: 1,
      id,
      source: {
        referenceEngine: 'TabWin 4.15',
        notes: `Normalized from the lossless BIFF export; SHA-256 ${sha256(bytes)}. `
          + 'TabWin\'s own Total row/column are recorded as evidence, not compared.',
      },
      rows: rows.map(({ label }) => ({ label })),
      columns: columnLabels.map((label) => ({ label })),
      cells: rows.map(({ values }) => values),
    },
    evidence: {
      title: labels.get('0:0') ?? '',
      subtitle: labels.get('1:0') ?? '',
      rowDimensionLabel: labels.get(`${headerRow}:0`) ?? '',
      tabwinColumnTotals: totalsRow,
      tabwinRowTotals: rows.map(({ label }, index) => ({
        label,
        total: numbers.get(`${headerRow + 1 + index}:${columnLabels.length + 1}`),
      })).filter((entry) => entry.total !== undefined),
    },
  };
}

const [dbcBytes, defBytes, complexCnvBytes, caratendCnvBytes, caratendColumnCnvBytes] = await Promise.all([
  readVerifiedAsset('RDAC2401.dbc'),
  readVerifiedAsset('RD2008.DEF'),
  readVerifiedAsset('COMPLEX2.CNV'),
  readVerifiedAsset('CARATEND.CNV'),
  readVerifiedAsset('CARATENDc.CNV'),
]);

const definition = parseDef(textDecoder.decode(defBytes));

function dimensionFor(role, label) {
  const option = optionsForRole(definition, role).find((candidate) => candidate.label === label);
  assert.ok(option, `RD2008.DEF has no ${role} option labelled "${label}"`);
  return dimensionFromDefOption(option);
}

function incrementLabelFor(field) {
  const increment = definition.increments.find((candidate) => candidate.field.toUpperCase() === field);
  assert.ok(increment, `RD2008.DEF has no increment for ${field}`);
  return increment.label.trim();
}

const complexRow = dimensionFor('row', 'Complexidade do Procedimento');
const caratendColumn = dimensionFor('column', 'Caráter atendimento');
const caratendSelection = dimensionFor('selection', 'Caráter atendimento');

const conversions = {
  [complexRow.conversionId]: parseCnv(textDecoder.decode(complexCnvBytes)),
  [caratendColumn.conversionId]: parseCnv(textDecoder.decode(caratendColumnCnvBytes)),
  [caratendSelection.conversionId]: parseCnv(textDecoder.decode(caratendCnvBytes)),
};

const CASES = [
  {
    id: 'G001',
    semantic: 'frequência por dimensão única com CNV',
    captureDirectory: 'g001-capture',
    spec: { rows: complexRow, measure: { kind: 'count' }, filters: [], suppressZeroRows: false },
  },
  {
    id: 'G002',
    semantic: 'tabulação linha × coluna',
    captureDirectory: 'g002-capture',
    spec: {
      rows: complexRow,
      columns: caratendColumn,
      measure: { kind: 'count' },
      filters: [],
      suppressZeroRows: false,
      suppressZeroColumns: false,
    },
  },
  {
    id: 'G003',
    semantic: 'medida de soma (VAL_TOT) em vez de frequência',
    captureDirectory: 'g003-capture',
    // Label comes from the DEF increment ("IValor Total,VAL_TOT"), which G003
    // proved is what the real engine puts in the header.
    spec: {
      rows: complexRow,
      measure: { kind: 'sum', field: 'VAL_TOT', label: incrementLabelFor('VAL_TOT') },
      filters: [],
      suppressZeroRows: false,
    },
    // VAL_TOT declares 2 decimals in the DBF header; see CompareGoldenOptions.
    decimalPlaces: 2,
  },
  {
    id: 'G004',
    semantic: 'seleção ancorada em CNV (só "01 Eletivo")',
    captureDirectory: 'g004-capture',
    spec: {
      rows: complexRow,
      measure: { kind: 'count' },
      filters: [{
        field: caratendSelection.field,
        conversionId: caratendSelection.conversionId,
        startPosition: caratendSelection.startPosition,
        acceptedCategories: ['1'],
      }],
      suppressZeroRows: false,
    },
  },
  {
    id: 'G005',
    semantic: 'supressão de linhas zeradas',
    captureDirectory: 'g005-capture',
    spec: { rows: complexRow, measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
];

const metadata = readDbcMetadata(dbcBytes);
const records = [];
for await (const record of readDbfRecords(dbcToDbf(dbcBytes))) records.push(record);
assert.equal(records.length, metadata.recordCount, 'decoded record count mismatch');

const report = { tolerance: 0, records: { declared: metadata.recordCount, decoded: records.length }, cases: [] };
let failures = 0;

for (const testCase of CASES) {
  const exportPath = path.join(captureRoot, testCase.captureDirectory, 'reference-tabwin415', 'result.xls');
  const exportBytes = await readFile(exportPath);
  const { golden, evidence } = normalizeTabWinExport(exportBytes, testCase.id);

  const plan = compileQueryPlan({ compatibilityProfile: 'tabwin-4.15', ...testCase.spec });
  const actual = executeInMemory(records, plan, conversions);
  const comparison = compareWithGolden(actual, golden, {
    absoluteTolerance: 0,
    ...(testCase.decimalPlaces !== undefined ? { decimalPlaces: testCase.decimalPlaces } : {}),
  });
  if (!comparison.pass) failures++;

  report.cases.push({
    id: testCase.id,
    semantic: testCase.semantic,
    pass: comparison.pass,
    referenceExport: { path: exportPath, bytes: exportBytes.byteLength, sha256: sha256(exportBytes) },
    rowLabelsMatch: comparison.rowLabelsMatch,
    columnLabelsMatch: comparison.columnLabelsMatch,
    shapeMatch: comparison.shapeMatch,
    comparedAtDecimalPlaces: testCase.decimalPlaces ?? null,
    cellDiffCount: comparison.cellDiffs.length,
    cellDiffs: comparison.cellDiffs,
    messages: comparison.messages,
    records: { seen: actual.recordsSeen, accepted: actual.recordsAccepted },
    shape: { rows: golden.rows.length, columns: golden.columns.length },
    tabwinPresentation: evidence,
    golden,
    actual: {
      rows: actual.rows.map((row) => row.label),
      columns: actual.columns.map((column) => column.label),
      cells: actual.cells,
    },
  });
}

report.pass = failures === 0;
report.failedCases = failures;
console.log(JSON.stringify(report, null, 2));
if (failures) process.exitCode = 1;
