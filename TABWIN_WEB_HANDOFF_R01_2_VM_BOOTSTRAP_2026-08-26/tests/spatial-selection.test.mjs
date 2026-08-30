import assert from 'node:assert/strict';
import test from 'node:test';
import { spatialSelectionFilter } from '../dist/packages/core/src/spatial-selection.js';

test('spatial selection becomes an explicit raw geocode filter', () => {
  assert.deepEqual(spatialSelectionFilter(' CODMUN ', ['5300108', '5300108', '5208707']), {
    kind: 'categories', field: 'CODMUN', mode: 'include', acceptedCategories: ['5300108', '5208707'],
  });
  assert.throws(() => spatialSelectionFilter('', ['1']), /explicit dataset field/);
  assert.throws(() => spatialSelectionFilter('CODMUN', []), /at least one geocode/);
});
