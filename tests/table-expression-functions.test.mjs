/**
 * R11.5: the named-function layer over the derived-column expression
 * language. The arithmetic core it sits on is covered by
 * table-expression.test.mjs; this file is about the functions themselves,
 * their Excel-compatible edge semantics, and the closed-registry property
 * that keeps user text from ever being executed as code.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTableOperation } from '../dist/packages/analysis/src/table-operations.js';
import {
  tableExpressionFunctionCatalog,
  tableExpressionFunctionNames,
} from '../dist/packages/analysis/src/table-expression.js';

const twoRows = {
  rows: [{ key: 'a', label: 'A', source: 'raw' }, { key: 'b', label: 'B', source: 'raw' }],
  columns: [
    { key: 'events', label: 'Eventos', source: 'raw' },
    { key: 'population', label: 'População residente', source: 'raw' },
  ],
  cells: [[10, 2], [4, 0]], warnings: [], recordsSeen: 2, recordsAccepted: 2,
};

/** Four rows, so LAG and ZSCORE have a column with real spread to work on. */
const series = {
  rows: ['a', 'b', 'c', 'd'].map((key) => ({ key, label: key.toUpperCase(), source: 'raw' })),
  columns: [
    { key: 'events', label: 'Óbitos', source: 'raw' },
    { key: 'population', label: 'População', source: 'raw' },
  ],
  cells: [[10, 1000], [20, 2000], [30, 3000], [40, 4000]],
  warnings: [], recordsSeen: 4, recordsAccepted: 4,
};

const expression = (source, divisionByZero = 'error') => ({
  kind: 'expression', expression: source, divisionByZero,
  output: { key: 'calculated', label: 'Calculada', totalPolicy: 'sum' },
});

const derive = (source, table = twoRows, divisionByZero = 'error') =>
  applyTableOperation(table, expression(source, divisionByZero)).result.cells.map((row) => row.at(-1));

function assertClose(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-9, `${message ?? ''} [${index}]: ${value} != ${expected[index]}`);
  });
}

test('a formula may start with "=" the way an Excel user reflexively writes it', () => {
  assert.deepEqual(derive('=C01 + 1'), [11, 5]);
  assert.deepEqual(derive('C01 + 1'), [11, 5]);
});

test('aggregation functions fold the arguments written in the formula', () => {
  assert.deepEqual(derive('SUM(C01, C02, 5)'), [17, 9]);
  assert.deepEqual(derive('AVERAGE(C01, C02)'), [6, 2]);
  assert.deepEqual(derive('MIN(C01, C02)'), [2, 0]);
  assert.deepEqual(derive('MAX(C01, C02)'), [10, 4]);
  assert.deepEqual(derive('MEDIAN(1, 2, 100)'), [2, 2]);
  assert.deepEqual(derive('MEDIAN(1, 2, 3, 100)'), [2.5, 2.5]);
  assert.deepEqual(derive('COUNT(C01, C02, 7)'), [3, 3]);
});

test('the four Excel rounding rules disagree on negatives, and each keeps its own', () => {
  // Excel rounds half away from zero; JS Math.round alone would give -2.
  assert.deepEqual(derive('ROUND(0 - 2.5, 0)'), [-3, -3]);
  assert.deepEqual(derive('ROUND(2.5, 0)'), [3, 3]);
  // ROUNDUP goes away from zero, ROUNDDOWN toward it.
  assert.deepEqual(derive('ROUNDUP(0 - 2.1, 0)'), [-3, -3]);
  assert.deepEqual(derive('ROUNDUP(2.1, 0)'), [3, 3]);
  assert.deepEqual(derive('ROUNDDOWN(0 - 2.9, 0)'), [-2, -2]);
  // TRUNC truncates toward zero; INT floors toward negative infinity.
  assert.deepEqual(derive('TRUNC(0 - 2.7)'), [-2, -2]);
  assert.deepEqual(derive('INT(0 - 2.7)'), [-3, -3]);
});

