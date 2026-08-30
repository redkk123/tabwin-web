import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTransformPipeline, TransformPipelineError } from '../dist/packages/core/src/transform-pipeline.js';

const FIELDS = ['UF', 'MUNIC', 'IDADE', 'SEXO'];
const RECORDS = [
  { UF: 'AC', MUNIC: 'M001', IDADE: 8, SEXO: 'F' },
  { UF: 'AC', MUNIC: 'M001', IDADE: 30, SEXO: 'M' },
  { UF: 'SP', MUNIC: 'M002', IDADE: 45, SEXO: '9' },
  { UF: 'SP', MUNIC: 'M002', IDADE: 45, SEXO: '9' },
];

test('select-columns keeps only the chosen fields, in order, with optional rename', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, [
    { id: 's1', kind: 'select-columns', keepFields: ['MUNIC', 'UF'], renameFields: { MUNIC: 'MUNICIPIO' } },
  ]);
  assert.deepEqual(result.fields, [
    { name: 'MUNICIPIO', originalName: 'MUNIC' },
    { name: 'UF', originalName: 'UF' },
  ]);
  assert.deepEqual(result.records[0], { MUNICIPIO: 'M001', UF: 'AC' });
  assert.equal(result.steps[0].recordsBefore, 4);
  assert.equal(result.steps[0].recordsAfter, 4, 'select-columns never changes row count');
});

test('select-columns rejects an unknown field and a rename collision', () => {
  assert.throws(
    () => applyTransformPipeline(RECORDS, FIELDS, [{ id: 's1', kind: 'select-columns', keepFields: ['NAO_EXISTE'] }]),
    TransformPipelineError,
  );
  assert.throws(
    () => applyTransformPipeline(RECORDS, FIELDS, [{
      id: 's1', kind: 'select-columns', keepFields: ['UF', 'MUNIC'], renameFields: { MUNIC: 'UF' },
    }]),
    /duplicate field names/,
  );
});

test('a field dropped by an earlier select-columns step cannot be used by a later step', () => {
  assert.throws(
    () => applyTransformPipeline(RECORDS, FIELDS, [
      { id: 's1', kind: 'select-columns', keepFields: ['UF', 'MUNIC'] },
      { id: 's2', kind: 'filter-rows', filters: [{ field: 'IDADE', kind: 'numeric-range', minimum: 10 }] },
    ]),
    /field IDADE does not exist/,
  );
});

test('filter-rows reuses the exact same acceptance question as tabulation and audit', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, [
    { id: 'f1', kind: 'filter-rows', filters: [{ field: 'IDADE', kind: 'numeric-range', minimum: 10 }] },
  ]);
  assert.equal(result.records.length, 3);
  assert.equal(result.steps[0].detail.registrosRemovidos, 1);
});

test('recode maps grouped values to a category and applies the otherwise policy', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, [
    {
      id: 'r1',
      kind: 'recode',
      field: 'SEXO',
      mapping: [{ from: ['M'], to: 'Masculino' }, { from: ['F'], to: 'Feminino' }],
      otherwise: { policy: 'missing' },
    },
  ]);
  assert.deepEqual(result.records.map((r) => r.SEXO), ['Feminino', 'Masculino', null, null]);
  assert.equal(result.steps[0].detail.registrosAlterados, 4);
  assert.equal(result.steps[0].detail.semCorrespondencia, 2);
});

test('recode "keep" otherwise leaves an unmapped value untouched, "category" gives it an explicit label', () => {
  const keepResult = applyTransformPipeline(RECORDS, FIELDS, [
    { id: 'r1', kind: 'recode', field: 'SEXO', mapping: [{ from: ['M'], to: 'Masculino' }], otherwise: { policy: 'keep' } },
  ]);
  assert.equal(keepResult.records[2].SEXO, '9');

  const categoryResult = applyTransformPipeline(RECORDS, FIELDS, [
    {
      id: 'r1', kind: 'recode', field: 'SEXO', mapping: [{ from: ['M'], to: 'Masculino' }],
      otherwise: { policy: 'category', label: 'Ignorado' },
    },
  ]);
  assert.equal(categoryResult.records[2].SEXO, 'Ignorado');
});

