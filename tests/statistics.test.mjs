import assert from 'node:assert/strict';
import test from 'node:test';
import {
  descriptiveStatistics,
  histogram,
  pearsonCorrelation,
  simpleLinearRegression,
  fitGaussian,
  gaussianDensity,
  gaussianOverlay,
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

test('gaussian fit recovers a known mean and sample standard deviation', () => {
  const fit = fitGaussian([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(fit.count, 8);
  assert.equal(fit.mean, 5);
  // Textbook example: sample variance 4.5714..., sd ~ 2.1381.
  assert.ok(Math.abs(fit.standardDeviation - 2.13809) < 1e-4);
});

test('gaussian fit refuses too few or constant values instead of a divide-by-zero density', () => {
  assert.throws(() => fitGaussian([7]), /at least two finite values/);
  assert.throws(() => fitGaussian([7, 7, 7]), /constant series/);
});

test('gaussian density peaks at the mean and matches the closed-form value there', () => {
  const fit = { mean: 10, standardDeviation: 2 };
  const atMean = gaussianDensity(10, fit);
  const oneAway = gaussianDensity(12, fit);
  assert.ok(atMean > oneAway, 'density must fall off away from the mean');
  assert.ok(Math.abs(atMean - 1 / (2 * Math.sqrt(2 * Math.PI))) < 1e-9);
});

test('gaussian overlay draws a curve over the same bins the histogram already produced', () => {
  const values = Array.from({ length: 400 }, (_, index) => {
    // A deterministic stand-in for normal data: the sum of 12 uniforms minus
    // 6 approximates N(0,1) by the central limit theorem, which is enough to
    // exercise the overlay without pulling in a real RNG dependency.
    let sum = 0;
    for (let k = 0; k < 12; k++) sum += ((index * 2654435761 + k * 40503) >>> 0) / 2 ** 32;
    return sum - 6;
  });
  const bins = histogram(values, 10);
  const fit = fitGaussian(values);
  const overlay = gaussianOverlay(bins, fit);
  assert.equal(overlay.length, bins.length);
  for (const [index, point] of overlay.entries()) {
    assert.equal(point.lower, bins[index].lower);
    assert.equal(point.upper, bins[index].upper);
    assert.ok(point.expectedCount >= 0);
  }
  // The bin straddling the fitted mean should carry more expected mass than
  // the bins at either tail - the one property that actually tests the shape
  // rather than just the plumbing.
  const meanBinIndex = bins.findIndex((bin) => fit.mean >= bin.lower && fit.mean <= bin.upper);
  assert.ok(meanBinIndex >= 0);
  assert.ok(overlay[meanBinIndex].expectedCount > overlay[0].expectedCount);
  assert.ok(overlay[meanBinIndex].expectedCount > overlay.at(-1).expectedCount);
});
