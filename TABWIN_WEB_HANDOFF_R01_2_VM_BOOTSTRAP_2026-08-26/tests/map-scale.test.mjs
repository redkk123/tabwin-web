import assert from 'node:assert/strict';
import test from 'node:test';
import { createMapScale } from '../dist/packages/visualization/src/map-scale.js';

test('equal-interval map scale produces deterministic class boundaries', () => {
  const scale = createMapScale([0, 25, 50, 75, 100], 'equal-interval', 4, 'green');
  assert.deepEqual(scale.classes.map(({ lower, upper }) => [lower, upper]), [
    [0, 25], [25, 50], [50, 75], [75, 100],
  ]);
  assert.equal(scale.colorFor(undefined), '#dfe8e5');
  assert.equal(scale.colorFor(25), scale.classes[0].color);
  assert.equal(scale.colorFor(26), scale.classes[1].color);
});

test('quantile map scale follows the observed distribution without mutating it', () => {
  const values = [100, 1, 2, 3, 4];
  const original = [...values];
  const scale = createMapScale(values, 'quantile', 2, 'blue');
  assert.deepEqual(values, original);
  assert.deepEqual(scale.classes.map(({ lower, upper }) => [lower, upper]), [[1, 3], [3, 100]]);
});

test('continuous scale gives equal values a stable color', () => {
  const scale = createMapScale([7, 7], 'continuous', 5, 'purple');
  assert.equal(scale.min, 7);
  assert.equal(scale.max, 7);
  assert.equal(scale.colorFor(7), scale.classes.at(-1).color);
});
