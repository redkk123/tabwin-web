import assert from 'node:assert/strict';
import test from 'node:test';
import { compileQueryPlan, executeInMemory } from '../dist/packages/core/src/index.js';
import { parseCnv } from '../dist/packages/formats/src/index.js';

function row(sequence, label, codes, subtotal = '') {
  return `${subtotal.padStart(3).slice(-3)}${String(sequence).padStart(4)}  ${label.padEnd(50).slice(0, 50)} ${codes}`;
}

const monthCnv = parseCnv(['3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n'));

test('executes deterministic count tabulation with CNV categories', () => {
  const plan = compileQueryPlan({ compatibilityProfile: 'tabwin-4.15', rows: { field: 'MES', conversionId: 'mes' }, measure: { kind: 'count' }, filters: [] });
  const result = executeInMemory([{ MES: '01' }, { MES: '01' }, { MES: '02' }, { MES: '88' }], plan, { mes: monthCnv });
  assert.deepEqual(result.rows.map((r) => r.label), ['Janeiro', 'Fevereiro', 'Ignorado']);
  assert.deepEqual(result.columns.map((column) => column.label), ['Freqüência']);
  assert.deepEqual(result.cells, [[2], [1], [1]]);
  assert.equal(result.recordsSeen, 4);
  assert.equal(result.recordsAccepted, 4);
});

test('conversion-backed filters use category sequence ids', () => {
  const plan = compileQueryPlan({ compatibilityProfile: 'tabwin-4.15', rows: { field: 'MES', conversionId: 'mes' }, measure: { kind: 'count' }, filters: [{ field: 'MES', conversionId: 'mes', acceptedCategories: ['1'] }] });
  const result = executeInMemory([{ MES: '01' }, { MES: '02' }, { MES: '01' }], plan, { mes: monthCnv });
  assert.deepEqual(result.cells, [[2], [0], [0]]);
  assert.equal(result.recordsAccepted, 2);
});

test('zero-row suppression occurs after materializing CNV categories', () => {
  const plan = compileQueryPlan({ compatibilityProfile: 'tabwin-4.15', rows: { field: 'MES', conversionId: 'mes' }, measure: { kind: 'count' }, filters: [], suppressZeroRows: true });
  const result = executeInMemory([{ MES: '01' }], plan, { mes: monthCnv });
  assert.deepEqual(result.rows.map((r) => r.label), ['Janeiro']);
  assert.deepEqual(result.cells, [[1]]);
});

test('row subtotal semantics add detail rows into subtotal rows', () => {
  const provider = parseCnv(['3 2', row(1, 'Publico', '99'), row(2, 'Federal', '10', '1'), row(3, 'Estadual', '20', '1')].join('\n'));
  const plan = compileQueryPlan({ compatibilityProfile: 'tabwin-4.15', rows: { field: 'NAT', conversionId: 'nat' }, measure: { kind: 'count' }, filters: [] });
  const result = executeInMemory([{ NAT: '10' }, { NAT: '10' }, { NAT: '20' }], plan, { nat: provider });
  assert.deepEqual(result.cells, [[3], [2], [1]]);
});

test('supports row x column sum tabulation', () => {
  const plan = compileQueryPlan({ compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, columns: { field: 'ANO' }, measure: { kind: 'sum', field: 'VALOR' }, filters: [] });
  const result = executeInMemory([{ UF: 'AC', ANO: '2024', VALOR: 10 }, { UF: 'AC', ANO: '2025', VALOR: 5 }, { UF: 'DF', ANO: '2024', VALOR: 3 }], plan);
  assert.deepEqual(result.rows.map((r) => r.key), ['AC', 'DF']);
  assert.deepEqual(result.columns.map((c) => c.key), ['2024', '2025']);
  assert.deepEqual(result.cells, [[10, 5], [3, 0]]);
});

import { parseRecipe, serializeRecipe } from '../dist/packages/core/src/index.js';

