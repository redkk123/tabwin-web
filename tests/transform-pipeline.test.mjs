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

// --- cast-type, date-part and text-normalize -------------------------------

test('cast-type converts what it can and reports what it could not, without guessing', () => {
  const records = [{ V: '10' }, { V: '3,5' }, { V: 'texto' }, { V: '' }, { V: null }];
  const missing = applyTransformPipeline(records, ['V'], [
    { id: 'c1', kind: 'cast-type', field: 'V', to: 'number', onFailure: 'missing' },
  ]);
  assert.deepEqual(missing.records.map((record) => record.V), [10, 3.5, null, '', null]);
  assert.equal(missing.steps[0].detail.convertidos, 2);
  assert.equal(missing.steps[0].detail.falhas, 1);
  assert.equal(missing.steps[0].detail.jaAusentes, 2, 'blank and null were already absent, not failures');

  // "keep" loses nothing: the unconvertible value stays exactly as it was.
  const keep = applyTransformPipeline(records, ['V'], [
    { id: 'c1', kind: 'cast-type', field: 'V', to: 'number', onFailure: 'keep' },
  ]);
  assert.equal(keep.records[2].V, 'texto');
});

test('cast-type reads the date shapes DATASUS actually ships, and rejects impossible ones', () => {
  const records = [
    { D: '20240115' }, { D: '2024-01-15' }, { D: '15/01/2024' },
    { D: new Date(Date.UTC(2024, 0, 15)) }, { D: '20240231' }, { D: 'ontem' },
  ];
  const result = applyTransformPipeline(records, ['D'], [
    { id: 'c1', kind: 'cast-type', field: 'D', to: 'date', onFailure: 'missing' },
  ]);
  const iso = result.records.map((record) => (record.D instanceof Date ? record.D.toISOString().slice(0, 10) : record.D));
  assert.deepEqual(iso, ['2024-01-15', '2024-01-15', '2024-01-15', '2024-01-15', null, null]);
  // 31 February must not roll forward into March in silence.
  assert.equal(result.steps[0].detail.falhas, 2);
});

test('date-part extracts the unambiguous calendar parts', () => {
  const records = [{ D: '20240115' }, { D: '20241231' }, { D: 'invalido' }];
  const part = (name, target) => applyTransformPipeline(records, ['D'], [
    { id: 'p1', kind: 'date-part', field: 'D', target, part: name },
  ]).records.map((record) => record[target]);

  assert.deepEqual(part('year', 'ANO'), [2024, 2024, null]);
  assert.deepEqual(part('month', 'MES'), [1, 12, null]);
  assert.deepEqual(part('day', 'DIA'), [15, 31, null]);
  assert.deepEqual(part('quarter', 'TRI'), [1, 4, null]);
});

test('epidemiological week follows the MMWR/MS rule: Sunday start, week 1 has four days in January', () => {
  const week = (date) => applyTransformPipeline([{ D: date }], ['D'], [
    { id: 'p1', kind: 'date-part', field: 'D', target: 'SE', part: 'epidemiological-week' },
  ]).records[0].SE;
  const epiYear = (date) => applyTransformPipeline([{ D: date }], ['D'], [
    { id: 'p1', kind: 'date-part', field: 'D', target: 'ANO_SE', part: 'epidemiological-year' },
  ]).records[0].ANO_SE;

  // 2024: Jan 1 is a Monday, so the week Dec 31 2023 - Jan 6 2024 ends Jan 6,
  // which is >= 4, making it SE 1 of 2024.
  assert.equal(week('20240101'), 1);
  assert.equal(week('20231231'), 1, 'a Sunday in December can open week 1 of the next epidemiological year');
  assert.equal(epiYear('20231231'), 2024);
  assert.equal(week('20240106'), 1);
  assert.equal(week('20240107'), 2, 'the next Sunday opens SE 2');

  // 2021: Jan 1 is a Friday, so the week ending Jan 2 has only two January
  // days and belongs to 2020 - Jan 1 2021 is in the LAST week of 2020.
  assert.equal(epiYear('20210101'), 2020);
  assert.equal(week('20210103'), 1, 'the Sunday that opens the four-day week starts SE 1 of 2021');
  assert.equal(epiYear('20210103'), 2021);

  // A week number never leaves the legal range.
  for (const date of ['20200101', '20201231', '20240630', '20251231']) {
    const value = week(date);
    assert.ok(value >= 1 && value <= 53, `${date} produced SE ${value}`);
  }
});

