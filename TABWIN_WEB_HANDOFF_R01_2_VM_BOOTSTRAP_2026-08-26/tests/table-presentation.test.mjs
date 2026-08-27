import assert from 'node:assert/strict';
import test from 'node:test';
import { tableRowIndexes, tableRowsToTsv } from '../dist/packages/analysis/src/table-presentation.js';

const result = {
  rows: [
    { key: '2', label: 'Água', source: 'raw' },
    { key: '10', label: 'Zebra', source: 'raw' },
    { key: '1', label: 'Acre', source: 'raw' },
  ],
  columns: [{ key: 'count', label: 'Frequência', source: 'raw' }],
  cells: [[5], [2], [5]], warnings: [], recordsSeen: 12, recordsAccepted: 12,
};

test('table presentation sorts stably without mutating the analytical result', () => {
  assert.deepEqual(tableRowIndexes(result, { columnKey: 'count', direction: 'ascending' }), [1, 0, 2]);
  assert.deepEqual(tableRowIndexes(result, { columnKey: 'count', direction: 'descending' }), [0, 2, 1]);
  assert.deepEqual(tableRowIndexes(result, { columnKey: '__row_key__', direction: 'ascending' }), [2, 0, 1]);
  assert.deepEqual(result.rows.map((row) => row.key), ['2', '10', '1']);
});

test('table location is accent-insensitive and searches keys and labels', () => {
  assert.deepEqual(tableRowIndexes(result, undefined, 'agua'), [0]);
  assert.deepEqual(tableRowIndexes(result, undefined, '10'), [1]);
  assert.deepEqual(tableRowIndexes(result, undefined, 'inexistente'), []);
});

test('clipboard TSV follows presented row order and optional key visibility', () => {
  assert.equal(tableRowsToTsv(result, [1, 0], { rowLabel: 'Local', includeKey: true }),
    'Local\tFrequência\r\nZebra\t2\r\nÁgua\t5');
  assert.equal(tableRowsToTsv(result, [2], { rowLabel: 'Local', includeKey: false }),
    'Frequência\r\n5');
});
