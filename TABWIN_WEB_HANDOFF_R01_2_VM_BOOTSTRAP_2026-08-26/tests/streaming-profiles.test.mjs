import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDistinctValueCollector,
  createFieldCombinationProfiler,
  createNumericFieldProfiler,
  profileFieldCombinations,
  profileNumericField,
} from '../dist/packages/analysis/src/data-quality.js';
import { createSelectedRecordCollector } from '../dist/packages/export/src/selected-records.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { executeInMemory } from '../dist/packages/core/src/execute.js';

const RECORDS = [
  { UF: 'AC', IDADE: 20, SEXO: 'F' },
  { UF: 'SP', IDADE: '21', SEXO: 'M' },
  { UF: 'SP', IDADE: '22,5', SEXO: 'F' },
  { UF: 'RJ', IDADE: 23, SEXO: 'M' },
  { UF: 'AC', IDADE: 90, SEXO: 'F' },
  { UF: 'MG', IDADE: '', SEXO: 'M' },
  { UF: 'MG', IDADE: null, SEXO: 'F' },
  { UF: 'RJ', IDADE: 'desconhecida', SEXO: 'M' },
  ...Array.from({ length: 120 }, (_, index) => ({
    UF: ['AC', 'SP', 'RJ', 'MG', 'BA'][index % 5],
    IDADE: index % 80,
    SEXO: index % 2 ? 'F' : 'M',
  })),
];

function feed(accumulator, records, size) {
  for (let offset = 0; offset < records.length; offset += size) {
    accumulator.push(records.slice(offset, offset + size));
  }
  return accumulator.finish();
}

test('batched numeric profiling equals the one-shot profile', () => {
  const expected = profileNumericField(RECORDS, 'IDADE');
  assert.equal(expected.totalRecords, RECORDS.length);
  assert.equal(expected.missingRecords, 2);
  assert.equal(expected.invalidRecords, 1);

  for (const size of [1, 3, 17, 127, 128, 500]) {
    assert.deepEqual(
      feed(createNumericFieldProfiler('IDADE'), RECORDS, size),
      expected,
      `perfil numérico divergiu com lotes de ${size}`,
    );
  }
});

test('batched combination profiling equals the one-shot profile', () => {
  const expected = profileFieldCombinations(RECORDS, ['UF', 'SEXO']);
  for (const size of [1, 5, 64, 500]) {
    assert.deepEqual(
      feed(createFieldCombinationProfiler(['UF', 'SEXO']), RECORDS, size),
      expected,
      `perfil de combinações divergiu com lotes de ${size}`,
    );
  }
});

test('the numeric profiler refuses to profile a truncated sample', () => {
  const profiler = createNumericFieldProfiler('IDADE', { maxRetainedValues: 10 });
  assert.throws(
    () => profiler.push(RECORDS),
    (error) => /precisaria reter mais de/.test(error.message)
      && /enganosos/.test(error.message)
      && /filtro/.test(error.message),
  );
  assert.throws(() => createNumericFieldProfiler('IDADE', { maxRetainedValues: 0 }), /limite inválido/);
  assert.throws(() => createNumericFieldProfiler('  '), /requires a field/);
});

test('the distinct value collector stays bounded and stays sorted for people', () => {
  const collected = feed(createDistinctValueCollector('UF'), RECORDS, 9);
  assert.deepEqual(collected.values, ['AC', 'BA', 'MG', 'RJ', 'SP']);
  assert.equal(collected.truncated, false);

  // Numeric-aware ordering: 2 must precede 10 instead of sorting as text.
  const numeric = feed(createDistinctValueCollector('N'), [
    { N: 10 }, { N: 2 }, { N: 2 }, { N: null }, { N: 1 },
  ], 2);
  assert.deepEqual(numeric.values, ['1', '2', '10']);

  const capped = feed(createDistinctValueCollector('UF', 2), RECORDS, 4);
  assert.equal(capped.values.length, 2);
  assert.equal(capped.truncated, true);
  assert.throws(() => createDistinctValueCollector('UF', 0), /limite inválido/);
});

test('the selected-record collector agrees with the executor and stays bounded', () => {
  const plan = compileQueryPlan({
    rows: { field: 'UF' },
    measure: { kind: 'count' },
    filters: [{ field: 'SEXO', acceptedCategories: ['F'] }],
  });
  const expected = RECORDS.filter((record) => record.SEXO === 'F');

  const collector = createSelectedRecordCollector(plan);
  for (let offset = 0; offset < RECORDS.length; offset += 11) {
    collector.push(RECORDS.slice(offset, offset + 11));
  }
  const selected = collector.finish();

  assert.deepEqual(selected, expected, 'a seleção deve seguir a mesma fronteira do executor');
  assert.equal(selected.length, executeInMemory(RECORDS, plan).recordsAccepted);

  const capped = createSelectedRecordCollector(plan, {}, { maxRecords: 3 });
  assert.throws(() => capped.push(RECORDS), /não cabe em um DBF local|Restrinja a seleção/);
  assert.throws(() => createSelectedRecordCollector(plan, {}, { maxRecords: 0 }), /limite inválido/);
});
