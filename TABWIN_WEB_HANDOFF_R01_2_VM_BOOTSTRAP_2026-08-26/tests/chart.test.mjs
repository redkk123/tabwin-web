import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrowDataFromResult,
  chartDataFromResult,
  resolveAxis,
  scatterDataFromResult,
  seriesFromResult,
} from '../dist/packages/visualization/src/chart-model.js';

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

test('scatter model can size bubbles from a third column instead of the row total', () => {
  const bound = scatterDataFromResult(result, '2024', '2025', 10, '2025');
  assert.deepEqual(bound.map((item) => [item.label, item.size]), [
    ['Alpha', 5], ['Beta', 1], ['Gamma', 3],
  ]);
  // An unknown size column is not an error - it falls back to the row total,
  // which is what the chart drew before size bindings existed.
  const missing = scatterDataFromResult(result, '2024', '2025', 10, 'nao-existe');
  assert.deepEqual(missing.map((item) => item.size), [7, 11, 6]);
});

test('series model exposes one series per column, aligned to the plotted rows', () => {
  const data = chartDataFromResult(result, { limit: 2, order: 'source' });
  assert.deepEqual(seriesFromResult(result, data), [
    { key: '2024', label: '2024', values: [2, 10] },
    { key: '2025', label: '2025', values: [5, 1] },
  ]);
});

test('axis ticks are numbers a reader can do arithmetic on', () => {
  assert.deepEqual(resolveAxis(0, 4315).ticks, [0, 1000, 2000, 3000, 4000, 5000]);
  assert.equal(resolveAxis(0, 4315).manual, false);
  // Walking a float step must not leak 0.30000000000000004 onto an axis.
  assert.deepEqual(resolveAxis(0, 1).ticks, [0, 0.2, 0.4, 0.6000000000000001, 0.8, 1].map((v) => Number(v.toPrecision(12))));
  assert.deepEqual(resolveAxis(0, 1).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test('a manual range is used verbatim; an invalid one is discarded whole', () => {
  const manual = resolveAxis(0, 4315, { min: 100, max: 500, tickCount: 4 });
  assert.equal(manual.manual, true);
  assert.deepEqual(manual.ticks, [100, 200, 300, 400, 500]);
  // Inverted, collapsed, or half-specified all fall back to the data.
  for (const request of [{ min: 500, max: 100 }, { min: 100, max: 100 }, { min: 100 }, { max: 500 }]) {
    assert.equal(resolveAxis(0, 4315, request).manual, false, JSON.stringify(request));
    assert.deepEqual(resolveAxis(0, 4315, request).ticks, resolveAxis(0, 4315).ticks);
  }
});

test('a degenerate range still produces a drawable axis', () => {
  assert.ok(resolveAxis(0, 0).max > resolveAxis(0, 0).min);
  assert.ok(resolveAxis(7, 7).max > resolveAxis(7, 7).min);
  assert.ok(resolveAxis(Number.NaN, Number.NaN).ticks.length >= 2);
});
