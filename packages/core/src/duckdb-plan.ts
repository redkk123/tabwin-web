/**
 * Conservative DuckDB execution boundary.
 *
 * QueryPlan remains the semantic specification. This compiler accepts only a
 * raw-field subset whose SQL meaning can be stated without reproducing CNV,
 * lookup, substring or cross-field semantics in a second engine. Unsupported
 * plans are rejected with explicit blockers instead of silently drifting from
 * the reference executor.
 */

import type { QueryPlan, TabulationResult } from './model.js';
import { fieldsUsedByPlan } from './plan-fields.js';

export type DuckDbFieldKind = 'text' | 'number';
export type DuckDbSourceSchema = Readonly<Record<string, DuckDbFieldKind>>;

export interface DuckDbPlanSupport {
  supported: boolean;
  blockers: string[];
  requiredFields: string[];
}

export interface DuckDbSqlBundle {
  aggregateSql: string;
  countSql: string;
  parameters: Array<string | number>;
  countParameters: Array<string | number>;
  rowKeyColumn: '__row_key';
  columnKeyColumn: '__column_key';
  valueColumn: '__value';
  recordCountColumn: '__group_records';
}

export interface DuckDbAggregateRow {
  __row_key: string;
  __column_key: string;
  __value: number;
  __group_records: number;
}

export interface DuckDbCountRow {
  __records_seen: number;
  __records_accepted: number;
}

export interface DuckDbParityReport {
  identical: boolean;
  missingGroups: string[];
  unexpectedGroups: string[];
  changedGroups: Array<{ key: string; expected: number; actual: number }>;
  expectedRecordsSeen: number;
  actualRecordsSeen: number;
  expectedRecordsAccepted: number;
  actualRecordsAccepted: number;
}

function quoteIdentifier(identifier: string): string {
  const clean = identifier.trim();
  if (!clean) throw new Error('DuckDB identifier cannot be empty');
  return `"${clean.replace(/"/g, '""')}"`;
}

function fieldKind(schema: DuckDbSourceSchema, field: string): DuckDbFieldKind | undefined {
  return schema[field];
}

function dimensionBlockers(plan: QueryPlan): string[] {
  const blockers: string[] = [];
  for (const [label, dimension] of [['row', plan.spec.rows], ['column', plan.spec.columns]] as const) {
    if (!dimension) continue;
    if (dimension.conversionId) blockers.push(`${label} dimension uses CNV conversion ${dimension.conversionId}`);
    if (dimension.lookupId) blockers.push(`${label} dimension uses DBF lookup ${dimension.lookupId}`);
    if (dimension.startPosition !== undefined) blockers.push(`${label} dimension uses startPosition`);
    if (dimension.unclassifiedPolicy === 'discriminate') blockers.push(`${label} dimension discriminates unclassified values`);
  }
  return blockers;
}

/** Returns every reason the raw-SQL subset refuses the plan. */
export function analyzeDuckDbPlanSupport(plan: QueryPlan, schema: DuckDbSourceSchema): DuckDbPlanSupport {
  const blockers = dimensionBlockers(plan);
  if (plan.spec.measures?.length) blockers.push('multiple simultaneous measures are not compiled to DuckDB yet');
  if (plan.spec.crossFieldRules?.length) blockers.push('cross-field rules remain reference-executor only');

  for (const [index, filter] of plan.spec.filters.entries()) {
    if (filter.conversionId) blockers.push(`filter ${index + 1} uses CNV conversion ${filter.conversionId}`);
    if (filter.startPosition !== undefined) blockers.push(`filter ${index + 1} uses startPosition`);
    if (filter.kind === 'numeric-range' && fieldKind(schema, filter.field) !== 'number') {
      blockers.push(`numeric filter ${index + 1} requires field ${filter.field} to be declared numeric`);
    }
  }

  if (plan.spec.measure.kind === 'sum') {
    const field = plan.spec.measure.field!;
    if (fieldKind(schema, field) !== 'number') blockers.push(`sum field ${field} must be declared numeric`);
  }
  if (plan.spec.measure.weightField && fieldKind(schema, plan.spec.measure.weightField) !== 'number') {
    blockers.push(`frequency weight field ${plan.spec.measure.weightField} must be declared numeric`);
  }

  for (const field of fieldsUsedByPlan(plan)) {
    if (!fieldKind(schema, field)) blockers.push(`field ${field} is missing from the DuckDB source schema`);
  }

  return { supported: blockers.length === 0, blockers: [...new Set(blockers)], requiredFields: fieldsUsedByPlan(plan) };
}