test('rounding to decimals uses the digits the author typed, not their binary approximation', () => {
  // 2.345 * 100 is 234.49999999999997 in binary floating point, so a naive
  // implementation answers 2.34 where Excel answers 2.35.
  assert.deepEqual(derive('ROUND(2.345, 2)'), [2.35, 2.35]);
  assert.deepEqual(derive('ROUND(1.005, 2)'), [1.01, 1.01]);
  assert.deepEqual(derive('ROUND(8.475, 2)'), [8.48, 8.48]);
  assert.deepEqual(derive('ROUND(0 - 2.345, 2)'), [-2.35, -2.35]);
  assert.deepEqual(derive('ROUND(0, 2)'), [0, 0]);
});

test('LOG defaults to base 10 like Excel, while LN is the natural logarithm', () => {
  assert.deepEqual(derive('LOG(100)'), [2, 2]);
  assert.deepEqual(derive('LOG(8, 2)'), [3, 3]);
  assert.deepEqual(derive('LOG10(1000)'), [3, 3]);
  assert.deepEqual(derive('ROUND(LN(EXP(1)), 6)'), [1, 1]);
  assert.deepEqual(derive('POWER(2, 10)'), [1024, 1024]);
  assert.throws(() => derive('LN(0)'), /LN requires a positive value/);
  assert.throws(() => derive('LOG(100, 1)'), /LOG base must be positive and different from 1/);
  assert.throws(() => derive('SQRT(0 - 1)'), /SQRT of a negative value/);
});

test('comparisons produce 1/0 and sit below arithmetic in precedence', () => {
  assert.deepEqual(derive('C01 > C02'), [1, 1]);
  assert.deepEqual(derive('C02 >= 2'), [1, 0]);
  assert.deepEqual(derive('C01 = 10'), [1, 0]);
  assert.deepEqual(derive('C01 <> 10'), [0, 1]);
  assert.deepEqual(derive('C02 <= 2'), [1, 1]);
  // Both sides are fully evaluated as arithmetic before being compared.
  assert.deepEqual(derive('C01 + 1 > C02 * 3'), [1, 1]);
  assert.deepEqual(derive('C01 - 9 > C02'), [0, 0]);
});

test('IF, IFS and the boolean functions branch on those comparisons', () => {
  assert.deepEqual(derive('IF(C01 < 5, 0, C01)'), [10, 0]);
  assert.deepEqual(derive('IFS(C01 > 8, 100, C01 > 2, 50)'), [100, 50]);
  assert.deepEqual(derive('AND(C01 > 1, C02 > 1)'), [1, 0]);
  assert.deepEqual(derive('OR(C01 > 1, C02 > 1)'), [1, 1]);
  assert.deepEqual(derive('NOT(C02)'), [0, 1]);
  assert.throws(() => derive('IFS(C01 > 100, 1, C01 > 200, 2)'), /IFS matched no condition/);
  // Five arguments clears the minimum but leaves a condition with no value.
  assert.throws(() => derive('IFS(C01 > 1, 2, C01 > 3, 4, 5)'), /argument count must be even/);
});

test('IFERROR is the only place an error is swallowed, and only because it was asked for in writing', () => {
  // Row 2 divides by zero. Bare, it fails loudly; wrapped, the author's own
  // fallback is used - a visible decision, never an invented zero.
  assert.throws(() => derive('C01 / C02'), /division by zero/);
  assert.deepEqual(derive('IFERROR(C01 / C02, 0)'), [5, 0]);
  assert.deepEqual(derive('IFERROR(C01 / C02, 0 - 1)'), [5, -1]);
  assert.deepEqual(derive('ISNUMBER(C01 / C02)'), [1, 0]);
  assert.deepEqual(derive('ISNUMBER(C01)'), [1, 1]);
});

