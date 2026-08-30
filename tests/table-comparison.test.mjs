import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTables } from '../dist/packages/analysis/src/table-comparison.js';

const axis = (key, label = key) => ({ key, label, source: 'raw' });
const table = (rows, values) => ({
  rows: rows.map(([key, label]) => axis(key, label)),
  columns: [axis('n', 'N')],
  cells: values.map((value) => [value]),
  warnings: [], recordsSeen: values.length, recordsAccepted: values.length,
});

test('full comparison reports matched and unmatched rows', () => {
  const left = table([['2019','2019'],['2020','2020'],['2021','2021']], [10,20,30]);
  const right = table([['2020','2020'],['2021','2021'],['2022','2022']], [25,30,40]);
  const result = compareTables(left, right, {
    version: 1, leftLabel: 'SIH', rightLabel: 'SIM', join: 'full', rowMatch: 'key',
    columnPairs: [{ id: 'main', leftColumnKey: 'n', rightColumnKey: 'n' }],
  });
  assert.equal(result.diagnostics.matchedRows, 2);
  assert.equal(result.diagnostics.leftOnlyRows, 1);
  assert.equal(result.diagnostics.rightOnlyRows, 1);
  const row2020 = result.rows.find((row) => row.leftRowKey === '2020');
  assert.equal(row2020.metrics.main.difference, 5);
  assert.equal(row2020.metrics.main.relativeDifferencePct, 25);
});

test('zero denominators are explicit nulls, not fabricated zeros', () => {
  const left = table([['A','A']], [0]);
  const right = table([['A','A']], [5]);
  const result = compareTables(left, right, {
    version: 1, leftLabel: 'A', rightLabel: 'B', join: 'inner', rowMatch: 'key',
    columnPairs: [{ id: 'main', leftColumnKey: 'n', rightColumnKey: 'n' }],
  });
  assert.equal(result.rows[0].metrics.main.ratioRightToLeft, null);
  assert.equal(result.rows[0].metrics.main.relativeDifferencePct, null);
});

test('duplicate row keys fail loudly', () => {
  const left = table([['A','A'],['A','A again']], [1,2]);
  const right = table([['A','A']], [1]);
  assert.throws(() => compareTables(left, right, {
    version: 1, leftLabel: 'A', rightLabel: 'B', join: 'inner', rowMatch: 'key',
    columnPairs: [{ id: 'main', leftColumnKey: 'n', rightColumnKey: 'n' }],
  }), /duplicate row key/);
});
