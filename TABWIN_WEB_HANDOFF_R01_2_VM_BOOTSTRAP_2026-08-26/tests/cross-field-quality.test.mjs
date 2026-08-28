import assert from 'node:assert/strict';
import test from 'node:test';
import { profileFieldCombinations } from '../dist/packages/analysis/src/data-quality.js';
import { compileQueryPlan, QueryPlanError } from '../dist/packages/core/src/plan.js';
import { executeInMemory } from '../dist/packages/core/src/execute.js';
import { parseRecipe, serializeRecipe } from '../dist/packages/core/src/recipe.js';

/** A pregnancy notification set where one record is the implausible combination. */
const RECORDS = [
  { UF: 'AC', CS_GESTANT: '1', IDADE: 22 },
  { UF: 'AC', CS_GESTANT: '2', IDADE: 31 },
  { UF: 'AC', CS_GESTANT: '4', IDADE: 80 },
  { UF: 'SP', CS_GESTANT: '5', IDADE: 80 },
  { UF: 'SP', CS_GESTANT: '1', IDADE: 27 },
  { UF: 'SP', CS_GESTANT: '6', IDADE: 44 },
];

const PREGNANT_OVER_55 = {
  id: 'gestante-idade',
  label: 'Gestante com idade acima de 55 anos',
  action: 'flag',
  conditions: [
    { field: 'CS_GESTANT', acceptedCategories: ['1', '2', '3', '4'] },
    { field: 'IDADE', kind: 'numeric-range', minimum: 55, includeMinimum: false },
  ],
};

function baseSpec(overrides = {}) {
  return {
    rows: { field: 'UF' },
    measure: { kind: 'count' },
    filters: [],
    ...overrides,
  };
}

test('a cross-field rule flags the implausible combination without removing records', () => {
  const plan = compileQueryPlan(baseSpec({ crossFieldRules: [PREGNANT_OVER_55] }));
  const result = executeInMemory(RECORDS, plan);

  assert.equal(result.recordsSeen, 6);
  assert.equal(result.recordsAccepted, 6, 'flag must not drop any record');
  assert.deepEqual(result.dataQuality, [{
    id: 'gestante-idade',
    label: 'Gestante com idade acima de 55 anos',
    action: 'flag',
    matchedRecords: 1,
  }]);
  // Only CS_GESTANT=4 with IDADE=80 matches; CS_GESTANT=5 at 80 does not.
  assert.deepEqual(result.rows.map((row) => row.label), ['AC', 'SP']);
  assert.deepEqual(result.cells, [[3], [3]]);
});

test('an excluding cross-field rule removes only the matching combination', () => {
  const plan = compileQueryPlan(baseSpec({
    crossFieldRules: [{ ...PREGNANT_OVER_55, action: 'exclude' }],
  }));
  const result = executeInMemory(RECORDS, plan);

  assert.equal(result.recordsSeen, 6);
  assert.equal(result.recordsAccepted, 5);
  assert.equal(result.dataQuality[0].matchedRecords, 1);
  assert.deepEqual(result.cells, [[2], [3]], 'AC loses exactly the flagged record');
});

test('single-field filters cannot express the combination the rule removes', () => {
  // Excluding pregnancy and excluding age over 55 separately keeps only the
  // records that are neither, which is a different and much smaller set.
  const separate = executeInMemory(RECORDS, compileQueryPlan(baseSpec({
    filters: [
      { field: 'CS_GESTANT', mode: 'exclude', acceptedCategories: ['1', '2', '3', '4'] },
      { field: 'IDADE', mode: 'exclude', kind: 'numeric-range', minimum: 55, includeMinimum: false },
    ],
  })));
  const combined = executeInMemory(RECORDS, compileQueryPlan(baseSpec({
    crossFieldRules: [{ ...PREGNANT_OVER_55, action: 'exclude' }],
  })));

  assert.equal(separate.recordsAccepted, 1);
  assert.equal(combined.recordsAccepted, 5);
});

test('results stay byte-identical when no cross-field rule is declared', () => {
  const result = executeInMemory(RECORDS, compileQueryPlan(baseSpec()));
  assert.equal('dataQuality' in result, false);
});

test('cross-field rules are recorded as a modern policy in the plan warnings', () => {
  const plan = compileQueryPlan(baseSpec({
    crossFieldRules: [{ ...PREGNANT_OVER_55, action: 'exclude' }],
  }));
  assert.ok(plan.warnings.some((warning) => /modern user-authored implausibility policy/.test(warning)));
  assert.ok(plan.warnings.some((warning) => /removes matching records/.test(warning)));
});

