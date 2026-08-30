import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanNumericOutliers,
  scanTemporalOutliers,
  compareCategoricalDistributions,
  concentrationProfile,
  compareProportions,
  benjaminiHochberg,
  wilsonInterval95,
} from '../dist/packages/analysis/src/statistical-anomaly.js';

test('robust numeric scan flags an extreme value without deleting it', () => {
  const result = scanNumericOutliers([10, 10, 11, 9, 10, 120]);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].value, 120);
});

test('temporal Hampel scan identifies a sudden spike', () => {
  const result = scanTemporalOutliers([
    { key: 2018, value: 10 }, { key: 2019, value: 11 }, { key: 2020, value: 10 },
    { key: 2021, value: 120 }, { key: 2022, value: 11 }, { key: 2023, value: 10 }, { key: 2024, value: 12 },
  ], { windowRadius: 3, log1p: false });
  assert.ok(result.some((point) => point.key === 2021));
});

test('distribution comparison distinguishes diffuse from concentrated signatures', () => {
  const diffuse = new Map([['A', 25], ['B', 25], ['C', 25], ['D', 25]]);
  const concentrated = new Map([['A', 95], ['B', 2], ['C', 2], ['D', 1]]);
  const comparison = compareCategoricalDistributions(diffuse, concentrated);
  assert.ok(comparison.jensenShannonDivergence > 0.2);
  assert.ok(comparison.totalVariationDistance > 0.5);
  assert.ok(concentrationProfile(concentrated).topShare > .9);
});

test('proportion comparison returns effect size, CI and screening p-value', () => {
  const result = compareProportions(93, 1000, 84, 1000);
  assert.equal(result.exposedProportion, .093);
  assert.equal(result.referenceProportion, .084);
  assert.ok(result.exposedWilson95[0] < .093 && result.exposedWilson95[1] > .093);
  assert.ok(result.pValue >= 0 && result.pValue <= 1);
});

test('BH adjustment is monotone in sorted order', () => {
  const adjusted = benjaminiHochberg([.001, .02, .04, .8]);
  assert.ok(adjusted[0] <= adjusted[1]);
  assert.ok(adjusted[1] <= adjusted[2]);
  assert.ok(adjusted[2] <= adjusted[3]);
});

test('Wilson interval at the boundary is an exact 0 or 1, not a float residual', () => {
  // At events=0, center and half nearly cancel and leave residue like 3e-18
  // on the lower bound - the kind of value that reads as broken math when
  // printed in a report instead of the exact zero it means.
  const atZero = wilsonInterval95(0, 100);
  assert.equal(atZero[0], 0);
  assert.ok(atZero[1] > 0 && atZero[1] < 1);
  const atTotal = wilsonInterval95(100, 100);
  assert.equal(atTotal[1], 1);
  assert.ok(atTotal[0] > 0 && atTotal[0] < 1);
});