test('analysis recipe serialization is deterministic and round-trippable', () => {
  const recipe = {
    schema: 'tabwin-web.recipe',
    version: 1,
    name: 'Fixture simples',
    spec: {
      compatibilityProfile: 'tabwin-4.15',
      rows: { field: 'UF' },
      measure: { kind: 'count' },
      filters: [],
    },
    conversions: [],
    sourceHints: [{ name: 'fixture.dbc', sha256: 'abc', size: 123 }],
    resultOperations: [{
      kind: 'factor', sourceColumnKey: '__single__', factor: 100,
      output: { key: '__derived_1', label: 'Índice', totalPolicy: 'mean' },
    }],
    view: {
      tableSortColumnKey: '__derived_1', tableSortDirection: 'descending',
      tableDecimalPlaces: 2, tableKeyVisible: false,
    },
  };
  const a = serializeRecipe(recipe);
  const b = serializeRecipe({ ...recipe });
  assert.equal(a, b);
  assert.deepEqual(parseRecipe(a), recipe);
});

test('multiple filters are intersected deterministically', () => {
  const plan = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'UF' },
    measure: { kind: 'count' },
    filters: [
      { field: 'ANO', acceptedCategories: ['2024'] },
      { field: 'SEXO', acceptedCategories: ['1', '3'] },
    ],
  });
  const result = executeInMemory([
    { UF: 'AC', ANO: '2024', SEXO: '1' },
    { UF: 'AC', ANO: '2025', SEXO: '1' },
    { UF: 'DF', ANO: '2024', SEXO: '2' },
    { UF: 'DF', ANO: '2024', SEXO: '3' },
  ], plan);
  assert.equal(result.recordsAccepted, 2);
  assert.deepEqual(result.cells, [[1], [1]]);
});

test('analysis recipe parsing rejects structurally invalid plans and fingerprints', () => {
  assert.throws(() => parseRecipe(JSON.stringify({
    schema: 'tabwin-web.recipe', version: 1,
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: '' }, measure: { kind: 'count' }, filters: [] },
    conversions: [], sourceHints: [],
  })), /row field is required/);
  assert.throws(() => parseRecipe(JSON.stringify({
    schema: 'tabwin-web.recipe', version: 1,
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [] },
    conversions: [{ id: 'x' }], sourceHints: [],
  })), /invalid conversion fingerprint/);
  assert.throws(() => parseRecipe(JSON.stringify({
    schema: 'tabwin-web.recipe', version: 1,
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [] },
    conversions: [], sourceHints: [], view: { chartType: 'unknown' },
  })), /invalid chart type/);
  assert.throws(() => parseRecipe(JSON.stringify({
    schema: 'tabwin-web.recipe', version: 1,
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [] },
    conversions: [], sourceHints: [], view: { mapClassification: 'natural-breaks', mapClassCount: 20 },
  })), /invalid map classification/);
  assert.throws(() => parseRecipe(JSON.stringify({
    schema: 'tabwin-web.recipe', version: 1,
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [] },
    conversions: [], sourceHints: [], view: { statisticsOperation: 'anova', histogramBins: 100 },
  })), /invalid statistics operation/);
  assert.throws(() => parseRecipe(JSON.stringify({
    schema: 'tabwin-web.recipe', version: 1,
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [] },
    conversions: [], sourceHints: [], resultOperations: [{
      kind: 'factor', sourceColumnKey: 'x', factor: 'cem',
      output: { key: 'bad', label: 'Inválida', totalPolicy: 'sum' },
    }],
  })), /invalid factor operation/);
  assert.throws(() => parseRecipe(JSON.stringify({
    schema: 'tabwin-web.recipe', version: 1,
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [] },
    conversions: [], sourceHints: [], view: { tableSortDirection: 'random', tableDecimalPlaces: 12 },
  })), /invalid table sort direction/);
});