function categoryPredicate(
  fieldSql: string,
  accepted: readonly string[],
  parameters: Array<string | number>,
): string {
  if (!accepted.length) return 'FALSE';
  parameters.push(...accepted);
  return `CAST(${fieldSql} AS VARCHAR) IN (${accepted.map(() => '?').join(', ')})`;
}

function numericRangePredicate(
  fieldSql: string,
  filter: Extract<QueryPlan['spec']['filters'][number], { kind: 'numeric-range' }>,
  parameters: Array<string | number>,
): string {
  const predicates: string[] = [];
  if (filter.minimum !== undefined) {
    parameters.push(filter.minimum);
    predicates.push(`${fieldSql} ${filter.includeMinimum === false ? '>' : '>='} ?`);
  }
  if (filter.maximum !== undefined) {
    parameters.push(filter.maximum);
    predicates.push(`${fieldSql} ${filter.includeMaximum === false ? '<' : '<='} ?`);
  }
  return predicates.length ? predicates.join(' AND ') : 'TRUE';
}

function filterWhere(plan: QueryPlan, parameters: Array<string | number>): string[] {
  return plan.spec.filters.map((filter) => {
    const field = quoteIdentifier(filter.field);
    const base = filter.kind === 'numeric-range'
      ? numericRangePredicate(field, filter, parameters)
      : categoryPredicate(field, filter.acceptedCategories, parameters);
    return filter.mode === 'exclude' ? `NOT (${base})` : `(${base})`;
  });
}

function dimensionPresencePredicate(field: string): string {
  const identifier = quoteIdentifier(field);
  // Reference raw dimensions omit null and empty-string values. Numeric values
  // stringify non-empty, so the VARCHAR check is safe for both declared kinds.
  return `${identifier} IS NOT NULL AND CAST(${identifier} AS VARCHAR) <> ''`;
}

/**
 * Compiles the supported raw subset to parameterized DuckDB SQL.
 *
 * A separate count statement keeps recordsSeen observable. The aggregate query
 * includes a per-group record count so accepted counts can be cross-checked as
 * well. Suppression of zero rows/columns and presentation ordering remain core
 * post-processing responsibilities; SQL is never allowed to redefine them.
 */
export function compileDuckDbSql(
  plan: QueryPlan,
  schema: DuckDbSourceSchema,
  tableName = 'records',
): DuckDbSqlBundle {
  const support = analyzeDuckDbPlanSupport(plan, schema);
  if (!support.supported) throw new Error(`DuckDB plan unsupported: ${support.blockers.join('; ')}`);
  const table = quoteIdentifier(tableName);
  const parameters: Array<string | number> = [];
  const predicates = [
    ...filterWhere(plan, parameters),
    dimensionPresencePredicate(plan.spec.rows.field),
    ...(plan.spec.columns ? [dimensionPresencePredicate(plan.spec.columns.field)] : []),
  ];
  const where = predicates.length ? `WHERE ${predicates.join('\n    AND ')}` : '';
  const rowKey = `CAST(${quoteIdentifier(plan.spec.rows.field)} AS VARCHAR)`;
  const columnKey = plan.spec.columns
    ? `CAST(${quoteIdentifier(plan.spec.columns.field)} AS VARCHAR)`
    : `'__single__'`;
  const value = plan.spec.measure.kind === 'sum'
    ? `SUM(${quoteIdentifier(plan.spec.measure.field!)})`
    : plan.spec.measure.weightField
      ? `SUM(COALESCE(${quoteIdentifier(plan.spec.measure.weightField)}, 0))`
      : 'COUNT(*)';
  const aggregateSql = [
    'SELECT',
    `  ${rowKey} AS __row_key,`,
    `  ${columnKey} AS __column_key,`,
    `  ${value} AS __value,`,
    '  COUNT(*) AS __group_records',
    `FROM ${table}`,
    where,
    'GROUP BY 1, 2',
    'ORDER BY 1, 2',
  ].filter(Boolean).join('\n');

  // Recompile predicates because positional parameters belong to this second
  // statement independently of the aggregate query.
  const countParameters: Array<string | number> = [];
  const countWhere = [
    ...filterWhere(plan, countParameters),
    dimensionPresencePredicate(plan.spec.rows.field),
    ...(plan.spec.columns ? [dimensionPresencePredicate(plan.spec.columns.field)] : []),
  ];
  const acceptedWhere = countWhere.length ? `WHERE ${countWhere.join('\n      AND ')}` : '';
  const countSql = [
    'SELECT',
    `  (SELECT COUNT(*) FROM ${table}) AS __records_seen,`,
    `  (SELECT COUNT(*) FROM ${table} ${acceptedWhere}) AS __records_accepted`,
  ].join('\n');

  return {
    aggregateSql,
    countSql,
    parameters,
    countParameters,
    rowKeyColumn: '__row_key',
    columnKeyColumn: '__column_key',
    valueColumn: '__value',
    recordCountColumn: '__group_records',
  };
}

