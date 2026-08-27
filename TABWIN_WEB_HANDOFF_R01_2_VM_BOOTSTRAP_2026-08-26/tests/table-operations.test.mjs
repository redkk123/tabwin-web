import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTableOperation,
  calculateColumnTotal,
  replayTableOperations,
} from '../dist/packages/analysis/src/table-operations.js';

const base = {
  rows: [
    { key: 'a', label: 'A', source: 'raw' },
    { key: 'b', label: 'B', source: 'raw', excludeFromTotal: true },
    { key: 'c', label: 'C', source: 'raw' },
  ],
  columns: [
    { key: 'x', label: 'X', source: 'raw' },
    { key: 'y', label: 'Y', source: 'raw' },
  ],
  cells: [[10, 2], [-5, 0], [3, 4]],
  warnings: [], recordsSeen: 3, recordsAccepted: 3,
};

const output = (key, label = key, totalPolicy = 'sum') => ({ key, label, totalPolicy });

test('binary operations append an immutable, auditable derived column', () => {
  const operation = {
    kind: 'binary', operator: 'subtract', leftColumnKey: 'x', rightColumnKey: 'y',
    divisionByZero: 'error', output: output('delta', 'Diferença'),
  };
  const { result, audit } = applyTableOperation(base, operation);
  assert.deepEqual(result.cells, [[10, 2, 8], [-5, 0, -5], [3, 4, -1]]);
  assert.deepEqual(base.cells, [[10, 2], [-5, 0], [3, 4]]);
  assert.deepEqual(result.columns.at(-1), {
    key: 'delta', label: 'Diferença', source: 'derived', totalPolicy: 'sum',
  });
  assert.equal(audit.compatibility, 'modern-explicit-policy');
});

test('division and percentage require an explicit zero-denominator policy', () => {
  const operation = {
    kind: 'binary', operator: 'percentage', leftColumnKey: 'x', rightColumnKey: 'y',
    divisionByZero: 'error', output: output('pct'),
  };
  assert.throws(() => applyTableOperation(base, operation), /division by zero.*row 2/);
  const { result } = applyTableOperation(base, { ...operation, divisionByZero: 'zero' });
  assert.deepEqual(result.cells.map((row) => row.at(-1)), [500, 0, 75]);
});

test('factor, cumulative, absolute, integer, constant and sequence replay deterministically', () => {
  const operations = [
    { kind: 'factor', sourceColumnKey: 'x', factor: 2, output: output('double') },
    { kind: 'cumulative', sourceColumnKey: 'x', output: output('running', 'Acumulado', 'final') },
    { kind: 'absolute', sourceColumnKey: 'x', output: output('absolute') },
    { kind: 'integer', sourceColumnKey: 'double', rounding: 'truncate', output: output('integer') },
    { kind: 'constant', value: 7, output: output('constant') },
    { kind: 'sequence', start: 1, step: 2, output: output('sequence', 'Sequência', 'final') },
  ];
  const result = replayTableOperations(base, operations);
  assert.deepEqual(result.cells.map((row) => row.slice(2)), [
    [20, 10, 10, 20, 7, 1],
    [-10, 5, 5, -10, 7, 3],
    [6, 8, 3, 6, 7, 5],
  ]);
});

test('column totals implement documented policies and honor excluded rows', () => {
  assert.equal(calculateColumnTotal(base, 'x', 'sum'), 13);
  assert.equal(calculateColumnTotal(base, 'x', 'product'), 30);
  assert.equal(calculateColumnTotal(base, 'x', 'mean'), 6.5);
  assert.equal(calculateColumnTotal(base, 'x', 'initial'), 10);
  assert.equal(calculateColumnTotal(base, 'x', 'final'), 3);
  assert.equal(calculateColumnTotal(base, 'x', 'min'), 3);
  assert.equal(calculateColumnTotal(base, 'x', 'max'), 10);
  assert.equal(calculateColumnTotal(base, 'x', 'none'), undefined);
});

test('operations reject missing and duplicate columns', () => {
  assert.throws(() => applyTableOperation(base, {
    kind: 'absolute', sourceColumnKey: 'missing', output: output('new'),
  }), /missing column/);
  assert.throws(() => applyTableOperation(base, {
    kind: 'constant', value: 1, output: output('x'),
  }), /already exists/);
});
