import type { TabulationResult } from '../../core/src/model.js';

/**
 * Generalized table comparison for TabWin Web.
 *
 * Safety defaults:
 * - exact row-key matching unless the user explicitly selects another policy;
 * - duplicate keys are errors, never silently aggregated;
 * - unmatched rows are diagnosed, never silently dropped;
 * - division-by-zero yields null in comparison metrics, never a fabricated zero;
 * - source tables are immutable.
 */

export type TableJoinMode = 'inner' | 'left' | 'right' | 'full';
export type RowMatchMode = 'key' | 'normalized-label' | 'explicit-map';

export interface ColumnPairSpec {
  id: string;
  leftColumnKey: string;
  rightColumnKey: string;
  label?: string;
}

export interface ExplicitRowMapping {
  leftRowKey: string;
  rightRowKey: string;
}

export interface TableComparisonPlan {
  version: 1;
  leftLabel: string;
  rightLabel: string;
  join: TableJoinMode;
  rowMatch: RowMatchMode;
  requireMatchingLabelsWhenKeyMatches?: boolean;
  explicitRowMappings?: ExplicitRowMapping[];
  columnPairs: ColumnPairSpec[];
  relativeDifferenceDenominator?: 'left' | 'right';
}

export type MatchStatus = 'matched' | 'left-only' | 'right-only';

export interface ComparisonMetricCell {
  left: number | null;
  right: number | null;
  difference: number | null; // right - left
  absoluteDifference: number | null;
  relativeDifferencePct: number | null;
  ratioRightToLeft: number | null;
}

export interface TableComparisonRow {
  id: string;
  status: MatchStatus;
  leftRowKey?: string;
  rightRowKey?: string;
  leftLabel?: string;
  rightLabel?: string;
  displayLabel: string;
  metrics: Record<string, ComparisonMetricCell>;
}

export interface PairSummary {
  pairId: string;
  matchedNumericRows: number;
  meanAbsoluteDifference?: number;
  rootMeanSquaredDifference?: number;
  meanAbsolutePercentageError?: number;
  pearsonCorrelation?: number;
}

export interface TableComparisonDiagnostics {
  leftRows: number;
  rightRows: number;
  matchedRows: number;
  leftOnlyRows: number;
  rightOnlyRows: number;
  leftCoverage: number;
  rightCoverage: number;
  labelMismatches: Array<{
    leftRowKey: string;
    rightRowKey: string;
    leftLabel: string;
    rightLabel: string;
  }>;
}

export interface TableComparisonResult {
  plan: TableComparisonPlan;
  rows: TableComparisonRow[];
  diagnostics: TableComparisonDiagnostics;
  pairSummaries: PairSummary[];
  warnings: string[];
}

