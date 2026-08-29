import type { TabulationResult } from './model.js';

export interface GoldenTableV1 {
  schema: 'tabwin-web.golden-table';
  version: 1;
  /** Human-readable id such as G001-SIH-RDAC2401-frequency-by-sex. */
  id: string;
  source: {
    referenceEngine: string;
    notes?: string;
  };
  rows: Array<{ key?: string; label: string }>;
  columns: Array<{ key?: string; label: string }>;
  cells: number[][];
}

export interface GoldenCellDiff {
  row: number;
  column: number;
  expected: number;
  actual: number;
  delta: number;
}

export interface GoldenComparison {
  pass: boolean;
  rowLabelsMatch: boolean;
  columnLabelsMatch: boolean;
  shapeMatch: boolean;
  cellDiffs: GoldenCellDiff[];
  messages: string[];
}

export interface CompareGoldenOptions {
  absoluteTolerance?: number;
  /**
   * Compare both sides rounded to this many decimal places, taken from the
   * **source field's own declared decimal count in the DBF header** — never
   * picked to make a case pass.
   *
   * Why this exists, and why it is not a softened tolerance: a `sum` over
   * thousands of IEEE-754 doubles accumulates last-bit rounding drift whose
   * exact value depends on the order and register width of every addition.
   * G003 measured this against the real engine — over 4,153 records of
   * `VAL_TOT`, TabWin 4.15 and this executor land exactly **1 ULP** apart
   * (4.66e-10 on a value of ~3.0e6), with our result marginally *closer* to
   * the mathematically exact sum than TabWin's. Demanding bit-identical
   * doubles would require replicating a Delphi application's FPU instruction
   * sequence — that is emulation, not semantic compatibility, and it would
   * fail a result that is more correct than the reference.
   *
   * `VAL_TOT` declares 2 decimals in the DBF header, so the data itself has
   * no meaning below a cent. Comparing past that compares noise. Counts stay
   * on the default exact path: leave this undefined for integer measures, so
   * a genuine off-by-one can never hide behind rounding.
   */
  decimalPlaces?: number;
}

function roundToDecimals(value: number, decimalPlaces: number | undefined): number {
  if (decimalPlaces === undefined) return value;
  const scale = 10 ** decimalPlaces;
  return Math.round(value * scale) / scale;
}

export function compareWithGolden(
  actual: TabulationResult,
  golden: GoldenTableV1,
  options: CompareGoldenOptions = {},
): GoldenComparison {
  const tolerance = options.absoluteTolerance ?? 0;
  if (tolerance < 0 || !Number.isFinite(tolerance)) {
    throw new Error('absoluteTolerance must be a finite non-negative number');
  }
  const { decimalPlaces } = options;
  if (decimalPlaces !== undefined && (!Number.isInteger(decimalPlaces) || decimalPlaces < 0)) {
    throw new Error('decimalPlaces must be a non-negative integer when provided');
  }

  const actualRows = actual.rows.map((row) => row.label);
  const expectedRows = golden.rows.map((row) => row.label);
  const actualColumns = actual.columns.map((column) => column.label);
  const expectedColumns = golden.columns.map((column) => column.label);
  const rowLabelsMatch = JSON.stringify(actualRows) === JSON.stringify(expectedRows);
  const columnLabelsMatch = JSON.stringify(actualColumns) === JSON.stringify(expectedColumns);
  const shapeMatch =
    actual.cells.length === golden.cells.length &&
    actual.cells.every((row, index) => row.length === (golden.cells[index]?.length ?? -1));

  const cellDiffs: GoldenCellDiff[] = [];
  const rowCount = Math.max(actual.cells.length, golden.cells.length);
  for (let r = 0; r < rowCount; r++) {
    const actualRow = actual.cells[r] ?? [];
    const expectedRow = golden.cells[r] ?? [];
    const columnCount = Math.max(actualRow.length, expectedRow.length);
    for (let c = 0; c < columnCount; c++) {
      const rawActual = actualRow[c];
      const rawExpected = expectedRow[c];
      if (rawActual === undefined || rawExpected === undefined) continue;
      const actualValue = roundToDecimals(rawActual, decimalPlaces);
      const expectedValue = roundToDecimals(rawExpected, decimalPlaces);
      const delta = actualValue - expectedValue;
      if (Math.abs(delta) > tolerance) {
        // Report the raw values, so evidence keeps the doubles the engines
        // actually produced even when the decision was made at cent precision.
        cellDiffs.push({ row: r, column: c, expected: rawExpected, actual: rawActual, delta: rawActual - rawExpected });
      }
    }
  }

  const messages: string[] = [];
  if (!rowLabelsMatch) messages.push('row labels/order differ');
  if (!columnLabelsMatch) messages.push('column labels/order differ');
  if (!shapeMatch) messages.push('table shape differs');
  if (cellDiffs.length) messages.push(`${cellDiffs.length} cell(s) differ beyond tolerance ${tolerance}`);

  return {
    pass: rowLabelsMatch && columnLabelsMatch && shapeMatch && cellDiffs.length === 0,
    rowLabelsMatch,
    columnLabelsMatch,
    shapeMatch,
    cellDiffs,
    messages,
  };
}
