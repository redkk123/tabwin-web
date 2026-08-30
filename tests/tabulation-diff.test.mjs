import assert from 'node:assert/strict';
import test from 'node:test';
import { diffTabulationResults } from '../dist/packages/core/src/tabulation-diff.js';

function axis(key, label, extra = {}) {
  return { key, label, source: 'conversion', ...extra };
}

function result({ rows, columns, cells, recordsSeen = 100, recordsAccepted = 100 }) {
  return { rows, columns, cells, warnings: [], recordsSeen, recordsAccepted };
}

const SINGLE_COLUMN = [axis('__single__', 'Freqüência', { source: 'raw' })];

test('two runs of the same plan over the same data are identical', () => {
  const before = result({
    rows: [axis('1', 'AC'), axis('2', 'SP')],
    columns: SINGLE_COLUMN,
    cells: [[10], [20]],
  });
  const after = result({
    rows: [axis('1', 'AC'), axis('2', 'SP')],
    columns: SINGLE_COLUMN,
    cells: [[10], [20]],
  });
  const diff = diffTabulationResults(before, after);
  assert.equal(diff.identical, true);
  assert.deepEqual(diff.changedCells, []);
  assert.deepEqual(diff.rows.added, []);
  assert.deepEqual(diff.rows.removed, []);
});

test('a changed cell is reported with the exact before/after/delta', () => {
  const before = result({ rows: [axis('1', 'AC')], columns: SINGLE_COLUMN, cells: [[100]] });
  const after = result({ rows: [axis('1', 'AC')], columns: SINGLE_COLUMN, cells: [[137]] });
  const diff = diffTabulationResults(before, after);
  assert.equal(diff.identical, false);
  assert.deepEqual(diff.changedCells, [{
    rowKey: '1', rowLabel: 'AC', columnKey: '__single__', columnLabel: 'Freqüência',
    before: 100, after: 137, delta: 37,
  }]);
});

test('a row present only in one side is added/removed, never a phantom cell diff', () => {
  const before = result({
    rows: [axis('1', 'AC'), axis('2', 'SP')],
    columns: SINGLE_COLUMN,
    cells: [[10], [20]],
  });
  const after = result({
    rows: [axis('2', 'SP'), axis('3', 'RJ')],
    columns: SINGLE_COLUMN,
    cells: [[20], [30]],
  });
  const diff = diffTabulationResults(before, after);
  assert.deepEqual(diff.rows.removed.map((r) => r.key), ['1']);
  assert.deepEqual(diff.rows.added.map((r) => r.key), ['3']);
  assert.deepEqual(diff.rows.commonKeys, ['2']);
  // SP unchanged (20 -> 20): no changed cell recorded for it.
  assert.deepEqual(diff.changedCells, []);
});

test('identity is by key, not by label or position — a rename or a reorder is not a value change', () => {
  const before = result({
    rows: [axis('1', 'AC'), axis('2', 'SP')],
    columns: SINGLE_COLUMN,
    cells: [[10], [20]],
  });
  const after = result({
    // Reordered and relabeled (municipality-name presentation, e.g.), same keys/values.
    rows: [axis('2', 'São Paulo (2)'), axis('1', 'Acre (1)')],
    columns: SINGLE_COLUMN,
    cells: [[20], [10]],
  });
  const diff = diffTabulationResults(before, after);
  assert.equal(diff.identical, true);
  assert.deepEqual(diff.rows.added, []);
  assert.deepEqual(diff.rows.removed, []);
});

test('a column-only comparison catches an added or removed column independent of rows', () => {
  const before = result({
    rows: [axis('1', 'AC')],
    columns: [axis('m', 'Masculino'), axis('f', 'Feminino')],
    cells: [[5, 7]],
  });
  const after = result({
    rows: [axis('1', 'AC')],
    columns: [axis('m', 'Masculino'), axis('f', 'Feminino'), axis('i', 'Ignorado')],
    cells: [[5, 7, 1]],
  });
  const diff = diffTabulationResults(before, after);
  assert.deepEqual(diff.columns.added.map((c) => c.key), ['i']);
  assert.deepEqual(diff.columns.removed, []);
  assert.deepEqual(diff.changedCells, []); // m and f both unchanged
});

test('record counts are diffed even when every cell stays the same', () => {
  const before = result({
    rows: [axis('1', 'AC')], columns: SINGLE_COLUMN, cells: [[10]],
    recordsSeen: 100, recordsAccepted: 90,
  });
  const after = result({
    rows: [axis('1', 'AC')], columns: SINGLE_COLUMN, cells: [[10]],
    recordsSeen: 150, recordsAccepted: 90,
  });
  const diff = diffTabulationResults(before, after);
  assert.equal(diff.identical, false, 'more source records seen is itself a change worth surfacing');
  assert.equal(diff.recordsSeenDelta, 50);
  assert.equal(diff.recordsAcceptedDelta, 0);
});

test('diffing a result against itself is always identical, including an empty result', () => {
  const empty = result({ rows: [], columns: SINGLE_COLUMN, cells: [], recordsSeen: 0, recordsAccepted: 0 });
  assert.equal(diffTabulationResults(empty, empty).identical, true);

  const populated = result({
    rows: [axis('1', 'AC'), axis('2', 'SP')],
    columns: [axis('m', 'Masculino'), axis('f', 'Feminino')],
    cells: [[5, 7], [3, 9]],
  });
  assert.equal(diffTabulationResults(populated, populated).identical, true);
});

test('direction matters: comparing after-vs-before flips the sign of every delta', () => {
  const before = result({ rows: [axis('1', 'AC')], columns: SINGLE_COLUMN, cells: [[100]] });
  const after = result({ rows: [axis('1', 'AC')], columns: SINGLE_COLUMN, cells: [[70]] });
  const forward = diffTabulationResults(before, after);
  const backward = diffTabulationResults(after, before);
  assert.equal(forward.changedCells[0].delta, -30);
  assert.equal(backward.changedCells[0].delta, 30);
});
