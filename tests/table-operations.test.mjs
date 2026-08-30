import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTableOperation,
  calculateColumnTotal,
  createIncludeTableOperation,
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

test('column rename, movement and deletion are immutable replayable operations', () => {
  const renamed = applyTableOperation(base, { kind: 'rename-column', columnKey: 'x', label: 'Casos' }).result;
  assert.equal(renamed.columns[0].label, 'Casos');
  const moved = applyTableOperation(renamed, { kind: 'move-column', columnKey: 'x', direction: 'right' }).result;
  assert.deepEqual(moved.columns.map((column) => column.key), ['y', 'x']);
  assert.deepEqual(moved.cells[0], [2, 10]);
  const deleted = applyTableOperation(moved, { kind: 'delete-column', columnKey: 'y' }).result;
  assert.deepEqual(deleted.columns.map((column) => column.key), ['x']);
  assert.deepEqual(deleted.cells.map((row) => row[0]), [10, -5, 3]);
  assert.equal(base.columns[0].label, 'X');
});

test('transpose swaps axes and matrix without mutating or losing metadata', () => {
  const transposed = applyTableOperation(base, { kind: 'transpose' }).result;
  assert.deepEqual(transposed.rows, base.columns);
  assert.deepEqual(transposed.columns, base.rows);
  assert.deepEqual(transposed.cells, [[10, -5, 3], [2, 0, 4]]);
  assert.deepEqual(base.cells, [[10, 2], [-5, 0], [3, 4]]);
  const restored = applyTableOperation(transposed, { kind: 'transpose' }).result;
  assert.deepEqual(restored, base);
});

test('include table appends columns by an exact row-key join and reorders the included rows', () => {
  const included = {
    rows: [{ key: 'c', label: 'C', source: 'raw' }, { key: 'a', label: 'A', source: 'raw' }, { key: 'b', label: 'B', source: 'raw' }],
    columns: [{ key: 'population', label: 'População', source: 'raw', totalPolicy: 'sum' }],
    cells: [[300], [100], [200]], warnings: [], recordsSeen: 3, recordsAccepted: 3,
  };
  const operation = createIncludeTableOperation(base, included, 'Censo 2022');
  const { result, audit } = applyTableOperation(base, operation);
  assert.deepEqual(result.columns.map((column) => column.key), ['x', 'y', 'censo-2022:population']);
  assert.deepEqual(result.cells, [[10, 2, 100], [-5, 0, 200], [3, 4, 300]]);
  assert.match(result.warnings.at(-1), /modern explicit policy/);
  assert.equal(audit.compatibility, 'modern-explicit-policy');
  assert.deepEqual(base.cells, [[10, 2], [-5, 0], [3, 4]]);
});

test('include table rejects missing keys, label disagreements and non-finite cells', () => {
  const included = {
    rows: [{ key: 'a', label: 'A', source: 'raw' }],
    columns: [{ key: 'z', label: 'Z', source: 'raw' }],
    cells: [[1]], warnings: [], recordsSeen: 1, recordsAccepted: 1,
  };
  assert.throws(() => applyTableOperation(base, createIncludeTableOperation(base, included, 'Outra')), /exactly match/);
  const exact = { ...included, rows: base.rows.map((row) => ({ ...row })), cells: [[1], [2], [3]] };
  const labelMismatch = createIncludeTableOperation(base, exact, 'Outra');
  labelMismatch.rows[0].label = 'Diferente';
  assert.throws(() => applyTableOperation(base, labelMismatch), /label differs/);
  const nonFinite = createIncludeTableOperation(base, exact, 'Outra');
  nonFinite.cells[0][0] = Number.NaN;
  assert.throws(() => applyTableOperation(base, nonFinite), /non-finite/);
});

test('row suppression removes matched rows without changing source totals', () => {
  const suppressed = applyTableOperation(base, { kind: 'suppress-rows', rowKeys: ['b'] }).result;
  assert.deepEqual(suppressed.rows.map((row) => row.key), ['a', 'c']);
  assert.deepEqual(suppressed.cells, [[10, 2], [3, 4]]);
  assert.equal(base.rows.length, 3);
});

test('row aggregation can replace sources or append an excluded subtotal', () => {
  const replaced = applyTableOperation(base, {
    kind: 'aggregate-rows', rowKeys: ['a', 'c'],
    outputRow: { key: 'ac', label: 'A + C', excludeFromTotal: false }, removeSources: true,
  }).result;
  assert.deepEqual(replaced.rows.map((row) => row.key), ['b', 'ac']);
  assert.deepEqual(replaced.cells.at(-1), [13, 6]);
  const appended = applyTableOperation(base, {
    kind: 'aggregate-rows', rowKeys: ['a', 'c'],
    outputRow: { key: 'subtotal', label: 'Subtotal', excludeFromTotal: true }, removeSources: false,
  }).result;
  assert.equal(appended.rows.at(-1).excludeFromTotal, true);
  assert.equal(calculateColumnTotal(appended, 'x', 'sum'), 13);
});

test('structural operations reject destructive or ambiguous requests', () => {
  assert.throws(() => applyTableOperation({ ...base, columns: [base.columns[0]], cells: base.cells.map((row) => [row[0]]) },
    { kind: 'delete-column', columnKey: 'x' }), /retain at least one/);
  assert.throws(() => applyTableOperation(base, { kind: 'move-column', columnKey: 'x', direction: 'left' }), /cannot move/);
  assert.throws(() => applyTableOperation(base, { kind: 'suppress-rows', rowKeys: [] }), /at least one/);
});