test('text-normalize applies its operations in order, and leaves what it cannot read alone', () => {
  const records = [{ T: '  abc  ' }, { T: 'XYZ' }];
  const result = applyTransformPipeline(records, ['T'], [
    { id: 't1', kind: 'text-normalize', field: 'T', operations: [{ kind: 'trim' }, { kind: 'upper' }] },
  ]);
  assert.deepEqual(result.records.map((record) => record.T), ['ABC', 'XYZ']);
  // Only the first record actually changed.
  assert.equal(result.steps[0].detail.registrosAlterados, 1);
});

test('the IBGE operation standardizes to 6 digits without destroying a leading zero', () => {
  const records = [
    { M: '5300108' },  // 7 digits: the check digit TabWin tables omit
    { M: '530010' },   // already 6
    { M: '11001' },    // 5: the leading zero a spreadsheet ate
    { M: 11001 },      // same, but the reader handed back a number
    { M: 'ABC' },      // not a code at all
  ];
  const result = applyTransformPipeline(records, ['M'], [
    { id: 't1', kind: 'text-normalize', field: 'M', operations: [{ kind: 'ibge-municipality' }] },
  ]);
  assert.deepEqual(result.records.map((record) => record.M), ['530010', '530010', '011001', '011001', 'ABC']);
  assert.equal(result.steps[0].detail.naoReconhecidos, 1, 'a value it could not read is counted, never blanked');
});

test('pad-start and substring cover the code shapes the IBGE helper does not', () => {
  const records = [{ C: '7' }, { C: 'A1234567' }];
  const padded = applyTransformPipeline(records, ['C'], [
    { id: 't1', kind: 'text-normalize', field: 'C', operations: [{ kind: 'pad-start', length: 3, fill: '0' }] },
  ]);
  assert.deepEqual(padded.records.map((record) => record.C), ['007', 'A1234567']);

  const cut = applyTransformPipeline(records, ['C'], [
    { id: 't1', kind: 'text-normalize', field: 'C', operations: [{ kind: 'substring', start: 2, length: 4 }] },
  ]);
  assert.deepEqual(cut.records.map((record) => record.C), ['', '1234']);
});

test('the new steps validate their own shape before touching a record', () => {
  const records = [{ V: '1' }];
  const run = (step) => applyTransformPipeline(records, ['V'], [{ id: 's1', ...step }]);

  assert.throws(() => run({ kind: 'cast-type', field: 'V', to: 'boolean', onFailure: 'keep' }), /target type is invalid/);
  assert.throws(() => run({ kind: 'cast-type', field: 'V', to: 'number', onFailure: 'shrug' }), /onFailure policy is invalid/);
  assert.throws(() => run({ kind: 'cast-type', field: 'NADA', to: 'number', onFailure: 'keep' }), /field NADA does not exist/);
  assert.throws(() => run({ kind: 'date-part', field: 'V', target: 'V', part: 'year' }), /field V already exists/);
  assert.throws(() => run({ kind: 'date-part', field: 'V', target: 'X', part: 'decade' }), /date part is invalid/);
  assert.throws(() => run({ kind: 'text-normalize', field: 'V', operations: [] }), /has no operations/);
  assert.throws(() => run({ kind: 'text-normalize', field: 'V', operations: [{ kind: 'reverse' }] }), /kind is invalid/);
  assert.throws(() => run({ kind: 'text-normalize', field: 'V', operations: [{ kind: 'pad-start', length: 0, fill: '0' }] }), /positive whole number/);
  assert.throws(() => run({ kind: 'text-normalize', field: 'V', operations: [{ kind: 'pad-start', length: 3, fill: '00' }] }), /single character/);
  assert.throws(() => run({ kind: 'text-normalize', field: 'V', operations: [{ kind: 'substring', start: 0 }] }), /positive whole number/);
});