test('recode rejects a source value mapped by more than one rule', () => {
  assert.throws(() => applyTransformPipeline(RECORDS, FIELDS, [{
    id: 'r1',
    kind: 'recode',
    field: 'SEXO',
    mapping: [{ from: ['M'], to: 'A' }, { from: ['M'], to: 'B' }],
    otherwise: { policy: 'keep' },
  }]), /maps M more than once/);
});

test('missing-value-policy rewrites only the declared sentinel values, and only for the declared field', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, [
    { id: 'm1', kind: 'missing-value-policy', field: 'SEXO', sentinelValues: ['9'] },
  ]);
  assert.deepEqual(result.records.map((r) => r.SEXO), ['F', 'M', null, null]);
  assert.equal(result.steps[0].detail.marcadosComoAusentes, 2);
  // IDADE, a completely different field, is untouched even though nothing here targets it.
  assert.equal(result.records[0].IDADE, 8);
});

test('dedupe keeps the first occurrence of a composite key and reports how many were removed', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, [
    { id: 'd1', kind: 'dedupe', keyFields: ['UF', 'MUNIC', 'IDADE', 'SEXO'] },
  ]);
  assert.equal(result.records.length, 3);
  assert.equal(result.steps[0].detail.registrosRemovidos, 1);
  // The kept record among the two identical SP/M002/45/9 rows is the first one.
  assert.equal(result.records[2], RECORDS[2]);
});

test('a disabled step is validated but has no effect, and says so in its own warning', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, [
    { id: 'f1', kind: 'filter-rows', enabled: false, filters: [{ field: 'IDADE', kind: 'numeric-range', minimum: 10 }] },
  ]);
  assert.equal(result.records.length, 4, 'disabled step must not remove anything');
  assert.equal(result.steps[0].enabled, false);
  assert.match(result.steps[0].warnings[0], /desativada/);
});

test('an unknown step kind is rejected instead of silently doing nothing', () => {
  assert.throws(
    () => applyTransformPipeline(RECORDS, FIELDS, [{ id: 'x1', kind: 'not-a-real-step' }]),
    /unknown kind/,
  );
});

test('a later invalid step aborts the whole pipeline - no partial result, and the input is never mutated', () => {
  const before = JSON.parse(JSON.stringify(RECORDS));
  assert.throws(() => applyTransformPipeline(RECORDS, FIELDS, [
    { id: 'f1', kind: 'filter-rows', filters: [{ field: 'IDADE', kind: 'numeric-range', minimum: 10 }] },
    { id: 'd1', kind: 'dedupe', keyFields: [] },
  ]), TransformPipelineError);
  assert.deepEqual(RECORDS, before, 'the caller\'s original records array must be untouched even after a failed run');
});

test('two steps sharing an id are rejected, even when both are individually valid', () => {
  assert.throws(() => applyTransformPipeline(RECORDS, FIELDS, [
    { id: 'dup', kind: 'missing-value-policy', field: 'SEXO', sentinelValues: ['9'] },
    { id: 'dup', kind: 'missing-value-policy', field: 'IDADE', sentinelValues: ['0'] },
  ]), /repeats id dup/);
});

test('an empty pipeline returns the records and fields unchanged', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, []);
  assert.deepEqual(result.fields, FIELDS.map((name) => ({ name, originalName: name })));
  assert.equal(result.records.length, RECORDS.length);
  assert.deepEqual(result.steps, []);
});

test('select-columns twice in a row still traces each field back to its true original name', () => {
  const result = applyTransformPipeline(RECORDS, FIELDS, [
    { id: 's1', kind: 'select-columns', keepFields: ['MUNIC', 'UF'], renameFields: { MUNIC: 'MUNICIPIO' } },
    { id: 's2', kind: 'select-columns', keepFields: ['MUNICIPIO'], renameFields: { MUNICIPIO: 'CIDADE' } },
  ]);
  assert.deepEqual(result.fields, [{ name: 'CIDADE', originalName: 'MUNIC' }]);
});
