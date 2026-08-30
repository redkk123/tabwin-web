import assert from 'node:assert/strict';
import test from 'node:test';
import { createTabulationResultCache } from '../dist/packages/core/src/tabulation-cache.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { executeInMemory } from '../dist/packages/core/src/execute.js';

const RECORDS = [
  { UF: 'AC', SEXO: '1', IDADE: 20 },
  { UF: 'AC', SEXO: '2', IDADE: 30 },
  { UF: 'SP', SEXO: '1', IDADE: 40 },
];

function planFor(rowField, filters = []) {
  return compileQueryPlan({ rows: { field: rowField }, measure: { kind: 'count' }, filters });
}

test('a cached result is returned unchanged for the exact same plan and conversions', () => {
  const cache = createTabulationResultCache();
  const plan = planFor('UF');
  const result = executeInMemory(RECORDS, plan);

  assert.equal(cache.get({ plan, conversions: {} }), undefined, 'nothing cached yet');
  cache.set({ plan, conversions: {} }, result);

  // A fresh plan object with the same content must still hit: the key is the
  // plan's content, not its identity.
  const samePlanAgain = planFor('UF');
  assert.deepEqual(cache.get({ plan: samePlanAgain, conversions: {} }), result);
  assert.equal(cache.size, 1);
});

test('a different plan is a genuine miss, never a stale hit', () => {
  const cache = createTabulationResultCache();
  const planA = planFor('UF');
  const planB = planFor('SEXO');
  cache.set({ plan: planA, conversions: {} }, executeInMemory(RECORDS, planA));

  assert.equal(cache.get({ plan: planB, conversions: {} }), undefined);
  assert.equal(cache.size, 1, 'the miss must not have inserted anything');
});

test('filter order changes the key, because it can change which plan actually ran', () => {
  const cache = createTabulationResultCache();
  const forward = planFor('UF', [
    { field: 'SEXO', acceptedCategories: ['1'] },
    { field: 'IDADE', kind: 'numeric-range', minimum: 0 },
  ]);
  const swapped = planFor('UF', [
    { field: 'IDADE', kind: 'numeric-range', minimum: 0 },
    { field: 'SEXO', acceptedCategories: ['1'] },
  ]);
  cache.set({ plan: forward, conversions: {} }, executeInMemory(RECORDS, forward));
  assert.equal(cache.get({ plan: swapped, conversions: {} }), undefined);
});

test('conversions are part of the key: the same plan over a different CNV is a different answer', () => {
  const cache = createTabulationResultCache();
  const plan = planFor('UF');
  const result = executeInMemory(RECORDS, plan);
  const cnv = {
    header: { increment: 1, decimals: 0 },
    categories: [{ codes: [{ from: '1', to: '1' }], sequence: 0, label: 'Um' }],
  };
  cache.set({ plan, conversions: {} }, result);
  assert.equal(cache.get({ plan, conversions: { SEXO: cnv } }), undefined);
});

test('clear invalidates every entry, because a data change stales the whole cache at once', () => {
  const cache = createTabulationResultCache();
  const planA = planFor('UF');
  const planB = planFor('SEXO');
  cache.set({ plan: planA, conversions: {} }, executeInMemory(RECORDS, planA));
  cache.set({ plan: planB, conversions: {} }, executeInMemory(RECORDS, planB));
  assert.equal(cache.size, 2);

  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get({ plan: planA, conversions: {} }), undefined);
  assert.equal(cache.get({ plan: planB, conversions: {} }), undefined);
});

test('past capacity, the least recently used entry is evicted first', () => {
  const cache = createTabulationResultCache(2);
  const plans = ['UF', 'SEXO', 'IDADE'].map((field) => planFor(field));
  const results = plans.map((plan) => executeInMemory(RECORDS, plan));

  cache.set({ plan: plans[0], conversions: {} }, results[0]);
  cache.set({ plan: plans[1], conversions: {} }, results[1]);
  // Touch plans[0] so plans[1] becomes the least recently used, not plans[0].
  cache.get({ plan: plans[0], conversions: {} });
  cache.set({ plan: plans[2], conversions: {} }, results[2]);

  assert.equal(cache.size, 2);
  assert.equal(cache.get({ plan: plans[1], conversions: {} }), undefined, 'the untouched entry must be the one evicted');
  assert.deepEqual(cache.get({ plan: plans[0], conversions: {} }), results[0]);
  assert.deepEqual(cache.get({ plan: plans[2], conversions: {} }), results[2]);
});

test('rejects a capacity that could not hold anything', () => {
  assert.throws(() => createTabulationResultCache(0), /limite inválido/);
  assert.throws(() => createTabulationResultCache(-1), /limite inválido/);
  assert.throws(() => createTabulationResultCache(1.5), /limite inválido/);
});