test('the cleaning pipeline the spec sketches runs end to end, in one pass', () => {
  // Standardize the municipality code, extract the notification year and
  // epidemiological week, mark the sentinel as absent, keep only confirmed.
  const records = [
    { MUN: '5300108', DT: '20240115', EVOL: '9', CLASSI: '1' },
    { MUN: '11001', DT: '20240107', EVOL: '1', CLASSI: '1' },
    { MUN: '355030', DT: '20231231', EVOL: '1', CLASSI: '2' },
  ];
  const result = applyTransformPipeline(records, ['MUN', 'DT', 'EVOL', 'CLASSI'], [
    { id: '1', kind: 'text-normalize', field: 'MUN', operations: [{ kind: 'ibge-municipality' }] },
    { id: '2', kind: 'date-part', field: 'DT', target: 'ANO', part: 'year' },
    { id: '3', kind: 'date-part', field: 'DT', target: 'SE', part: 'epidemiological-week' },
    { id: '4', kind: 'missing-value-policy', field: 'EVOL', sentinelValues: ['9'] },
    { id: '5', kind: 'filter-rows', filters: [{ field: 'CLASSI', acceptedCategories: ['1'] }] },
  ]);

  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => record.MUN), ['530010', '011001']);
  assert.deepEqual(result.records.map((record) => record.ANO), [2024, 2024]);
  assert.deepEqual(result.records.map((record) => record.SE), [3, 2]);
  assert.equal(result.records[0].EVOL, null, 'the sentinel became absent');
  assert.deepEqual(result.fields.map((field) => field.name), ['MUN', 'DT', 'EVOL', 'CLASSI', 'ANO', 'SE']);
  // Every step reported its own before/after, which is the audit trail.
  assert.deepEqual(result.steps.map((step) => [step.recordsBefore, step.recordsAfter]),
    [[3, 3], [3, 3], [3, 3], [3, 3], [3, 2]]);
});

// --- group-summarize: group_by() + summarise() -----------------------------

const GROUP_FIELDS = ['REGIAO', 'ANO', 'VALOR', 'ID'];
const GROUP_RECORDS = [
  { REGIAO: 'N', ANO: 2023, VALOR: 10, ID: 'a' },
  { REGIAO: 'N', ANO: 2023, VALOR: 20, ID: 'a' },
  { REGIAO: 'N', ANO: 2024, VALOR: 30, ID: 'b' },
  { REGIAO: 'S', ANO: 2023, VALOR: 40, ID: 'c' },
];

test('group-summarize collapses to one row per key with count/sum/mean', () => {
  const result = applyTransformPipeline(GROUP_RECORDS, GROUP_FIELDS, [
    {
      id: 'g1', kind: 'group-summarize', groupFields: ['REGIAO', 'ANO'],
      aggregations: [
        { kind: 'count', as: 'N' },
        { kind: 'sum', field: 'VALOR', as: 'TOTAL' },
        { kind: 'mean', field: 'VALOR', as: 'MEDIA' },
      ],
    },
  ]);
  assert.equal(result.records.length, 3);
  assert.deepEqual(result.fields.map((field) => field.name), ['REGIAO', 'ANO', 'N', 'TOTAL', 'MEDIA']);
  const byKey = new Map(result.records.map((record) => [`${record.REGIAO}-${record.ANO}`, record]));
  assert.deepEqual(
    [byKey.get('N-2023').N, byKey.get('N-2023').TOTAL, byKey.get('N-2023').MEDIA],
    [2, 30, 15],
  );
  assert.equal(byKey.get('N-2024').N, 1);
  assert.equal(byKey.get('S-2023').TOTAL, 40);
  assert.equal(result.steps[0].detail.gruposFormados, 3);
});

test('group-summarize computes median, min, max and distinct', () => {
  const records = [
    { G: 'x', V: 1, K: 'a' }, { G: 'x', V: 3, K: 'a' }, { G: 'x', V: 100, K: 'b' },
    { G: 'y', V: 5, K: 'c' },
  ];
  const result = applyTransformPipeline(records, ['G', 'V', 'K'], [
    {
      id: 'g1', kind: 'group-summarize', groupFields: ['G'],
      aggregations: [
        { kind: 'median', field: 'V', as: 'MED' },
        { kind: 'min', field: 'V', as: 'MIN' },
        { kind: 'max', field: 'V', as: 'MAX' },
        { kind: 'distinct', field: 'K', as: 'CHAVES' },
      ],
    },
  ]);
  const x = result.records.find((record) => record.G === 'x');
  assert.deepEqual([x.MED, x.MIN, x.MAX, x.CHAVES], [3, 1, 100, 2]);
});

