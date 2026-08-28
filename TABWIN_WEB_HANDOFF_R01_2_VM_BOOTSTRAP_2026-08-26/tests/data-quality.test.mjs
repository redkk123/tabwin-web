import assert from 'node:assert/strict';
import test from 'node:test';
import { profileNumericField } from '../dist/packages/analysis/src/data-quality.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';

test('numeric quality profile separates missing, invalid and IQR outlier values without mutation', () => {
  const records = [
    { AGE: 20 }, { AGE: 21 }, { AGE: '22' }, { AGE: '23,0' },
    { AGE: 24 }, { AGE: 80 }, { AGE: '' }, { AGE: null }, { AGE: 'unknown' },
  ];
  const profile = profileNumericField(records, 'AGE');
  assert.equal(profile.totalRecords, 9);
  assert.equal(profile.numericRecords, 6);
  assert.equal(profile.missingRecords, 2);
  assert.equal(profile.invalidRecords, 1);
  assert.equal(profile.minimum, 20);
  assert.equal(profile.maximum, 80);
  assert.equal(profile.median, 22.5);
  assert.equal(profile.iqrOutlierRecords, 1);
  assert.deepEqual(records[0], { AGE: 20 });
});

test('numeric quality profile handles empty and constant fields explicitly', () => {
  const empty = profileNumericField([{ X: '' }, { X: 'no' }], 'X');
  assert.equal(empty.numericRecords, 0);
  assert.equal(empty.minimum, undefined);
  const constant = profileNumericField([{ X: 7 }, { X: 7 }, { X: 7 }], 'X');
  assert.equal(constant.lowerIqrFence, 7);
  assert.equal(constant.upperIqrFence, 7);
  assert.equal(constant.iqrOutlierRecords, 0);
});

test('data-quality range is an explicit ordinary filter with audit provenance', () => {
  const plan = compileQueryPlan({
    compatibilityProfile: 'modern', rows: { field: 'UF' }, measure: { kind: 'count' },
    filters: [{
      field: 'AGE', kind: 'numeric-range', origin: 'data-quality', mode: 'include',
      minimum: 10, maximum: 79, includeMinimum: true, includeMaximum: true,
    }],
  });
  assert.match(plan.warnings.join('\n'), /non-destructive data-quality rule/);
  assert.throws(() => compileQueryPlan({
    ...plan.spec,
    filters: [{ ...plan.spec.filters[0], origin: 'automatic-cleanup' }],
  }), /origin is invalid/);
});