test('epidemiology functions name what an anonymous division would hide', () => {
  assertClose(derive('RATE(C01, C02)', series), [1000, 1000, 1000, 1000]);
  assertClose(derive('RATE(C01, C02, 1000)', series), [10, 10, 10, 10]);
  assertClose(derive('PERCENT(C01, C02)', series), [1, 1, 1, 1]);
  assertClose(derive('RATIO(C02, C01)', series), [100, 100, 100, 100]);
  assert.deepEqual(derive('CHANGE(C02, C01)', series), [990, 1980, 2970, 3960]);
  assertClose(derive('PCTCHANGE(C02, C01)', series), [9900, 9900, 9900, 9900]);
});

test('a zero denominator inside an epidemiology function obeys the same explicit policy', () => {
  assert.throws(() => derive('RATE(C01, C02)'), /division by zero/);
  assert.throws(() => derive('PERCENT(C01, C02)'), /division by zero/);
  assert.throws(() => derive('RATIO(C01, C02)'), /division by zero/);
  assertClose(derive('RATE(C01, C02)', twoRows, 'zero'), [500000, 0]);
});

test('LAG reads the previous row, and refuses to invent one for the first', () => {
  assert.deepEqual(derive('IFERROR(LAG(C01), 0)', series), [0, 10, 20, 30]);
  assert.deepEqual(derive('IFERROR(LAG(C01, 2), 0)', series), [0, 0, 10, 20]);
  assertClose(derive('IFERROR(PCTCHANGE(C01, LAG(C01)), 0)', series), [0, 100, 50, 100 / 3]);
  // Row 1 has no predecessor. Returning zero there would fabricate a data
  // point, so it fails until the author says what row 1 should show.
  assert.throws(() => derive('LAG(C01)', series), /LAG has no row 1 position/);
  assert.throws(() => derive('LAG(C01, 0)', series), /positive whole number/);
  assert.throws(() => derive('LAG(C01, 1.5)', series), /positive whole number/);
});

test('ZSCORE standardizes against the whole column, reusing the statistics panel\'s own sample SD', () => {
  const zScores = derive('ZSCORE(C01)', series);
  // mean 25; sample SD of [10,20,30,40] is sqrt(500/3) = 12.909944...
  assert.equal(zScores.length, 4);
  assert.ok(Math.abs(zScores[0] - -1.161895) < 1e-5);
  assert.ok(Math.abs(zScores[3] - 1.161895) < 1e-5);
  // Symmetric around the mean, so the column sums to zero.
  assert.ok(Math.abs(zScores.reduce((total, value) => total + value, 0)) < 1e-9);
});

test('a column-wide function refuses an argument that is not a bare column reference', () => {
  // ZSCORE and LAG read a column across every row, so "which column" has to
  // be answerable at parse time - an arbitrary sub-expression is not.
  assert.throws(() => derive('ZSCORE(C01 + 1)', series), /must be a column reference/);
  assert.throws(() => derive('LAG(C01 * 2)', series), /must be a column reference/);
  assert.throws(() => derive('ZSCORE(5)', series), /must be a column reference/);
});

test('ZSCORE refuses a column with no spread instead of dividing by zero', () => {
  const flat = { ...series, cells: [[7, 1], [7, 2], [7, 3], [7, 4]] };
  assert.throws(() => derive('ZSCORE(C01)', flat), /needs a column that varies/);
});

test('argument counts are checked when the formula is parsed, not when some row happens to hit it', () => {
  assert.throws(() => derive('ABS()'), /expects exactly 1 argument\(s\), received 0/);
  assert.throws(() => derive('ABS(1, 2)'), /expects exactly 1 argument\(s\), received 2/);
  assert.throws(() => derive('IF(1, 2)'), /expects exactly 3 argument\(s\), received 2/);
  assert.throws(() => derive('POWER(2)'), /expects exactly 2 argument\(s\), received 1/);
  assert.throws(() => derive('SUM()'), /expects at least 1 argument\(s\), received 0/);
  assert.throws(() => derive('ROUND(1, 2, 3)'), /expects between 1 and 2 argument\(s\), received 3/);
});