interface RowRef {
  key: string;
  label: string;
  index: number;
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

function indexUniqueRows(table: TabulationResult, side: 'left' | 'right'): Map<string, RowRef> {
  const output = new Map<string, RowRef>();
  table.rows.forEach((row, index) => {
    if (!row.key) throw new Error(`${side} table contains an empty row key`);
    if (output.has(row.key)) throw new Error(`${side} table contains duplicate row key: ${row.key}`);
    output.set(row.key, { key: row.key, label: row.label, index });
  });
  return output;
}

function indexUniqueLabels(table: TabulationResult, side: 'left' | 'right'): Map<string, RowRef> {
  const output = new Map<string, RowRef>();
  table.rows.forEach((row, index) => {
    const normalized = normalizeLabel(row.label);
    if (!normalized) throw new Error(`${side} table contains an empty normalized row label`);
    if (output.has(normalized)) {
      throw new Error(`${side} table contains ambiguous normalized row label: ${row.label}`);
    }
    output.set(normalized, { key: row.key, label: row.label, index });
  });
  return output;
}

function columnIndex(table: TabulationResult, key: string, side: 'left' | 'right'): number {
  const index = table.columns.findIndex((column) => column.key === key);
  if (index < 0) throw new Error(`${side} table is missing column: ${key}`);
  return index;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricCell(
  left: number | null,
  right: number | null,
  denominatorPolicy: 'left' | 'right',
): ComparisonMetricCell {
  if (left === null || right === null) {
    return {
      left,
      right,
      difference: null,
      absoluteDifference: null,
      relativeDifferencePct: null,
      ratioRightToLeft: null,
    };
  }
  const difference = right - left;
  const denominator = denominatorPolicy === 'left' ? left : right;
  return {
    left,
    right,
    difference,
    absoluteDifference: Math.abs(difference),
    relativeDifferencePct: denominator === 0 ? null : difference / denominator * 100,
    ratioRightToLeft: left === 0 ? null : right / left,
  };
}

function pearson(left: readonly number[], right: readonly number[]): number | undefined {
  if (left.length !== right.length || left.length < 2) return undefined;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftSq = 0;
  let rightSq = 0;
  for (let i = 0; i < left.length; i++) {
    const lx = left[i]! - leftMean;
    const ry = right[i]! - rightMean;
    covariance += lx * ry;
    leftSq += lx ** 2;
    rightSq += ry ** 2;
  }
  const denominator = Math.sqrt(leftSq * rightSq);
  return denominator > 0 ? covariance / denominator : undefined;
}

function pairSummary(rows: readonly TableComparisonRow[], pairId: string): PairSummary {
  const pairs = rows
    .map((row) => row.metrics[pairId])
    .filter((cell): cell is ComparisonMetricCell => Boolean(cell && cell.left !== null && cell.right !== null));
  if (!pairs.length) return { pairId, matchedNumericRows: 0 };
  const differences = pairs.map((cell) => cell.difference!);
  const abs = differences.map(Math.abs);
  const mae = abs.reduce((sum, value) => sum + value, 0) / abs.length;
  const rmse = Math.sqrt(differences.reduce((sum, value) => sum + value ** 2, 0) / differences.length);
  const ape = pairs
    .filter((cell) => cell.left !== 0)
    .map((cell) => Math.abs((cell.right! - cell.left!) / cell.left!));
  const left = pairs.map((cell) => cell.left!);
  const right = pairs.map((cell) => cell.right!);
  const correlation = pearson(left, right);
  return {
    pairId,
    matchedNumericRows: pairs.length,
    meanAbsoluteDifference: mae,
    rootMeanSquaredDifference: rmse,
    ...(ape.length ? { meanAbsolutePercentageError: ape.reduce((sum, value) => sum + value, 0) / ape.length * 100 } : {}),
    ...(correlation === undefined ? {} : { pearsonCorrelation: correlation }),
  };
}

function validatePlan(plan: TableComparisonPlan): void {
  if (plan.version !== 1) throw new Error(`unsupported comparison plan version: ${plan.version}`);
  if (!plan.leftLabel.trim() || !plan.rightLabel.trim()) throw new Error('comparison requires labels for both sources');
  if (!plan.columnPairs.length) throw new Error('comparison requires at least one column pair');
  const ids = new Set<string>();
  for (const pair of plan.columnPairs) {
    if (!pair.id.trim()) throw new Error('comparison pair requires an id');
    if (ids.has(pair.id)) throw new Error(`duplicate comparison pair id: ${pair.id}`);
    ids.add(pair.id);
    if (!pair.leftColumnKey.trim() || !pair.rightColumnKey.trim()) {
      throw new Error(`comparison pair ${pair.id} requires both column keys`);
    }
  }
  if (plan.rowMatch === 'explicit-map' && !plan.explicitRowMappings?.length) {
    throw new Error('explicit-map row matching requires explicitRowMappings');
  }
}

function buildMatches(
  left: TabulationResult,
  right: TabulationResult,
  plan: TableComparisonPlan,
): Array<{ left?: RowRef; right?: RowRef }> {
  const leftByKey = indexUniqueRows(left, 'left');
  const rightByKey = indexUniqueRows(right, 'right');
  const matched: Array<{ left?: RowRef; right?: RowRef }> = [];
  const usedRight = new Set<string>();

  if (plan.rowMatch === 'key') {
    for (const leftRow of left.rows.map((row, index) => ({ key: row.key, label: row.label, index }))) {
      const rightRow = rightByKey.get(leftRow.key);
      if (rightRow) usedRight.add(rightRow.key);
      if (rightRow) matched.push({ left: leftRow, right: rightRow });
      else if (plan.join === 'left' || plan.join === 'full') matched.push({ left: leftRow });
    }
  } else if (plan.rowMatch === 'normalized-label') {
    const rightByLabel = indexUniqueLabels(right, 'right');
    indexUniqueLabels(left, 'left'); // validates ambiguity on the left too.
    for (const leftRow of left.rows.map((row, index) => ({ key: row.key, label: row.label, index }))) {
      const rightRow = rightByLabel.get(normalizeLabel(leftRow.label));
      if (rightRow) usedRight.add(rightRow.key);
      if (rightRow) matched.push({ left: leftRow, right: rightRow });
      else if (plan.join === 'left' || plan.join === 'full') matched.push({ left: leftRow });
    }
  } else {
    const leftMapped = new Set<string>();
    const rightMapped = new Set<string>();
    for (const mapping of plan.explicitRowMappings ?? []) {
      if (leftMapped.has(mapping.leftRowKey)) throw new Error(`left row mapped twice: ${mapping.leftRowKey}`);
      if (rightMapped.has(mapping.rightRowKey)) throw new Error(`right row mapped twice: ${mapping.rightRowKey}`);
      const leftRow = leftByKey.get(mapping.leftRowKey);
      const rightRow = rightByKey.get(mapping.rightRowKey);
      if (!leftRow) throw new Error(`explicit mapping references missing left row: ${mapping.leftRowKey}`);
      if (!rightRow) throw new Error(`explicit mapping references missing right row: ${mapping.rightRowKey}`);
      leftMapped.add(leftRow.key);
      rightMapped.add(rightRow.key);
      usedRight.add(rightRow.key);
      matched.push({ left: leftRow, right: rightRow });
    }
    if (plan.join === 'left' || plan.join === 'full') {
      for (const row of left.rows.map((item, index) => ({ key: item.key, label: item.label, index }))) {
        if (!leftMapped.has(row.key)) matched.push({ left: row });
      }
    }
  }

  if (plan.join === 'right' || plan.join === 'full') {
    for (const rightRow of right.rows.map((row, index) => ({ key: row.key, label: row.label, index }))) {
      if (!usedRight.has(rightRow.key)) matched.push({ right: rightRow });
    }
  }

  if (plan.join === 'inner') return matched.filter((entry) => entry.left && entry.right);
  if (plan.join === 'right') return matched.filter((entry) => entry.right);
  return matched;
}

export function compareTables(
  left: TabulationResult,
  right: TabulationResult,
  plan: TableComparisonPlan,
): TableComparisonResult {
  validatePlan(plan);
  const denominatorPolicy = plan.relativeDifferenceDenominator ?? 'left';
  const columnPairs = plan.columnPairs.map((pair) => ({
    pair,
    leftIndex: columnIndex(left, pair.leftColumnKey, 'left'),
    rightIndex: columnIndex(right, pair.rightColumnKey, 'right'),
  }));
  const matches = buildMatches(left, right, plan);
  const labelMismatches: TableComparisonDiagnostics['labelMismatches'] = [];

  const rows: TableComparisonRow[] = matches.map((match, ordinal) => {
    const status: MatchStatus = match.left && match.right ? 'matched' : match.left ? 'left-only' : 'right-only';
    if (match.left && match.right && match.left.label !== match.right.label) {
      labelMismatches.push({
        leftRowKey: match.left.key,
        rightRowKey: match.right.key,
        leftLabel: match.left.label,
        rightLabel: match.right.label,
      });
      if (plan.requireMatchingLabelsWhenKeyMatches && plan.rowMatch === 'key') {
        throw new Error(`row label mismatch for key ${match.left.key}: ${match.left.label} != ${match.right.label}`);
      }
    }
    const metrics: Record<string, ComparisonMetricCell> = {};
    for (const { pair, leftIndex, rightIndex } of columnPairs) {
      const leftValue = match.left ? finiteOrNull(left.cells[match.left.index]?.[leftIndex]) : null;
      const rightValue = match.right ? finiteOrNull(right.cells[match.right.index]?.[rightIndex]) : null;
      metrics[pair.id] = metricCell(leftValue, rightValue, denominatorPolicy);
    }
    return {
      id: `${status}:${match.left?.key ?? ''}:${match.right?.key ?? ''}:${ordinal}`,
      status,
      ...(match.left ? { leftRowKey: match.left.key, leftLabel: match.left.label } : {}),
      ...(match.right ? { rightRowKey: match.right.key, rightLabel: match.right.label } : {}),
      displayLabel: match.left?.label ?? match.right?.label ?? `Linha ${ordinal + 1}`,
      metrics,
    };
  });

  const matchedRows = rows.filter((row) => row.status === 'matched').length;
  const leftOnlyRows = rows.filter((row) => row.status === 'left-only').length;
  const rightOnlyRows = rows.filter((row) => row.status === 'right-only').length;
  const diagnostics: TableComparisonDiagnostics = {
    leftRows: left.rows.length,
    rightRows: right.rows.length,
    matchedRows,
    leftOnlyRows,
    rightOnlyRows,
    leftCoverage: left.rows.length ? matchedRows / left.rows.length : 0,
    rightCoverage: right.rows.length ? matchedRows / right.rows.length : 0,
    labelMismatches,
  };

  const warnings: string[] = [];
  if (leftOnlyRows || rightOnlyRows) {
    warnings.push(`${leftOnlyRows} row(s) exist only in ${plan.leftLabel}; ${rightOnlyRows} only in ${plan.rightLabel}`);
  }
  if (labelMismatches.length) warnings.push(`${labelMismatches.length} matched row(s) have different labels`);
  if (plan.rowMatch !== 'key') warnings.push(`Rows were matched using explicit modern policy: ${plan.rowMatch}`);

  return {
    plan,
    rows,
    diagnostics,
    pairSummaries: plan.columnPairs.map((pair) => pairSummary(rows, pair.id)),
    warnings,
  };
}
