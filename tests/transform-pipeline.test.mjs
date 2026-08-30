import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTransformPipeline, TransformPipelineError } from '../dist/packages/analysis/src/transform-pipeline.js';

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

// --- derive-column: the pipeline's mutate(), on the R11.5 formula engine ---

const NUMERIC_FIELDS = ['UF', 'OBITOS', 'POPULACAO'];
const NUMERIC_RECORDS = [
  { UF: 'AC', OBITOS: 10, POPULACAO: 1000 },
  { UF: 'AM', OBITOS: 20, POPULACAO: 2000 },
  { UF: 'SP', OBITOS: 30, POPULACAO: 0 },
];

const derive = (overrides) => ({
  id: 'd1', kind: 'derive-column', field: 'TAXA', divisionByZero: 'error', ...overrides,
});

test('derive-column computes a new numeric field from the record\'s own fields', () => {
  const result = applyTransformPipeline(NUMERIC_RECORDS.slice(0, 2), NUMERIC_FIELDS, [
    derive({ formula: '=TAXA([OBITOS]; [POPULACAO]; 1000)' }),
  ]);
  assert.deepEqual(result.records.map((record) => record.TAXA), [10, 10]);
  assert.equal(result.steps[0].detail.registrosCalculados, 2);
  // The created field has no original to inherit a DBF shape from.
  assert.deepEqual(result.fields.at(-1), { name: 'TAXA' });
  assert.equal(result.fields.at(-1).originalName, undefined);
});

test('derive-column honours the explicit division-by-zero policy, both ways', () => {
  assert.throws(
    () => applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [derive({ formula: 'RATIO([OBITOS]; [POPULACAO])' })]),
    /division by zero/,
  );
  const zero = applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [
    derive({ formula: 'RATIO([OBITOS]; [POPULACAO])', divisionByZero: 'zero' }),
  ]);
  assert.deepEqual(zero.records.map((record) => record.TAXA), [0.01, 0.01, 0]);
});

test('derive-column reports a non-finite result instead of writing it as if it were a number', () => {
  assert.throws(
    () => applyTransformPipeline([{ OBITOS: 'texto', POPULACAO: 10 }], ['OBITOS', 'POPULACAO'], [
      derive({ formula: '[OBITOS] + 1' }),
    ]),
    /non-finite value at record 1.*IFERROR/s,
  );
  // IFERROR is how the author says what that record should show instead.
  const rescued = applyTransformPipeline([{ OBITOS: 'texto', POPULACAO: 10 }], ['OBITOS', 'POPULACAO'], [
    derive({ formula: 'IFERROR([OBITOS] + 1; 0)' }),
  ]);
  assert.deepEqual(rescued.records.map((record) => record.TAXA), [0]);
});

test('derive-column column-wide functions see every record, in pipeline order', () => {
  const lag = applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [
    derive({ field: 'ANTERIOR', formula: 'IFERROR(LAG([OBITOS]); 0)' }),
  ]);
  assert.deepEqual(lag.records.map((record) => record.ANTERIOR), [0, 10, 20]);

  const z = applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [
    derive({ field: 'Z', formula: 'ZSCORE([OBITOS])' }),
  ]);
  const scores = z.records.map((record) => record.Z);
  assert.ok(Math.abs(scores[0] - -1) < 1e-9, 'mean 20, sample SD 10, so 10 is exactly -1');
  assert.ok(Math.abs(scores[2] - 1) < 1e-9);
});

test('a derive-column step sees only the fields that survived the steps before it', () => {
  // The filter runs first, so LAG sees two records, not three.
  const result = applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [
    { id: 'f1', kind: 'filter-rows', filters: [{ field: 'POPULACAO', kind: 'numeric-range', minimum: 1 }] },
    derive({ field: 'ANTERIOR', formula: 'IFERROR(LAG([OBITOS]); 0)' }),
  ]);
  assert.deepEqual(result.records.map((record) => record.ANTERIOR), [0, 10]);

  // A field dropped earlier cannot be referenced by a formula later.
  assert.throws(() => applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [
    { id: 's1', kind: 'select-columns', keepFields: ['UF', 'OBITOS'] },
    derive({ formula: '[POPULACAO] + 1' }),
  ]), /missing column POPULACAO/);
});

test('a derived field becomes referencable by the steps that follow it', () => {
  const result = applyTransformPipeline(NUMERIC_RECORDS.slice(0, 2), NUMERIC_FIELDS, [
    derive({ field: 'TAXA', formula: 'RATE([OBITOS]; [POPULACAO]; 1000)' }),
    derive({ id: 'd2', field: 'DOBRO', formula: '[TAXA] * 2' }),
  ]);
  assert.deepEqual(result.records.map((record) => record.DOBRO), [20, 20]);
  assert.deepEqual(result.fields.map((field) => field.name), ['UF', 'OBITOS', 'POPULACAO', 'TAXA', 'DOBRO']);
});

test('derive-column refuses a name that already exists, and a formula that cannot parse', () => {
  assert.throws(
    () => applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [derive({ field: 'OBITOS', formula: '1' })]),
    /field OBITOS already exists/,
  );
  assert.throws(
    () => applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [derive({ formula: 'eval(1)' })]),
    /unknown function eval/,
  );
  assert.throws(
    () => applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [derive({ formula: '' })]),
    /has no formula/,
  );
  assert.throws(
    () => applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [derive({ formula: '1', divisionByZero: 'shrug' })]),
    /divisionByZero policy is invalid/,
  );
});

test('a bad formula is rejected while the pipeline is validated, before any record is touched', () => {
  const before = JSON.parse(JSON.stringify(NUMERIC_RECORDS));
  assert.throws(() => applyTransformPipeline(NUMERIC_RECORDS, NUMERIC_FIELDS, [
    { id: 'f1', kind: 'filter-rows', filters: [{ field: 'POPULACAO', kind: 'numeric-range', minimum: 1 }] },
    derive({ formula: '[NAO_EXISTE] * 2' }),
  ]), /missing column NAO_EXISTE/);
  assert.deepEqual(NUMERIC_RECORDS, before);
});