test('a group with no finite value for a field summarizes to null, never a fabricated zero', () => {
  const records = [
    { G: 'x', V: 'texto' }, { G: 'x', V: null },
    { G: 'y', V: 10 },
  ];
  const result = applyTransformPipeline(records, ['G', 'V'], [
    {
      id: 'g1', kind: 'group-summarize', groupFields: ['G'],
      aggregations: [{ kind: 'count', as: 'N' }, { kind: 'sum', field: 'V', as: 'S' }, { kind: 'mean', field: 'V', as: 'M' }],
    },
  ]);
  const x = result.records.find((record) => record.G === 'x');
  // The group still has two records - count is honest - but no numeric value.
  assert.equal(x.N, 2);
  assert.equal(x.S, null);
  assert.equal(x.M, null);
  assert.equal(result.records.find((record) => record.G === 'y').S, 10);
});

test('after group-summarize, only the keys and summaries exist, and a later step sees exactly those', () => {
  const result = applyTransformPipeline(GROUP_RECORDS, GROUP_FIELDS, [
    { id: 'g1', kind: 'group-summarize', groupFields: ['REGIAO'], aggregations: [{ kind: 'sum', field: 'VALOR', as: 'TOTAL' }] },
    { id: 'd1', kind: 'derive-column', field: 'DOBRO', formula: '[TOTAL] * 2', divisionByZero: 'error' },
  ]);
  const north = result.records.find((record) => record.REGIAO === 'N');
  assert.equal(north.TOTAL, 60);
  assert.equal(north.DOBRO, 120);

  // A field that existed before the group-by is gone afterward.
  assert.throws(() => applyTransformPipeline(GROUP_RECORDS, GROUP_FIELDS, [
    { id: 'g1', kind: 'group-summarize', groupFields: ['REGIAO'], aggregations: [{ kind: 'count', as: 'N' }] },
    { id: 'f1', kind: 'filter-rows', filters: [{ field: 'ANO', kind: 'numeric-range', minimum: 2024 }] },
  ]), /field ANO does not exist/);
});

test('a group key that is itself a derived field carries no invented origin', () => {
  const result = applyTransformPipeline(GROUP_RECORDS, GROUP_FIELDS, [
    { id: 'd1', kind: 'derive-column', field: 'DOBRO_ANO', formula: '[ANO] * 2', divisionByZero: 'error' },
    { id: 'g1', kind: 'group-summarize', groupFields: ['DOBRO_ANO'], aggregations: [{ kind: 'count', as: 'N' }] },
  ]);
  const derivedKey = result.fields.find((field) => field.name === 'DOBRO_ANO');
  assert.equal(derivedKey.originalName, undefined, 'a derived group key must not claim an original');
  const realKey = applyTransformPipeline(GROUP_RECORDS, GROUP_FIELDS, [
    { id: 'g1', kind: 'group-summarize', groupFields: ['REGIAO'], aggregations: [{ kind: 'count', as: 'N' }] },
  ]).fields.find((field) => field.name === 'REGIAO');
  assert.equal(realKey.originalName, 'REGIAO', 'a real group key keeps its lineage');
});

