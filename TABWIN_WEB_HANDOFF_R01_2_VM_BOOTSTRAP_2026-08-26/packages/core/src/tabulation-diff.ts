/**
 * Pure structural and numeric diff between two {@link TabulationResult}s.
 *
 * Backs "atualizar esta análise" (§18 of the master spec) and the tabulation
 * log's "compare with current" action: a user reruns an analysis after
 * changing a filter, adding a cross-field rule, or reopening an updated
 * source, and needs to see exactly what moved — not just the two full
 * tables side by side.
 *
 * Axis identity is decided by `key`, never by `label` or position. A label
 * can change under presentation settings (municipality name lookup, a
 * rename) without the underlying category changing, and row order is not
 * stable across every operation (sort, transpose). Key equality is the one
 * thing the executor guarantees stays meaningful across two runs of a
 * comparable plan.
 */

import type { ResultAxisItem, TabulationResult } from './model.js';

export interface AxisDiff {
  /** Present only in the "after" result, in its order. */
  added: ResultAxisItem[];
  /** Present only in the "before" result, in its order. */
  removed: ResultAxisItem[];
  /** Keys present in both, in "after" order. */
  commonKeys: string[];
}

export interface CellDelta {
  rowKey: string;
  rowLabel: string;
  columnKey: string;
  columnLabel: string;
  before: number;
  after: number;
  delta: number;
}

export interface TabulationDiff {
  rows: AxisDiff;
  columns: AxisDiff;
  /** Only cells at a (rowKey, columnKey) present in both results, and only
   *  where the value actually changed — a diff, not a full cross join. */
  changedCells: CellDelta[];
  recordsSeenDelta: number;
  recordsAcceptedDelta: number;
  /** True when nothing observable changed: same axes, same cells, same counts. */
  identical: boolean;
}

function diffAxis(before: readonly ResultAxisItem[], after: readonly ResultAxisItem[]): AxisDiff {
  const beforeByKey = new Map(before.map((item) => [item.key, item]));
  const afterByKey = new Map(after.map((item) => [item.key, item]));
  return {
    added: after.filter((item) => !beforeByKey.has(item.key)),
    removed: before.filter((item) => !afterByKey.has(item.key)),
    commonKeys: after.filter((item) => beforeByKey.has(item.key)).map((item) => item.key),
  };
}

/**
 * `before`/`after` name which side of the comparison a result plays, not
 * which was computed first — that lets the caller compare in either
 * direction without renaming variables at the call site.
 */
export function diffTabulationResults(before: TabulationResult, after: TabulationResult): TabulationDiff {
  const rows = diffAxis(before.rows, after.rows);
  const columns = diffAxis(before.columns, after.columns);

  const beforeRowIndex = new Map(before.rows.map((row, index) => [row.key, index]));
  const afterRowIndex = new Map(after.rows.map((row, index) => [row.key, index]));
  const beforeColumnIndex = new Map(before.columns.map((column, index) => [column.key, index]));
  const afterColumnIndex = new Map(after.columns.map((column, index) => [column.key, index]));
  const afterRowByKey = new Map(after.rows.map((row) => [row.key, row]));
  const afterColumnByKey = new Map(after.columns.map((column) => [column.key, column]));

  const changedCells: CellDelta[] = [];
  for (const rowKey of rows.commonKeys) {
    const beforeRowIdx = beforeRowIndex.get(rowKey)!;
    const afterRowIdx = afterRowIndex.get(rowKey)!;
    for (const columnKey of columns.commonKeys) {
      const beforeColIdx = beforeColumnIndex.get(columnKey)!;
      const afterColIdx = afterColumnIndex.get(columnKey)!;
      const beforeValue = before.cells[beforeRowIdx]?.[beforeColIdx] ?? 0;
      const afterValue = after.cells[afterRowIdx]?.[afterColIdx] ?? 0;
      if (beforeValue === afterValue) continue;
      changedCells.push({
        rowKey,
        rowLabel: afterRowByKey.get(rowKey)!.label,
        columnKey,
        columnLabel: afterColumnByKey.get(columnKey)!.label,
        before: beforeValue,
        after: afterValue,
        delta: afterValue - beforeValue,
      });
    }
  }

  const recordsSeenDelta = after.recordsSeen - before.recordsSeen;
  const recordsAcceptedDelta = after.recordsAccepted - before.recordsAccepted;

  return {
    rows,
    columns,
    changedCells,
    recordsSeenDelta,
    recordsAcceptedDelta,
    identical: rows.added.length === 0 && rows.removed.length === 0
      && columns.added.length === 0 && columns.removed.length === 0
      && changedCells.length === 0 && recordsSeenDelta === 0 && recordsAcceptedDelta === 0,
  };
}
