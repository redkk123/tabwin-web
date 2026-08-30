import assert from 'node:assert/strict';
import test from 'node:test';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { executeInMemory } from '../dist/packages/core/src/execute.js';
import { fieldsUsedByPlan } from '../dist/packages/core/src/plan-fields.js';

const SPEC = {
  rows: { field: 'UF' },
  columns: { field: 'SEXO' },
  measure: { kind: 'sum', field: 'VALOR' },
  filters: [
    { field: 'IDADE', kind: 'numeric-range', minimum: 10 },
    { field: 'MUNIC', acceptedCategories: ['120040', '355030'] },
  ],
  crossFieldRules: [{
    id: 'gestante-idade',
    label: 'Gestante com idade improvável',
    action: 'exclude',
    conditions: [
      { field: 'GESTANT', acceptedCategories: ['1'] },
      { field: 'IDADE', kind: 'numeric-range', minimum: 60 },
    ],
  }],
};

const RECORDS = Array.from({ length: 200 }, (_, index) => ({
  UF: ['AC', 'SP'][index % 2],
  SEXO: ['1', '2'][index % 2],
  VALOR: index % 17,
  IDADE: index % 90,
  MUNIC: ['120040', '355030', '999999'][index % 3],
  GESTANT: ['1', '6'][index % 2],
  // Fields the plan never names; projection must be free to drop them.
  OBSERVACAO: `texto ${index}`,
  CNS: String(700000000000000 + index),
  DT_NOTIF: new Date(Date.UTC(2025, index % 12, 1)),
}));

test('plan fields enumerate every source field the executor can read', () => {
  const used = fieldsUsedByPlan(compileQueryPlan(SPEC)).sort();
  assert.deepEqual(used, ['GESTANT', 'IDADE', 'MUNIC', 'SEXO', 'UF', 'VALOR']);
});

test('projecting records to the plan fields does not change the result', () => {
  const plan = compileQueryPlan(SPEC);
  const used = fieldsUsedByPlan(plan);
  const projected = RECORDS.map((record) => Object.fromEntries(
    used.map((field) => [field, record[field]]),
  ));

  // This is the guarantee the columnar path depends on: if some future spec
  // option reads a field that fieldsUsedByPlan forgets, this diverges.
  assert.deepEqual(executeInMemory(projected, plan), executeInMemory(RECORDS, plan));
});

test('weight fields and column-free specs are enumerated too', () => {
  assert.deepEqual(
    fieldsUsedByPlan(compileQueryPlan({
      rows: { field: 'UF' },
      measure: { kind: 'count', weightField: 'PESO' },
      filters: [],
    })).sort(),
    ['PESO', 'UF'],
  );
  assert.deepEqual(
    fieldsUsedByPlan(compileQueryPlan({ rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [] })),
    ['UF'],
  );
});