test('group-summarize validates its own shape', () => {
  const run = (step) => applyTransformPipeline(GROUP_RECORDS, GROUP_FIELDS, [{ id: 'g1', kind: 'group-summarize', ...step }]);
  assert.throws(() => run({ groupFields: [], aggregations: [{ kind: 'count', as: 'N' }] }), /no group fields/);
  assert.throws(() => run({ groupFields: ['REGIAO', 'REGIAO'], aggregations: [{ kind: 'count', as: 'N' }] }), /repeats a group field/);
  assert.throws(() => run({ groupFields: ['NADA'], aggregations: [{ kind: 'count', as: 'N' }] }), /field NADA does not exist/);
  assert.throws(() => run({ groupFields: ['REGIAO'], aggregations: [] }), /no aggregations/);
  assert.throws(() => run({ groupFields: ['REGIAO'], aggregations: [{ kind: 'sum', field: 'VALOR', as: 'REGIAO' }] }), /output name REGIAO is used more than once/);
  assert.throws(() => run({ groupFields: ['REGIAO'], aggregations: [{ kind: 'sum', field: 'VALOR', as: 'X' }, { kind: 'mean', field: 'VALOR', as: 'X' }] }), /output name X is used more than once/);
  assert.throws(() => run({ groupFields: ['REGIAO'], aggregations: [{ kind: 'sum', field: 'NADA', as: 'X' }] }), /field NADA does not exist/);
  assert.throws(() => run({ groupFields: ['REGIAO'], aggregations: [{ kind: 'variance', field: 'VALOR', as: 'X' }] }), /kind is invalid/);
});

test('the region-by-year example the spec ends on runs end to end', () => {
  // MUN standardized, ano from the date, sentinel out, confirmed only, then
  // N and total by region + year - the pipeline sketched in section 5.4.
  const records = [
    { MUN: '5300108', DT: '20240115', EVOL: '1', CLASSI: '1', UF: 'DF' },
    { MUN: '355030', DT: '20240220', EVOL: '9', CLASSI: '1', UF: 'SP' },
    { MUN: '355030', DT: '20240315', EVOL: '1', CLASSI: '1', UF: 'SP' },
    { MUN: '355030', DT: '20230101', EVOL: '1', CLASSI: '2', UF: 'SP' },
  ];
  const result = applyTransformPipeline(records, ['MUN', 'DT', 'EVOL', 'CLASSI', 'UF'], [
    { id: '1', kind: 'date-part', field: 'DT', target: 'ANO', part: 'year' },
    { id: '2', kind: 'filter-rows', filters: [{ field: 'CLASSI', acceptedCategories: ['1'] }] },
    { id: '3', kind: 'group-summarize', groupFields: ['UF', 'ANO'], aggregations: [{ kind: 'count', as: 'CASOS' }] },
  ]);
  const byKey = new Map(result.records.map((record) => [`${record.UF}-${record.ANO}`, record.CASOS]));
  assert.equal(byKey.get('DF-2024'), 1);
  assert.equal(byKey.get('SP-2024'), 2);
  assert.equal(byKey.size, 2, 'the 2023 record was CLASSI=2 and got filtered out before grouping');
  assert.deepEqual(result.fields.map((field) => field.name), ['UF', 'ANO', 'CASOS']);
});

// --- bind-rows: bind_rows() over a second embedded source ------------------

test('bind-rows appends the second set below, unioning columns', () => {
  const current = [{ UF: 'AC', N: 1 }, { UF: 'AM', N: 2 }];
  const source = { label: '2024', fields: ['UF', 'N'], records: [{ UF: 'SP', N: 3 }] };
  const result = applyTransformPipeline(current, ['UF', 'N'], [
    { id: 'b1', kind: 'bind-rows', source },
  ]);
  assert.equal(result.records.length, 3);
  assert.deepEqual(result.records.map((record) => record.UF), ['AC', 'AM', 'SP']);
  assert.deepEqual(result.fields.map((field) => field.name), ['UF', 'N']);
  assert.equal(result.steps[0].detail.registrosAdicionados, 1);
});

test('a column present on only one side becomes null on the other, never invented', () => {
  const current = [{ UF: 'AC', SIH: 10 }];
  const source = { label: 'SIM', fields: ['UF', 'OBITOS'], records: [{ UF: 'SP', OBITOS: 5 }] };
  const result = applyTransformPipeline(current, ['UF', 'SIH'], [
    { id: 'b1', kind: 'bind-rows', source },
  ]);
  // Union: UF, SIH (current-only), OBITOS (source-only).
  assert.deepEqual(result.fields.map((field) => field.name), ['UF', 'SIH', 'OBITOS']);
  assert.deepEqual(result.records, [
    { UF: 'AC', SIH: 10, OBITOS: null },
    { UF: 'SP', SIH: null, OBITOS: 5 },
  ]);
  assert.equal(result.steps[0].detail.colunasSoAtual, 1);
  assert.equal(result.steps[0].detail.colunasSoFonte, 1);
});

