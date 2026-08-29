/**
 * Verifies the second TabWin 4.15 capture batch that the current executor
 * already has enough semantics to reproduce. Raw DATASUS/TabWin assets remain
 * outside Git; only the tiny reference exports may be committed as fixtures.
 *
 * usage: node scripts/verify-second-goldens-local.mjs <asset-directory> <export-directory>
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfRecords } from '@precisa-saude/datasus-dbc';
import {
  compareWithGolden,
  compileQueryPlan,
  dimensionFromDefOption,
  executeInMemory,
  filterFromDefOption,
  frequencyMeasureFromDef,
  lookupDefinitionFromDefOption,
  sumMeasureFromDefIncrement,
} from '../dist/packages/core/src/index.js';
import { calculateColumnTotal } from '../dist/packages/analysis/src/table-operations.js';
import {
  optionsForRole,
  parseCnv,
  parseDef,
  parseTabWinBiffExport,
} from '../dist/packages/formats/src/index.js';

const assetDirectory = path.resolve(process.argv[2] ?? '');
const exportDirectory = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('usage: node scripts/verify-second-goldens-local.mjs <asset-directory> <export-directory>');
}

const decoder = new TextDecoder('windows-1252');

function normalizeExport(bytes, id) {
  const parsed = parseTabWinBiffExport(bytes, decoder);
  const labels = new Map(parsed.labels.map(({ row, column, value }) => [`${row}:${column}`, value]));
  const numbers = new Map(parsed.numbers.map(({ row, column, value }) => [`${row}:${column}`, value]));
  const columns = [];
  for (let column = 1; ; column++) {
    const label = labels.get(`2:${column}`);
    if (label === undefined || label === '' || label === 'Total') break;
    columns.push({ label });
  }
  assert.ok(columns.length, `${id}: no result columns`);

  const rows = [];
  const cells = [];
  let tabwinTotal;
  for (let row = 3; ; row++) {
    const label = labels.get(`${row}:0`);
    if (label === undefined) break;
    if (!label) continue;
    const values = columns.map((_, column) => {
      const value = numbers.get(`${row}:${column + 1}`);
      assert.notEqual(value, undefined, `${id}: missing r${row}c${column + 1}`);
      return value;
    });
    if (label === 'Total') {
      tabwinTotal = values[0];
      continue;
    }
    rows.push({ label });
    cells.push(values);
  }
  return {
    golden: {
      schema: 'tabwin-web.golden-table', version: 1, id,
      source: { referenceEngine: 'TabWin 4.15' }, rows, columns, cells,
    },
    tabwinTotal,
  };
}

async function records(name) {
  const output = [];
  for await (const record of readDbfRecords(dbcToDbf(await readFile(path.join(assetDirectory, name))))) {
    output.push(record);
  }
  return output;
}

async function dbfRecords(name) {
  const output = [];
  for await (const record of readDbfRecords(await readFile(path.join(assetDirectory, name)))) output.push(record);
  return output;
}

async function definition(name) {
  return parseDef(decoder.decode(await readFile(path.join(assetDirectory, name))));
}

async function conversion(name) {
  return parseCnv(decoder.decode(await readFile(path.join(assetDirectory, 'CNV', name))));
}

function option(def, role, label) {
  const found = optionsForRole(def, role).find((candidate) => candidate.label === label);
  assert.ok(found, `${label}: ${role} option missing`);
  return found;
}

const [rdDef, spDef, maDef, january, february, procedures, hospitalRows] = await Promise.all([
  definition('RD2008.DEF'), definition('SP2008.DEF'), definition('AIH_MA.DEF'), records('RDAC2401.dbc'),
  records('RDAC2402.dbc'), records('SPAC2401.dbc'), dbfRecords(path.join('DBF', 'TCNESAC.DBF')),
]);
const conversions = new Map();
// AIH_MA.DEF references its CNVs without the CNV\ prefix RD2008.DEF uses.
conversions.set('PERM.CNV', parseCnv(decoder.decode(await readFile(path.join(assetDirectory, 'PERM.CNV')))));
for (const name of ['BR_PNDR.CNV', 'BR_CAPITAL.CNV', 'BR_REGIAOUF.CNV', 'CID10CAP.CNV', 'COMPLEX2.CNV', 'CARATEND.CNV', 'NATJUR.CNV']) {
  conversions.set(name.toUpperCase(), await conversion(name));
}

function dimension(def, label) {
  return dimensionFromDefOption(option(def, 'row', label));
}

function registryFor(...dimensions) {
  return Object.fromEntries(dimensions.filter((dim) => dim.conversionId).map((dim) => {
    const base = path.win32.basename(dim.conversionId.replaceAll('/', '\\')).toUpperCase();
    const parsed = conversions.get(base);
    assert.ok(parsed, `${dim.conversionId}: conversion not loaded`);
    return [dim.conversionId, parsed];
  }));
}

const complex = dimension(rdDef, 'Complexidade do Procedimento');
const hospitalOption = option(rdDef, 'row', 'Hospital AC (CNES)');
const hospital = dimensionFromDefOption(hospitalOption);
const hospitalLookup = lookupDefinitionFromDefOption(hospitalOption, hospitalRows);
const cases = [
  {
    id: 'G006', records: january,
    spec: { rows: { ...dimension(rdDef, 'Mesorregião PNDR de Resid.'), unclassifiedPolicy: 'discriminate' }, measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
  {
    id: 'G008', records: january,
    spec: { rows: dimension(rdDef, 'Capital de Residência'), measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
  {
    id: 'G010', records: january, checkTotal: true,
    spec: { rows: dimension(rdDef, 'Região/UF de Residência'), measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
  {
    id: 'G014', records: procedures,
    spec: { rows: dimension(spDef, 'Diagnóstico CID10 (capítulo)'), measure: frequencyMeasureFromDef(spDef), filters: [], suppressZeroRows: true },
  },
  {
    id: 'G015', records: january, resources: { [hospital.lookupId]: hospitalLookup },
    spec: { rows: hospital, measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
  {
    id: 'G018', records: january,
    spec: {
      rows: complex, measure: { kind: 'count' }, suppressZeroRows: false,
      filters: [
        filterFromDefOption(option(rdDef, 'selection', 'Caráter atendimento'), [1]),
        filterFromDefOption(option(rdDef, 'selection', 'Complexidade do Procedimento'), [3]),
      ],
    },
  },
  {
    // G012: new-format N. Its "104-0" row holds no records of its own; it is
    // the subtotal parent 399-9 rolls into, via the 4-column indicator.
    id: 'G012', records: january, checkTotal: true,
    spec: { rows: dimension(rdDef, 'Natureza Jurídica'), measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
  {
    // G009: numeric-range CNV. AIH_MA.DEF declares start position 2 for
    // DIAS_PERM, but that does not apply to range mode — the value classifies
    // itself. Honouring it collapsed 3,932 of 4,315 records into "0 dias".
    id: 'G009', records: january, checkTotal: true,
    spec: { rows: dimension(maDef, 'Permanência'), measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
  {
    id: 'G021', records: [...january, ...february],
    spec: { rows: complex, measure: { kind: 'count' }, filters: [], suppressZeroRows: true },
  },
  {
    id: 'G017', records: january, resources: { [hospital.lookupId]: hospitalLookup },
    // VAL_TOT declares 2 decimals in the DBF header (see CompareGoldenOptions.decimalPlaces);
    // G003 already established that the real engine's float sum lands within a handful
    // of ULPs of ours, so compare at that precision rather than bit-for-bit.
    decimalPlaces: 2,
    spec: {
      rows: hospital,
      measure: { kind: 'count' },
      measures: [
        { kind: 'count' },
        sumMeasureFromDefIncrement(rdDef.increments.find((increment) => increment.field === 'VAL_TOT')),
        sumMeasureFromDefIncrement(rdDef.increments.find((increment) => increment.field === 'MORTE')),
      ],
      filters: [],
      suppressZeroRows: false,
    },
  },
];

const report = [];
for (const item of cases) {
  const bytes = await readFile(path.join(exportDirectory, `${item.id.toLowerCase()}.xls`));
  const reference = normalizeExport(bytes, item.id);
  const dimensions = [item.spec.rows, ...(item.spec.columns ? [item.spec.columns] : [])];
  const filterDimensions = item.spec.filters
    .filter((filter) => filter.conversionId)
    .map((filter) => ({ conversionId: filter.conversionId }));
  const registry = { ...registryFor(...dimensions, ...filterDimensions), ...(item.resources ?? {}) };
  const plan = compileQueryPlan({ compatibilityProfile: 'tabwin-4.15', ...item.spec });
  const actual = executeInMemory(item.records, plan, registry);
  const comparison = compareWithGolden(actual, reference.golden, {
    absoluteTolerance: 0,
    ...(item.decimalPlaces !== undefined ? { decimalPlaces: item.decimalPlaces } : {}),
  });
  const calculatedTotal = item.checkTotal
    ? calculateColumnTotal(actual, actual.columns[0].key, 'sum')
    : undefined;
  const totalMatches = !item.checkTotal || calculatedTotal === reference.tabwinTotal;
  report.push({
    id: item.id,
    pass: comparison.pass && totalMatches,
    recordsSeen: actual.recordsSeen,
    recordsAccepted: actual.recordsAccepted,
    rows: actual.rows.length,
    cellsDifferent: comparison.cellDiffs.length,
    labelsMatch: comparison.rowLabelsMatch && comparison.columnLabelsMatch,
    ...(item.checkTotal ? { tabwinTotal: reference.tabwinTotal, calculatedTotal, totalMatches } : {}),
    messages: comparison.messages,
  });
}

console.log(JSON.stringify(report, null, 2));
if (report.some((item) => !item.pass)) process.exitCode = 1;
