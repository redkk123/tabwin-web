import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTableOperation } from '../dist/packages/analysis/src/table-operations.js';

const result = {
  rows: [{ key: 'a', label: 'A', source: 'raw' }, { key: 'b', label: 'B', source: 'raw' }],
  columns: [
    { key: 'events', label: 'Eventos', source: 'raw' },
    { key: 'population', label: 'População residente', source: 'raw' },
  ],
  cells: [[10, 2], [4, 0]], warnings: [], recordsSeen: 2, recordsAccepted: 2,
};

const expression = (source, divisionByZero = 'error') => ({
  kind: 'expression', expression: source, divisionByZero,
  output: { key: 'calculated', label: 'Calculada', totalPolicy: 'sum' },
});

test('safe table expressions honor precedence, parentheses and right-associative powers', () => {
  assert.deepEqual(applyTableOperation(result, expression('C01 + C02 * 3')).result.cells.map((row) => row.at(-1)), [16, 4]);
  assert.deepEqual(applyTableOperation(result, expression('(C01 + C02) * 3')).result.cells.map((row) => row.at(-1)), [36, 12]);
  assert.deepEqual(applyTableOperation(result, expression('2 ^ 3 ^ 2')).result.cells.map((row) => row.at(-1)), [512, 512]);
  assert.deepEqual(applyTableOperation(result, expression('-2 ^ 2')).result.cells.map((row) => row.at(-1)), [-4, -4]);
});

test('expressions resolve bracketed labels and exact column keys', () => {
  assert.deepEqual(applyTableOperation(result, expression('[Eventos] / [População residente]', 'zero')).result.cells[0].at(-1), 5);
  assert.deepEqual(applyTableOperation(result, expression('events + 1')).result.cells.map((row) => row.at(-1)), [11, 5]);
});

test('expression division by zero and non-finite results fail explicitly', () => {
  assert.throws(() => applyTableOperation(result, expression('C01 / C02')), /division by zero.*row 2/);
  assert.deepEqual(applyTableOperation(result, expression('C01 / C02', 'zero')).result.cells.map((row) => row.at(-1)), [5, 0]);
  assert.throws(() => applyTableOperation(result, expression('10 ^ 1000')), /non-finite value/);
});

test('expression parser rejects missing columns and executable syntax', () => {
  assert.throws(() => applyTableOperation(result, expression('C03 + 1')), /missing column C03/);
  assert.throws(() => applyTableOperation(result, expression('globalThis.alert(1)')), /missing column|unexpected trailing/);
});