test('an origin column marks which base each record came from', () => {
  const current = [{ UF: 'AC' }];
  const source = { label: 'den24', fields: ['UF'], records: [{ UF: 'SP' }] };
  const result = applyTransformPipeline(current, ['UF'], [
    { id: 'b1', kind: 'bind-rows', source, originField: 'FONTE', currentLabel: 'den23' },
  ]);
  assert.deepEqual(result.records.map((record) => record.FONTE), ['den23', 'den24']);
  assert.deepEqual(result.fields.map((field) => field.name), ['UF', 'FONTE']);
});

test('stacking several years is just repeated bind-rows, the GPT example', () => {
  const den22 = [{ UF: 'AC', ANO: 2022 }];
  const result = applyTransformPipeline(den22, ['UF', 'ANO'], [
    { id: 'b1', kind: 'bind-rows', source: { label: 'den23', fields: ['UF', 'ANO'], records: [{ UF: 'AC', ANO: 2023 }] } },
    { id: 'b2', kind: 'bind-rows', source: { label: 'den24', fields: ['UF', 'ANO'], records: [{ UF: 'AC', ANO: 2024 }] } },
  ]);
  assert.deepEqual(result.records.map((record) => record.ANO), [2022, 2023, 2024]);
});

test('a later step sees the unioned schema, including source-only columns', () => {
  const current = [{ UF: 'AC', A: 1 }];
  const source = { label: 'B', fields: ['UF', 'B'], records: [{ UF: 'SP', B: 9 }] };
  const result = applyTransformPipeline(current, ['UF', 'A'], [
    { id: 'b1', kind: 'bind-rows', source },
    { id: 'd1', kind: 'derive-column', field: 'SOMA', formula: 'IFERROR([A]; 0) + IFERROR([B]; 0)', divisionByZero: 'error' },
  ]);
  assert.deepEqual(result.records.map((record) => record.SOMA), [1, 9]);
});

test('bind-rows validates its own shape', () => {
  const current = [{ UF: 'AC' }];
  const run = (step) => applyTransformPipeline(current, ['UF'], [{ id: 'b1', kind: 'bind-rows', ...step }]);
  assert.throws(() => run({ source: { label: '', fields: ['UF'], records: [] } }), /source has no label/);
  assert.throws(() => run({ source: { label: 'X', fields: [], records: [] } }), /source has no fields/);
  assert.throws(() => run({ source: { label: 'X', fields: ['A', 'A'], records: [] } }), /source repeats a field/);
  assert.throws(() => run({ source: { label: 'X', fields: ['UF'], records: [] }, originField: 'UF' }), /field UF already exists/);
  assert.throws(() => run({ source: { label: 'X', fields: ['UF', 'FONTE'], records: [] }, originField: 'FONTE' }), /source already has a field named FONTE/);
});

// --- join: bring a second source's columns onto the current records --------

const LEFT = [
  { UF: 'AC', CASOS: 10 },
  { UF: 'AM', CASOS: 20 },
  { UF: 'SP', CASOS: 30 },
];
const POP = { label: 'ibge', fields: ['UF', 'POPULACAO'], records: [
  { UF: 'AC', POPULACAO: 900 },
  { UF: 'AM', POPULACAO: 4200 },
  { UF: 'RJ', POPULACAO: 17000 },
] };

const join = (overrides) => ({
  id: 'j1', kind: 'join', source: POP, keyPairs: [{ current: 'UF', source: 'UF' }], joinType: 'inner', ...overrides,
});

test('an inner join keeps only matched rows and brings the source columns', () => {
  const result = applyTransformPipeline(LEFT, ['UF', 'CASOS'], [join({})]);
  // AC and AM match; SP has no population row, RJ is source-only.
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.fields.map((field) => field.name), ['UF', 'CASOS', 'POPULACAO']);
  assert.deepEqual(result.records.map((record) => [record.UF, record.POPULACAO]), [['AC', 900], ['AM', 4200]]);
  assert.equal(result.steps[0].detail.registrosCorrespondentes, 2);
  assert.equal(result.steps[0].detail.registrosSemCorrespondencia, 1);
});

