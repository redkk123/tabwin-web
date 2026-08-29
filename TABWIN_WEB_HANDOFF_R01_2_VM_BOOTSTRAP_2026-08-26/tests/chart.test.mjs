import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowDataFromResult, chartDataFromResult, scatterDataFromResult } from '../dist/packages/visualization/src/chart-model.js';

const result = {
  rows: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }, { key: 'c', label: 'Gamma' }],
  columns: [{ key: '2024', label: '2024' }, { key: '2025', label: '2025' }],
  cells: [[2, 5], [10, 1], [3, 3]],
  warnings: [], recordsSeen: 24, recordsAccepted: 24,
};

test('chart model derives totals without mutating result order', () => {
  const ranked = chartDataFromResult(result, { limit: 2, order: 'ranked' });
  assert.deepEqual(ranked.map((item) => [item.label, item.value]), [['Beta', 11], ['Alpha', 7]]);
  assert.deepEqual(result.rows.map((row) => row.label), ['Alpha', 'Beta', 'Gamma']);
});

test('arrow model compares first and last columns and ranks by change', () => {
  const arrows = arrowDataFromResult(result, 3);
  assert.deepEqual(arrows.map((item) => [item.label, item.start, item.end]), [
    ['Beta', 10, 1], ['Alpha', 2, 5], ['Gamma', 3, 3],
  ]);
  assert.deepEqual(arrowDataFromResult({ ...result, columns: result.columns.slice(0, 1) }, 3), []);
});



test('scatter model binds x/y to explicit result columns without changing row totals', () => {
  const scatter = scatterDataFromResult(result, '2024', '2025', 10);
  assert.deepEqual(scatter.map((item) => [item.label, item.x, item.y, item.value]), [
    ['Alpha', 2, 5, 7], ['Beta', 10, 1, 11], ['Gamma', 3, 3, 6],
  ]);
  assert.deepEqual(scatterDataFromResult(result, 'missing', '2025', 10), []);
});
