import assert from 'node:assert/strict';
import test from 'node:test';
import {
  descriptiveStatistics,
  histogram,
  pearsonCorrelation,
  simpleLinearRegression,
} from '../dist/packages/analysis/src/statistics.js';

test('descriptive statistics report sample measures without mutating input', () => {
  const source = [4, 1, 3, 2];
  const result = descriptiveStatistics(source);
  assert.deepEqual(source, [4, 1, 3, 2]);
  assert.deepEqual(result, {
    count: 4, sum: 10, mean: 2.5, minimum: 1, maximum: 4, median: 2.5,
    sampleVariance: 5 / 3, sampleStandardDeviation: Math.sqrt(5 / 3),
  });
});

test('Pearson correlation and regression recover an exact line', () => {
  assert.equal(pearsonCorrelation([1, 2, 3], [3, 5, 7]), 1);
  assert.deepEqual(simpleLinearRegression([1, 2, 3], [3, 5, 7]), {
    count: 3, slope: 2, intercept: 1, rSquared: 1,
  });
});

test('histogram includes the maximum in the final bin', () => {
  assert.deepEqual(histogram([0, 1, 2, 3, 4], 2), [
    { lower: 0, upper: 2, count: 2 },
    { lower: 2, upper: 4, count: 3 },
  ]);
});

test('undefined constant-series calculations fail explicitly', () => {
  assert.throws(() => pearsonCorrelation([1, 1], [2, 3]), /constant series/);
  assert.throws(() => simpleLinearRegression([1, 1], [2, 3]), /constant predictor/);
});