test('a left join keeps every current row, with nulls where the source had no match', () => {
  const result = applyTransformPipeline(LEFT, ['UF', 'CASOS'], [join({ joinType: 'left' })]);
  assert.equal(result.records.length, 3);
  const sp = result.records.find((record) => record.UF === 'SP');
  assert.equal(sp.POPULACAO, null, 'no fabricated population for the unmatched row');
});

test('a right join keeps every source row, and a full join keeps both sides', () => {
  const right = applyTransformPipeline(LEFT, ['UF', 'CASOS'], [join({ joinType: 'right' })]);
  // AC, AM (matched) + RJ (source-only). SP is dropped.
  assert.deepEqual(right.records.map((record) => record.UF).sort(), ['AC', 'AM', 'RJ']);
  const rj = right.records.find((record) => record.UF === 'RJ');
  assert.equal(rj.CASOS, null, 'the current-side column is absent for a source-only row');
  assert.equal(rj.POPULACAO, 17000);

  const full = applyTransformPipeline(LEFT, ['UF', 'CASOS'], [join({ joinType: 'full' })]);
  // AC, AM, SP (current) + RJ (source-only).
  assert.deepEqual(full.records.map((record) => record.UF).sort(), ['AC', 'AM', 'RJ', 'SP']);
  assert.equal(full.steps[0].detail.registrosSoFonte, 1);
});

test('the key fields may be named differently on each side', () => {
  const source = { label: 'sim', fields: ['CODMUNRES', 'OBITOS'], records: [{ CODMUNRES: '530010', OBITOS: 3 }] };
  const current = [{ MUNIC_RES: '530010', N: 1 }];
  const result = applyTransformPipeline(current, ['MUNIC_RES', 'N'], [
    { id: 'j1', kind: 'join', source, keyPairs: [{ current: 'MUNIC_RES', source: 'CODMUNRES' }], joinType: 'inner' },
  ]);
  assert.equal(result.records[0].OBITOS, 3);
  // The source key field is not brought in - it is already the current key.
  assert.ok(!result.fields.some((field) => field.name === 'CODMUNRES'));
});

test('a many-to-many key is blocked unless explicitly allowed', () => {
  const current = [{ K: 'x', A: 1 }, { K: 'x', A: 2 }];
  const source = { label: 's', fields: ['K', 'B'], records: [{ K: 'x', B: 10 }, { K: 'x', B: 20 }] };
  const step = { id: 'j1', kind: 'join', source, keyPairs: [{ current: 'K', source: 'K' }], joinType: 'inner' };
  assert.throws(() => applyTransformPipeline(current, ['K', 'A'], [step]), /N:N/);
  // Opted in, it multiplies: 2 current x 2 source = 4 rows.
  const allowed = applyTransformPipeline(current, ['K', 'A'], [{ ...step, allowManyToMany: true }]);
  assert.equal(allowed.records.length, 4);
});

test('a source prefix keeps a brought-in column from colliding with a current one', () => {
  const current = [{ UF: 'AC', VALOR: 1 }];
  const source = { label: 's', fields: ['UF', 'VALOR'], records: [{ UF: 'AC', VALOR: 99 }] };
  const step = { id: 'j1', kind: 'join', source, keyPairs: [{ current: 'UF', source: 'UF' }], joinType: 'inner' };
  // VALOR is on both sides and would collide.
  assert.throws(() => applyTransformPipeline(current, ['UF', 'VALOR'], [step]), /collides with a current field/);
  const prefixed = applyTransformPipeline(current, ['UF', 'VALOR'], [{ ...step, sourcePrefix: 'sim_' }]);
  assert.equal(prefixed.records[0].VALOR, 1);
  assert.equal(prefixed.records[0].sim_VALOR, 99);
});

test('a joined column becomes referencable by a later step', () => {
  const result = applyTransformPipeline(LEFT.slice(0, 2), ['UF', 'CASOS'], [
    join({ joinType: 'left' }),
    { id: 'd1', kind: 'derive-column', field: 'TAXA', formula: 'RATE([CASOS]; [POPULACAO]; 1000)', divisionByZero: 'zero' },
  ]);
  // AC: 10/900*1000 = 11.11..., AM: 20/4200*1000 = 4.76...
  assert.ok(Math.abs(result.records[0].TAXA - (10 / 900 * 1000)) < 1e-9);
});

