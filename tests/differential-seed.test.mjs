import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSeededCase } from '../dist/packages/core/src/differential-seed.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { executeInMemory } from '../dist/packages/core/src/execute.js';
import { writeDbf } from '../dist/packages/export/src/dbf-writer.js';
import { serializeCnv } from '../dist/packages/formats/src/cnv-serializer.js';
import { parseCnv } from '../dist/packages/formats/src/index.js';

const PINNED_DATE = { dateOfLastUpdate: new Date(Date.UTC(2000, 0, 1)) };

function dbfOf(testCase) {
  return writeDbf(testCase.records, testCase.fields.map((field) => ({
    name: field.name, type: field.type, length: field.length, decimalCount: field.decimalCount,
  })), PINNED_DATE);
}

test('the same seed produces the same case - otherwise the two engines are not being fed the same thing', () => {
  for (const seed of [0, 1, 2, 3, 7, 41, 1000]) {
    const first = generateSeededCase(seed);
    const second = generateSeededCase(seed);
    assert.deepEqual(second, first, `seed ${seed} is not reproducible`);
    // Not just structurally equal: the bytes handed to TabWin must match too,
    // which is the only equality that actually matters for a differential run.
    assert.deepEqual(Buffer.from(dbfOf(second)), Buffer.from(dbfOf(first)), `seed ${seed} emits different DBF bytes`);
  }
});

test('different seeds produce different cases, so a sweep is not one case repeated', () => {
  const shapes = new Set();
  const digests = new Set();
  for (let seed = 0; seed < 24; seed++) {
    const testCase = generateSeededCase(seed);
    shapes.add(JSON.stringify(testCase.spec));
    digests.add(Buffer.from(dbfOf(testCase)).toString('base64'));
  }
  assert.equal(shapes.size, 4, 'the generator should cover its four plan shapes');
  assert.equal(digests.size, 24, 'every seed should yield a distinct fixture');
});

test('every generated plan compiles and runs, so a sweep never dies on its own fixture', () => {
  for (let seed = 0; seed < 24; seed++) {
    const testCase = generateSeededCase(seed);
    const conversions = testCase.conversion
      ? { [testCase.conversion.id]: testCase.conversion.definition }
      : {};
    const result = executeInMemory(testCase.records, compileQueryPlan(testCase.spec), conversions);
    assert.equal(result.recordsSeen, testCase.records.length);
    assert.ok(result.rows.length > 0, `seed ${seed} produced an empty table`);
  }
});

test('the generated CNV survives a round trip through our own serializer and parser', () => {
  // If our writer emitted a CNV our own parser rejects, TabWin would have no
  // better chance with it, and the case would be untestable in the oracle.
  const { conversion } = generateSeededCase(1);
  assert.ok(conversion, 'seed 1 should use a conversion');
  const reparsed = parseCnv(serializeCnv(conversion.definition));
  assert.deepEqual(reparsed.categories.map((c) => c.label), ['Masculino', 'Feminino']);
  assert.equal(reparsed.warnings.length, 0);
});

test('the partial CNV really does leave codes unclassified - the corner the case exists to probe', () => {
  // Seed 1 omits unclassified records; seed 3 discriminates them. If the CNV
  // ever covered the whole domain, both cases would silently stop testing
  // anything and still pass.
  const omitted = generateSeededCase(1);
  const conversions = { [omitted.conversion.id]: omitted.conversion.definition };
  const result = executeInMemory(omitted.records, compileQueryPlan(omitted.spec), conversions);
  const outside = omitted.records.filter((record) => record.SEXO === '9' || record.SEXO === '0').length;
  assert.ok(outside > 0, 'the fixture should contain codes the CNV does not cover');
  assert.equal(result.recordsAccepted, omitted.records.length - outside);
});

test('a seed must be a non-negative whole number, and says so instead of producing a silent empty case', () => {
  assert.throws(() => generateSeededCase(-1), /non-negative/);
  assert.throws(() => generateSeededCase(1.5), /whole number/);
  assert.throws(() => generateSeededCase(Number.NaN), /whole number/);
});