test('Portuguese aliases and pt-BR semicolon separators resolve to the same functions', () => {
  assert.deepEqual(derive('SOMA(C01; C02)'), derive('SUM(C01, C02)'));
  assert.deepEqual(derive('SE(C01 < 5; 0; C01)'), derive('IF(C01 < 5, 0, C01)'));
  assert.deepEqual(derive('MÉDIA(C01; C02)'), derive('AVERAGE(C01, C02)'));
  assert.deepEqual(derive('media(C01, C02)'), derive('AVERAGE(C01, C02)'), 'names are case-insensitive');
  assert.deepEqual(derive('TAXA(C01; C02)', series), derive('RATE(C01, C02)', series));
  assert.deepEqual(derive('RAIZ(C01)'), derive('SQRT(C01)'));
  assert.deepEqual(derive('RAZÃO(C01; 2)'), derive('RATIO(C01, 2)'));
});

test('functions nest, and compose with bracketed semantic column names', () => {
  assert.deepEqual(derive('ROUND(RATE([Óbitos], [População], 1000), 1)', series), [10, 10, 10, 10]);
  assert.deepEqual(derive('MAX(ABS(0 - C01), SUM(1, 2))'), [10, 4]);
  assert.deepEqual(derive('IF(SUM(C01, C02) > 10, ROUND(2.5, 0), 0)'), [3, 0]);
});

test('every name the UI may advertise is a name the parser actually accepts', () => {
  const names = tableExpressionFunctionNames();
  assert.ok(names.includes('SUM'));
  assert.ok(names.includes('RATE'));
  assert.ok(names.includes('SOMA'), 'aliases are advertised too');
  // COUNTIF is deliberately absent: its contract is a range plus a criteria
  // string, which this language has no honest way to mean.
  assert.ok(!names.includes('COUNTIF'));
  for (const name of names) {
    try {
      applyTableOperation(series, expression(`${name}(C01, C01, C01, C01)`));
    } catch (error) {
      assert.doesNotMatch(String(error), /unknown function/, `${name} is advertised but not callable`);
    }
  }
});

test('the documented catalog covers the whole registry, and every alias it lists really resolves', () => {
  const catalog = tableExpressionFunctionCatalog();
  const documented = new Set(catalog.map((entry) => entry.name));
  const canonical = tableExpressionFunctionNames().filter((name) => documented.has(name));
  // Every canonical function is documented, with a real signature and summary.
  assert.equal(documented.size, canonical.length);
  for (const entry of catalog) {
    assert.ok(entry.signature.startsWith(entry.name), `${entry.name} signature must name itself`);
    assert.ok(entry.summary.length > 10, `${entry.name} needs a real summary`);
    assert.ok(entry.group.length > 0);
    for (const alias of entry.aliases) {
      assert.ok(tableExpressionFunctionNames().includes(alias), `${alias} is documented but not accepted`);
    }
  }
  // Every alias the parser accepts is attributed to exactly one function.
  const aliasNames = tableExpressionFunctionNames().filter((name) => !documented.has(name));
  const attributed = catalog.flatMap((entry) => entry.aliases);
  assert.deepEqual([...aliasNames].sort(), [...attributed].sort());
});

test('the registry is closed, so host objects and methods are refused by name', () => {
  assert.throws(() => derive('eval(1)'), /unknown function eval/);
  assert.throws(() => derive('constructor(1)'), /unknown function constructor/);
  assert.throws(() => derive('globalThis.alert(1)'), /unknown function globalThis\.alert/);
  assert.throws(() => derive('toString(1)'), /unknown function toString/);
  assert.throws(() => derive('COUNTIF(C01, 1)'), /unknown function COUNTIF/);
});