test('join validates its own shape', () => {
  const run = (overrides) => applyTransformPipeline(LEFT, ['UF', 'CASOS'], [join(overrides)]);
  assert.throws(() => run({ keyPairs: [] }), /has no key/);
  assert.throws(() => run({ joinType: 'cross' }), /join type is invalid/);
  assert.throws(() => run({ keyPairs: [{ current: 'NADA', source: 'UF' }] }), /field NADA does not exist/);
  assert.throws(() => run({ keyPairs: [{ current: 'UF', source: 'NADA' }] }), /the source has no field NADA/);
  assert.throws(() => run({ bringFields: ['NADA'] }), /no field NADA to bring in/);
});

// --- regressions found in the R12 review ------------------------------------

test('a join key matches across types: a numeric code equals the same code as text', () => {
  // parseDelimited types an all-digit CSV column as numeric, while a DBF
  // character field yields a string. Comparing raw values made these never
  // match and returned an all-null join with no hint why.
  const current = [{ MUNIC: 530010, CASOS: 10 }];
  const source = { label: 'pop', fields: ['MUNIC', 'POP'], records: [{ MUNIC: '530010', POP: 900 }] };
  const result = applyTransformPipeline(current, ['MUNIC', 'CASOS'], [
    { id: 'j1', kind: 'join', source, keyPairs: [{ current: 'MUNIC', source: 'MUNIC' }], joinType: 'left' },
  ]);
  assert.equal(result.steps[0].detail.registrosCorrespondentes, 1);
  assert.equal(result.records[0].POP, 900);
});

test('a blank key matches nothing - not even another blank key', () => {
  // SQL's rule: NULL never equals NULL in a join. Two records that merely
  // share "we do not know the município" have nothing in common, and pairing
  // them would attribute one's population to the other.
  const current = [{ MUNIC: '', CASOS: 10 }, { MUNIC: '530010', CASOS: 5 }];
  const source = {
    label: 'pop', fields: ['MUNIC', 'POP'],
    records: [{ MUNIC: '', POP: 999 }, { MUNIC: '530010', POP: 900 }],
  };
  const result = applyTransformPipeline(current, ['MUNIC', 'CASOS'], [
    { id: 'j1', kind: 'join', source, keyPairs: [{ current: 'MUNIC', source: 'MUNIC' }], joinType: 'left' },
  ]);
  const blank = result.records.find((record) => record.MUNIC === '');
  assert.equal(blank.POP, null, 'the blank-key record must not borrow a population');
  assert.equal(result.records.find((record) => record.MUNIC === '530010').POP, 900);
  // The diagnostic separates "no counterpart" from "no key to match on".
  assert.equal(result.steps[0].detail.registrosSemChave, 1);
  assert.equal(result.steps[0].detail.registrosCorrespondentes, 1);
});

test('a full join still emits source rows whose key was blank', () => {
  const current = [{ K: 'a', A: 1 }];
  const source = { label: 's', fields: ['K', 'B'], records: [{ K: '', B: 7 }] };
  const result = applyTransformPipeline(current, ['K', 'A'], [
    { id: 'j1', kind: 'join', source, keyPairs: [{ current: 'K', source: 'K' }], joinType: 'full' },
  ]);
  // The keyless source record cannot match, but a full join must not lose it.
  assert.equal(result.records.length, 2);
  assert.equal(result.steps[0].detail.registrosSoFonte, 1);
  assert.equal(result.records.find((record) => record.B === 7).A, null);
});

test('min and max survive a group far larger than the argument limit', () => {
  // Math.min(...values) passes one argument per value and throws RangeError
  // past ~125k; a single UF group over a national file is well past that.
  const records = Array.from({ length: 200_000 }, (_, index) => ({ G: 'x', V: index }));
  const result = applyTransformPipeline(records, ['G', 'V'], [
    {
      id: 'g1', kind: 'group-summarize', groupFields: ['G'],
      aggregations: [{ kind: 'min', field: 'V', as: 'MIN' }, { kind: 'max', field: 'V', as: 'MAX' }],
    },
  ]);
  assert.equal(result.records[0].MIN, 0);
  assert.equal(result.records[0].MAX, 199_999);
});