function finiteNumber(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`DuckDB returned non-finite ${label}`);
  return number;
}

/** Runtime boundary compatible with DuckDB-Wasm, native DuckDB, or a worker. */
export interface DuckDbQueryAdapter {
  query(sql: string, parameters: readonly (string | number)[]): Promise<readonly Record<string, unknown>[]>;
}

export async function runDuckDbAggregation(
  adapter: DuckDbQueryAdapter,
  bundle: DuckDbSqlBundle,
): Promise<{ aggregates: DuckDbAggregateRow[]; counts: DuckDbCountRow }> {
  const [aggregateRows, countRows] = await Promise.all([
    adapter.query(bundle.aggregateSql, bundle.parameters),
    adapter.query(bundle.countSql, bundle.countParameters),
  ]);
  const aggregates = aggregateRows.map((row): DuckDbAggregateRow => ({
    __row_key: String(row.__row_key ?? ''),
    __column_key: String(row.__column_key ?? ''),
    __value: finiteNumber(row.__value, '__value'),
    __group_records: finiteNumber(row.__group_records, '__group_records'),
  }));
  const count = countRows[0];
  if (!count) throw new Error('DuckDB count query returned no row');
  return {
    aggregates,
    counts: {
      __records_seen: finiteNumber(count.__records_seen, '__records_seen'),
      __records_accepted: finiteNumber(count.__records_accepted, '__records_accepted'),
    },
  };
}

/**
 * Hard parity gate before a DuckDB answer may replace the reference executor.
 * Axis labels/order are intentionally not sourced from SQL; this compares the
 * grouped numeric facts and record counts only.
 */
export function compareDuckDbAggregationToReference(
  reference: TabulationResult,
  aggregates: readonly DuckDbAggregateRow[],
  counts: DuckDbCountRow,
): DuckDbParityReport {
  const expected = new Map<string, number>();
  reference.rows.forEach((row, rowIndex) => {
    reference.columns.forEach((column, columnIndex) => {
      const value = reference.cells[rowIndex]?.[columnIndex] ?? 0;
      // Raw axes contain only observed categories, so zero-valued cells can be
      // absent from SQL GROUP BY while still appearing in the dense matrix.
      if (value !== 0) expected.set(`${row.key}\u0000${column.key}`, value);
    });
  });
  const actual = new Map<string, number>();
  for (const row of aggregates) {
    const key = `${row.__row_key}\u0000${row.__column_key}`;
    actual.set(key, (actual.get(key) ?? 0) + row.__value);
  }

  const missingGroups: string[] = [];
  const unexpectedGroups: string[] = [];
  const changedGroups: Array<{ key: string; expected: number; actual: number }> = [];
  for (const [key, value] of expected) {
    const observed = actual.get(key);
    if (observed === undefined) missingGroups.push(key);
    else if (observed !== value) changedGroups.push({ key, expected: value, actual: observed });
  }
  for (const [key, value] of actual) {
    if (!expected.has(key) && value !== 0) unexpectedGroups.push(key);
  }
  const actualRecordsSeen = counts.__records_seen;
  const actualRecordsAccepted = counts.__records_accepted;
  return {
    identical: missingGroups.length === 0 && unexpectedGroups.length === 0 && changedGroups.length === 0
      && actualRecordsSeen === reference.recordsSeen && actualRecordsAccepted === reference.recordsAccepted,
    missingGroups,
    unexpectedGroups,
    changedGroups,
    expectedRecordsSeen: reference.recordsSeen,
    actualRecordsSeen,
    expectedRecordsAccepted: reference.recordsAccepted,
    actualRecordsAccepted,
  };
}
