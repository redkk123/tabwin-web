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
      const actualValue = actualRow[c];
      const expectedValue = expectedRow[c];
      if (actualValue === undefined || expectedValue === undefined) continue;
      const delta = actualValue - expectedValue;
      if (Math.abs(delta) > tolerance) {
        cellDiffs.push({ row: r, column: c, expected: expectedValue, actual: actualValue, delta });
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