test('cross-field rules reject shapes that no longer describe a combination', () => {
  const rule = (overrides) => baseSpec({ crossFieldRules: [{ ...PREGNANT_OVER_55, ...overrides }] });

  assert.throws(() => compileQueryPlan(rule({ id: '' })), /has no id/);
  assert.throws(() => compileQueryPlan(rule({ label: '  ' })), /has no label/);
  assert.throws(() => compileQueryPlan(rule({ action: 'drop' })), /action is invalid/);
  assert.throws(() => compileQueryPlan(rule({ conditions: [PREGNANT_OVER_55.conditions[0]] })), /at least two conditions/);
  assert.throws(() => compileQueryPlan(rule({
    conditions: [PREGNANT_OVER_55.conditions[0], { field: 'CS_GESTANT', acceptedCategories: ['9'] }],
  })), /at least two distinct fields/);
  assert.throws(() => compileQueryPlan(baseSpec({
    crossFieldRules: [PREGNANT_OVER_55, { ...PREGNANT_OVER_55, label: 'outra' }],
  })), /repeats id/);
  assert.throws(() => compileQueryPlan(rule({ conditions: [PREGNANT_OVER_55.conditions[0], { field: '' }] })), QueryPlanError);
});

test('rule conditions are validated by the same rules as ordinary filters', () => {
  const withCondition = (condition) => baseSpec({
    crossFieldRules: [{ ...PREGNANT_OVER_55, conditions: [PREGNANT_OVER_55.conditions[0], condition] }],
  });
  assert.throws(() => compileQueryPlan(withCondition({ field: 'IDADE', kind: 'numeric-range' })), /numeric range has no bounds/);
  assert.throws(() => compileQueryPlan(withCondition({
    field: 'IDADE', kind: 'numeric-range', minimum: 90, maximum: 10,
  })), /minimum exceeds maximum/);
  assert.throws(() => compileQueryPlan(withCondition({ field: 'IDADE', acceptedCategories: [] })), /no selected categories/);
  assert.throws(() => compileQueryPlan(withCondition({
    field: 'IDADE', acceptedCategories: ['1'], startPosition: 0,
  })), /startPosition must be a positive integer/);
});

test('cross-field rules survive a recipe round trip', () => {
  const spec = baseSpec({ crossFieldRules: [{ ...PREGNANT_OVER_55, action: 'exclude' }] });
  const recipe = parseRecipe(serializeRecipe({
    schema: 'tabwin-web.recipe',
    version: 1,
    spec,
    conversions: [],
    sourceHints: [],
  }));
  assert.deepEqual(recipe.spec.crossFieldRules, spec.crossFieldRules);
  assert.equal(
    executeInMemory(RECORDS, compileQueryPlan(recipe.spec)).recordsAccepted,
    5,
    'the replayed recipe must clean exactly the same records',
  );
});

test('combination profile reports rarity without judging it', () => {
  const profile = profileFieldCombinations(RECORDS, ['CS_GESTANT', 'IDADE']);
  assert.deepEqual(profile.fields, ['CS_GESTANT', 'IDADE']);
  assert.equal(profile.totalRecords, 6);
  assert.equal(profile.distinctCombinations, 6);
  assert.equal(profile.truncated, false);
  assert.equal(profile.combinations.length, 6);
  for (const combination of profile.combinations) {
    assert.equal(combination.records, 1);
    assert.equal(combination.share, 1 / 6);
  }
});

test('combination profile puts the rarest first and is deterministic on ties', () => {
  const records = [
    ...Array.from({ length: 5 }, () => ({ SEXO: 'F', GEST: '1' })),
    ...Array.from({ length: 2 }, () => ({ SEXO: 'M', GEST: '6' })),
    { SEXO: 'M', GEST: '1' },
    { SEXO: 'F', GEST: null },
  ];
  const profile = profileFieldCombinations(records, ['SEXO', 'GEST']);

  assert.deepEqual(profile.combinations.map((item) => [item.values, item.records]), [
    [['F', null], 1],
    [['M', '1'], 1],
    [['M', '6'], 2],
    [['F', '1'], 5],
  ]);
  assert.equal(profile.combinations[0].share, 1 / 9);
  // Absence is preserved as null instead of collapsing into the empty string.
  assert.equal(profile.combinations[0].values[1], null);
  assert.deepEqual(profileFieldCombinations(records, ['SEXO', 'GEST']), profile);
});

test('combination profile is bounded and rejects unusable arguments', () => {
  const records = Array.from({ length: 40 }, (_, index) => ({ A: String(index), B: String(index) }));
  const capped = profileFieldCombinations(records, ['A', 'B'], { maxCombinations: 10, limit: 3 });
  assert.equal(capped.truncated, true);
  assert.equal(capped.distinctCombinations, 10);
  assert.equal(capped.combinations.length, 3);

  assert.throws(() => profileFieldCombinations(records, ['A']), /at least two fields/);
  assert.throws(() => profileFieldCombinations(records, ['A', 'A']), /distinct fields/);
  assert.throws(() => profileFieldCombinations(records, ['A', ' ']), /non-empty fields/);
  assert.throws(() => profileFieldCombinations(records, ['A', 'B'], { limit: 0 }), /limite inválido/);
});
