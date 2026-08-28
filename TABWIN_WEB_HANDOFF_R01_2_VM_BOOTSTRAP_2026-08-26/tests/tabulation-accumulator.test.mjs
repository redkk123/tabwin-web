import assert from 'node:assert/strict';
import test from 'node:test';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { createTabulationAccumulator, executeInMemory } from '../dist/packages/core/src/execute.js';

const UFS = ['AC', 'SP', 'RJ', 'MG'];
const SEXOS = ['1', '2', '3'];

/** Deterministic, with repeated keys so cells accumulate across batches. */
const RECORDS = Array.from({ length: 500 }, (_, index) => ({
  UF: UFS[index % UFS.length],
  SEXO: SEXOS[index % SEXOS.length],
  IDADE: index % 90,
  VALOR: (index % 37) + (index % 7) / 10,
}));

function inBatches(records, plan, size) {
  const accumulator = createTabulationAccumulator(plan);
  for (let offset = 0; offset < records.length; offset += size) {
    accumulator.push(records.slice(offset, offset + size));
  }
  return accumulator.finish();
}

const SPECS = {
  'frequência simples': {
    rows: { field: 'UF' }, measure: { kind: 'count' }, filters: [],
  },
  'linha x coluna': {
    rows: { field: 'UF' }, columns: { field: 'SEXO' }, measure: { kind: 'count' }, filters: [],
  },
  'soma com filtro e supressão': {
    rows: { field: 'UF' },
    columns: { field: 'SEXO' },
    measure: { kind: 'sum', field: 'VALOR' },
    filters: [{ field: 'IDADE', kind: 'numeric-range', minimum: 10, maximum: 80 }],
    suppressZeroRows: true,
    suppressZeroColumns: true,
  },
  'com regra cruzada que exclui': {
    rows: { field: 'UF' },
    measure: { kind: 'count' },
    filters: [],
    crossFieldRules: [{
      id: 'sexo-idade',
      label: 'Sexo ignorado com idade alta',
      action: 'exclude',
      conditions: [
        { field: 'SEXO', acceptedCategories: ['3'] },
        { field: 'IDADE', kind: 'numeric-range', minimum: 60 },
      ],
    }],
  },
};

test('batched accumulation equals one-shot execution for every spec shape', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    const plan = compileQueryPlan(spec);
    const expected = executeInMemory(RECORDS, plan);
    // 1 exercises a batch per record; 500 is the whole set in one push.
    for (const size of [1, 7, 64, 499, 500, 1000]) {
      assert.deepEqual(inBatches(RECORDS, plan, size), expected, `${name} divergiu com lotes de ${size}`);
    }
  }
});

test('accumulated numbers are identical, not merely close', () => {
  const plan = compileQueryPlan(SPECS['soma com filtro e supressão']);
  const expected = executeInMemory(RECORDS, plan);
  const batched = inBatches(RECORDS, plan, 13);
  assert.equal(JSON.stringify(batched.cells), JSON.stringify(expected.cells));
  assert.equal(batched.recordsSeen, 500);
  assert.equal(batched.recordsAccepted, expected.recordsAccepted);
});

test('an accumulator that never receives records yields an empty, valid result', () => {
  const plan = compileQueryPlan(SPECS['frequência simples']);
  const result = createTabulationAccumulator(plan).finish();
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.cells, []);
  assert.equal(result.recordsSeen, 0);
  assert.equal(result.recordsAccepted, 0);
  assert.deepEqual(result, executeInMemory([], plan));
});

test('finish can be called repeatedly while more batches arrive', () => {
  const plan = compileQueryPlan(SPECS['linha x coluna']);
  const accumulator = createTabulationAccumulator(plan);
  accumulator.push(RECORDS.slice(0, 100));
  const partial = accumulator.finish();
  assert.equal(partial.recordsSeen, 100);

  accumulator.push(RECORDS.slice(100));
  const complete = accumulator.finish();
  assert.equal(complete.recordsSeen, 500);
  assert.deepEqual(complete, executeInMemory(RECORDS, plan));
  // The earlier snapshot must not have been mutated by the later batch.
  assert.equal(partial.recordsSeen, 100);
});

test('cross-field rule counts survive batching', () => {
  const plan = compileQueryPlan(SPECS['com regra cruzada que exclui']);
  const expected = executeInMemory(RECORDS, plan);
  assert.ok(expected.dataQuality[0].matchedRecords > 0, 'a amostra precisa acionar a regra');
  assert.deepEqual(inBatches(RECORDS, plan, 9).dataQuality, expected.dataQuality);
});
