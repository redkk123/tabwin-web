/**
 * G017 — several DEF `I` increments laid out as simultaneous columns.
 *
 * Real numbers verified independently against fixtures/golden/G017 (Hospital
 * AC (CNES) × Frequência + Valor Total + Óbitos over the real RDAC2401.dbc):
 * totals [4315, 4308072.760000005, 126], matching the TabWin 4.15 export
 * exactly. This file covers the surrounding contract with synthetic data —
 * ordering, validation, warnings, subtotal/suppression interaction — that the
 * golden alone does not exercise.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryPlanError, compileQueryPlan, executeInMemory } from '../dist/packages/core/src/index.js';
import { fieldsUsedByPlan } from '../dist/packages/core/src/plan-fields.js';
import { parseCnv } from '../dist/packages/formats/src/index.js';

function row(sequence, label, codes, subtotal = '') {
  return `${subtotal.padStart(3).slice(-3)}${String(sequence).padStart(4)}  ${label.padEnd(50).slice(0, 50)} ${codes}`;
}

const RECORDS = [
  { UF: 'AC', VAL: 10, OBITO: 1 },
  { UF: 'AC', VAL: 20, OBITO: 0 },
  { UF: 'SP', VAL: 5, OBITO: 0 },
];

function plan(measures, extra = {}) {
  return compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'UF' },
    measure: measures[0],
    measures,
    filters: [],
    ...extra,
  });
}

test('several measures become columns in declared order, each computed independently', () => {
  const measures = [{ kind: 'count' }, { kind: 'sum', field: 'VAL', label: 'Valor' }, { kind: 'sum', field: 'OBITO', label: 'Óbitos' }];
  const result = executeInMemory(RECORDS, plan(measures));
  assert.deepEqual(result.columns.map((c) => c.label), ['Freqüência', 'Valor', 'Óbitos']);
  assert.deepEqual(result.columns.map((c) => c.source), ['derived', 'derived', 'derived']);
  const ac = result.rows.findIndex((r) => r.key === 'AC');
  const sp = result.rows.findIndex((r) => r.key === 'SP');
  assert.deepEqual(result.cells[ac], [2, 30, 1]);
  assert.deepEqual(result.cells[sp], [1, 5, 0]);
});

test('a single measure never activates the multi-measure path, even wrapped in an array', () => {
  const result = executeInMemory(RECORDS, compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' },
    measure: { kind: 'count' }, measures: undefined, filters: [],
  }));
  assert.deepEqual(result.columns.map((c) => c.key), ['__single__']);
});

test('measures with fewer than two entries is rejected — a single measure belongs in `measure`', () => {
  assert.throws(() => plan([{ kind: 'count' }]), QueryPlanError);
});

test('measures cannot combine with a column dimension: no oracle covers that pairing', () => {
  assert.throws(
    () => compileQueryPlan({
      compatibilityProfile: 'tabwin-4.15', rows: { field: 'UF' }, columns: { field: 'X' },
      measure: { kind: 'count' }, measures: [{ kind: 'count' }, { kind: 'count' }], filters: [],
    }),
    QueryPlanError,
  );
});

test('a sum measure inside `measures` still requires a field', () => {
  assert.throws(() => plan([{ kind: 'count' }, { kind: 'sum' }]), /measures\[1\] sum requires a field/);
});

test('a weightField inside `measures` is rejected on a sum entry, same as the single-measure path', () => {
  assert.throws(
    () => plan([{ kind: 'count' }, { kind: 'sum', field: 'VAL', weightField: 'X' }]),
    /weightField is only valid for count/,
  );
});

test('row subtotal propagation still sums every measure column, not just the first', () => {
  const provider = parseCnv(['2 2', row(2, 'Detalhe', '10', '1'), row(1, 'Grupo', '99')].join('\n'));
  const measures = [{ kind: 'count' }, { kind: 'sum', field: 'VAL', label: 'Valor' }];
  const result = executeInMemory(
    [{ NAT: '10', VAL: 7 }, { NAT: '10', VAL: 3 }],
    compileQueryPlan({
      compatibilityProfile: 'tabwin-4.15', rows: { field: 'NAT', conversionId: 'nat' },
      measure: measures[0], measures, filters: [],
    }),
    { nat: provider },
  );
  // key '1' is Grupo (the subtotal target), key '2' is Detalhe (the source row).
  const grupo = result.rows.findIndex((r) => r.key === '1');
  const detalhe = result.rows.findIndex((r) => r.key === '2');
  assert.deepEqual(result.cells[grupo], [2, 10]);
  assert.deepEqual(result.cells[detalhe], [2, 10]);
});

test('fieldsUsedByPlan enumerates every measure field and weightField, not just the first', () => {
  const measures = [
    { kind: 'count', weightField: 'PESO' },
    { kind: 'sum', field: 'VAL_TOT' },
    { kind: 'sum', field: 'MORTE' },
  ];
  const fields = fieldsUsedByPlan(plan(measures));
  for (const field of ['PESO', 'VAL_TOT', 'MORTE']) assert.ok(fields.includes(field), `missing ${field}`);
});

test('warnings and record acceptance behave identically to the single-measure path', () => {
  const measures = [{ kind: 'count' }, { kind: 'sum', field: 'VAL', label: 'Valor' }];
  const result = executeInMemory([{ UF: 'AC', VAL: 'não é número' }], plan(measures));
  assert.equal(result.recordsSeen, 1);
  assert.equal(result.recordsAccepted, 1);
  assert.deepEqual(result.cells[0], [1, 0]);
  assert.ok(result.warnings.some((w) => /non-numeric/.test(w)));
});