test('DEF-style startPosition slices a composite DBF field before CNV conversion', () => {
  const defMonths = parseCnv(['3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n'));
  const plan = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'DATAOBITO', startPosition: 3, conversionId: 'mes' },
    measure: { kind: 'count' },
    filters: [],
  });
  const result = executeInMemory(
    [{ DATAOBITO: '240115' }, { DATAOBITO: '240201' }, { DATAOBITO: '240228' }],
    plan,
    { mes: defMonths },
  );
  assert.deepEqual(result.cells, [[1], [2], [0]]);
});

test('DEF-style startPosition is also honored by conversion-backed filters', () => {
  const defMonths = parseCnv(['3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n'));
  const plan = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'UF' },
    measure: { kind: 'count' },
    filters: [{ field: 'DATAOBITO', startPosition: 3, conversionId: 'mes', acceptedCategories: ['2'] }],
  });
  const result = executeInMemory(
    [{ UF: 'AC', DATAOBITO: '240115' }, { UF: 'AC', DATAOBITO: '240201' }, { UF: 'DF', DATAOBITO: '240228' }],
    plan,
    { mes: defMonths },
  );
  assert.equal(result.recordsAccepted, 2);
  assert.deepEqual(result.cells, [[1], [1]]);
});

import {
  compareWithGolden,
  dimensionFromDefOption,
  filterFromDefOption,
  frequencyMeasureFromDef,
  sumMeasureFromDefIncrement,
} from '../dist/packages/core/src/index.js';
import { parseDef } from '../dist/packages/formats/src/index.js';

test('DEF G directive becomes weighted frequency instead of literal record count', () => {
  const plan = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'UF' },
    measure: { kind: 'count', weightField: 'QUANTIDADE' },
    filters: [],
  });
  const result = executeInMemory([
    { UF: 'AC', QUANTIDADE: 4 },
    { UF: 'AC', QUANTIDADE: 3 },
    { UF: 'DF', QUANTIDADE: 10 },
  ], plan);
  assert.deepEqual(result.cells, [[7], [10]]);
});

test('DEF bridge compiles conversion option, filter, frequency and increment measure', () => {
  const def = parseDef(`; bridge\nA*.DBF\nGQUANTIDADE\nTSexo,SEXO,1,SEXO.CNV\nIValor Total,VALOR_TOT`);
  const option = def.options[0];
  assert.deepEqual(dimensionFromDefOption(option), {
    field: 'SEXO', conversionId: 'SEXO.CNV', startPosition: 1,
  });
  assert.deepEqual(filterFromDefOption(option, [1, 2]), {
    field: 'SEXO', conversionId: 'SEXO.CNV', startPosition: 1, acceptedCategories: ['1', '2'],
  });
  assert.deepEqual(frequencyMeasureFromDef(def), { kind: 'count', weightField: 'QUANTIDADE' });
  assert.deepEqual(sumMeasureFromDefIncrement(def.increments[0]), { kind: 'sum', field: 'VALOR_TOT' });
});

test('golden comparator requires exact labels, shape and cells by default', () => {
  const plan = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'UF' },
    measure: { kind: 'count' },
    filters: [],
  });
  const result = executeInMemory([{ UF: 'AC' }, { UF: 'DF' }, { UF: 'DF' }], plan);
  const golden = {
    schema: 'tabwin-web.golden-table', version: 1, id: 'SYNTH-001',
    source: { referenceEngine: 'TabWin 4.15 synthetic capture' },
    rows: [{ label: 'AC' }, { label: 'DF' }], columns: [{ label: 'Freqüência' }],
    cells: [[1], [2]],
  };
  assert.equal(compareWithGolden(result, golden).pass, true);
  golden.cells[1][0] = 3;
  const diff = compareWithGolden(result, golden);
  assert.equal(diff.pass, false);
  assert.deepEqual(diff.cellDiffs, [{ row: 1, column: 0, expected: 3, actual: 2, delta: -1 }]);
});
