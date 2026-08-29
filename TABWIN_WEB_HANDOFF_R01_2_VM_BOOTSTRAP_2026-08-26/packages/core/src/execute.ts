import type { CnvDefinition } from '../../formats/src/cnv-model.js';
import { classifyCnv } from '../../formats/src/cnv-match.js';
import type {
  CrossFieldRuleSpec,
  DataRecord,
  DimensionSpec,
  FilterSpec,
  QueryPlan,
  ResultAxisItem,
  TabulationResult,
} from './model.js';

export type ConversionRegistry = Readonly<Record<string, CnvDefinition>>;

interface ResolvedDimension {
  key?: string;
  label?: string;
}

export interface ResolvedPlanRecord {
  rowKey: string;
  rowLabel: string;
  columnKey: string;
  columnLabel: string;
}

const UNCLASSIFIED_KEY = '__tabwin_web_unclassified__';
const UNCLASSIFIED_LABEL = 'Não classificados';

function singleColumnLabel(plan: QueryPlan): string {
  // G001's lossless TabWin 4.15 export establishes the count header exactly.
  // G003 established the sum header: the real engine uses the DEF increment's
  // own label ("Valor Total" for VAL_TOT), not a generic word. "Valor" remains
  // only for a sum with no increment label behind it — a case TabWin has no
  // precedent for, since its sums always come from a DEF increment.
  if (plan.spec.measure.kind !== 'count') return plan.spec.measure.label ?? 'Valor';
  return plan.spec.compatibilityProfile === 'tabwin-4.15' ? 'Freqüência' : 'Frequência';
}

function getConversion(registry: ConversionRegistry, id: string): CnvDefinition {
  const definition = registry[id];
  if (!definition) throw new Error(`missing conversion: ${id}`);
  return definition;
}

function extractSourceValue(
  record: DataRecord,
  field: string,
  startPosition: number | undefined,
  conversion: CnvDefinition | undefined,
): unknown {
  const raw = record[field];
  if (raw === null || raw === undefined) return raw;

  // Numeric range CNVs operate on the numeric value itself when the documented
  // position is the default 1. Converting a numeric DBF field to text and slicing
  // it would corrupt decimal semantics.
  if (conversion?.mode === 'numeric-ranges' && (startPosition ?? 1) === 1) return raw;

  if (startPosition === undefined && conversion === undefined) return raw;
  const start = (startPosition ?? 1) - 1;
  const text = String(raw);
  const length = conversion?.codeLength;
  return length === undefined ? text.slice(start) : text.slice(start, start + length);
}

function resolveDimension(
  record: DataRecord,
  dimension: DimensionSpec,
  conversions: ConversionRegistry,
): ResolvedDimension {
  const definition = dimension.conversionId
    ? getConversion(conversions, dimension.conversionId)
    : undefined;
  const raw = extractSourceValue(
    record,
    dimension.field,
    dimension.startPosition,
    definition,
  );
  if (!definition) {
    if (raw === null || raw === undefined || raw === '') {
      return dimension.unclassifiedPolicy === 'discriminate'
        ? { key: UNCLASSIFIED_KEY, label: UNCLASSIFIED_LABEL } : {};
    }
    const value = String(raw);
    return { key: value, label: value };
  }

  const match = classifyCnv(definition, raw);
  if (!match) {
    return dimension.unclassifiedPolicy === 'discriminate'
      ? { key: UNCLASSIFIED_KEY, label: UNCLASSIFIED_LABEL } : {};
  }
  return { key: String(match.sequence), label: match.label };
}

function acceptsFilter(
  record: DataRecord,
  filter: FilterSpec,
  conversions: ConversionRegistry,
): boolean {
  const definition = filter.conversionId
    ? getConversion(conversions, filter.conversionId)
    : undefined;
  const raw = extractSourceValue(record, filter.field, filter.startPosition, definition);
  let matches: boolean;
  if (filter.kind === 'numeric-range') {
    const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(value)) matches = false;
    else {
      const aboveMinimum = filter.minimum === undefined
        || (filter.includeMinimum === false ? value > filter.minimum : value >= filter.minimum);
      const belowMaximum = filter.maximum === undefined
        || (filter.includeMaximum === false ? value < filter.maximum : value <= filter.maximum);
      matches = aboveMinimum && belowMaximum;
    }
  } else if (!definition) {
    matches = filter.acceptedCategories.includes(String(raw ?? ''));
  } else {
    const match = classifyCnv(definition, raw);
    matches = match
      ? filter.acceptedCategories.includes(String(match.sequence))
      : filter.includeUnclassified === true;
  }
  return filter.mode === 'exclude' ? !matches : matches;
}

function axisFromDimension(
  dimension: DimensionSpec,
  conversions: ConversionRegistry,
  observed: Map<string, string>,
): ResultAxisItem[] {
  if (dimension.conversionId) {
    const definition = getConversion(conversions, dimension.conversionId);
    const items: ResultAxisItem[] = definition.categories.map((category) => ({
      key: String(category.sequence),
      label: category.label || String(category.sequence),
      source: 'conversion',
      ...(category.subtotalTarget !== undefined
        ? { subtotalTargetKey: String(category.subtotalTarget) }
        : {}),
      ...(category.excludeFromTotal ? { excludeFromTotal: true } : {}),
    }));
    if (dimension.unclassifiedPolicy === 'discriminate') {
      items.push({ key: UNCLASSIFIED_KEY, label: UNCLASSIFIED_LABEL, source: 'conversion' });
    }
    return items;
  }
  return [...observed.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([key, label]) => ({ key, label, source: 'raw' as const }));
}

function numericFieldValue(
  record: DataRecord,
  field: string,
  warnings: Set<string>,
  context: string,
): number {
  const raw = record[field];
  if (raw === null || raw === undefined || raw === '') return 0;
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(value)) {
    warnings.add(`non-numeric value encountered in ${context} field ${field}; treated as zero`);
    return 0;
  }
  return value;
}

function measureValue(record: DataRecord, plan: QueryPlan, warnings: Set<string>): number {
  if (plan.spec.measure.kind === 'count') {
    const weightField = plan.spec.measure.weightField;
    return weightField ? numericFieldValue(record, weightField, warnings, 'grouped-frequency') : 1;
  }
  const field = plan.spec.measure.field;
  if (!field) return 0;
  return numericFieldValue(record, field, warnings, 'sum');
}

/**
 * Resolves the exact record-acceptance boundary shared by tabulation and
 * record-level exports. A record rejected by filters or omitted dimensions
 * returns undefined.
 */
/**
 * True when every condition accepts the record, i.e. the implausible
 * combination the rule describes is present.
 */
export function crossFieldRuleMatches(
  record: DataRecord,
  rule: CrossFieldRuleSpec,
  conversions: ConversionRegistry = {},
): boolean {
  return rule.conditions.every((condition) => acceptsFilter(record, condition, conversions));
}

/**
 * Exclusion is decided here rather than in the executor so that every caller
 * of {@link resolvePlanRecord} — tabulation, selected-record export — applies
 * the same cleaning policy instead of diverging.
 */
export function excludedByCrossFieldRules(
  record: DataRecord,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): boolean {
  return (plan.spec.crossFieldRules ?? []).some((rule) =>
    rule.action === 'exclude' && crossFieldRuleMatches(record, rule, conversions));
}

export function resolvePlanRecord(
  record: DataRecord,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): ResolvedPlanRecord | undefined {
  if (excludedByCrossFieldRules(record, plan, conversions)) return undefined;
  if (!plan.spec.filters.every((filter) => acceptsFilter(record, filter, conversions))) return undefined;
  const row = resolveDimension(record, plan.spec.rows, conversions);
  if (!row.key || row.label === undefined) return undefined;
  const column = plan.spec.columns
    ? resolveDimension(record, plan.spec.columns, conversions)
    : { key: '__single__', label: singleColumnLabel(plan) };
  if (!column.key || column.label === undefined) return undefined;
  return { rowKey: row.key, rowLabel: row.label, columnKey: column.key, columnLabel: column.label };
}

function propagateRowSubtotals(rows: ResultAxisItem[], cells: number[][]): void {
  const indexByKey = new Map(rows.map((row, index) => [row.key, index]));
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const depthMemo = new Map<string, number>();

  const depth = (key: string, trail = new Set<string>()): number => {
    const cached = depthMemo.get(key);
    if (cached !== undefined) return cached;
    if (trail.has(key)) throw new Error(`subtotal cycle detected at row ${key}`);
    trail.add(key);
    const target = rowByKey.get(key)?.subtotalTargetKey;
    const value = target && rowByKey.has(target) ? 1 + depth(target, trail) : 0;
    trail.delete(key);
    depthMemo.set(key, value);
    return value;
  };

  // Deepest details move first. A parent therefore already contains all of its
  // descendants when it is propagated to a higher-level subtotal.
  const ordered = [...rows].sort((a, b) => depth(b.key) - depth(a.key));
  for (const row of ordered) {
    const targetKey = row.subtotalTargetKey;
    if (!targetKey) continue;
    const sourceIndex = indexByKey.get(row.key);
    const targetIndex = indexByKey.get(targetKey);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    const source = cells[sourceIndex];
    const target = cells[targetIndex];
    if (!source || !target) continue;
    for (let c = 0; c < source.length; c++) {
      target[c] = (target[c] ?? 0) + (source[c] ?? 0);
    }
  }
}
export interface TabulationAccumulator {
  /** Feeds one bounded batch. Call as many times as needed. */
  push(records: Iterable<DataRecord>): void;
  /** Materializes the current result; the accumulator remains usable. */
  finish(): TabulationResult;
}

/**
 * Incremental form of {@link executeInMemory}.
 *
 * Peak memory is bounded by the number of distinct row x column combinations,
 * never by the number of records, so a national DBC can be tabulated from
 * bounded batches without the dataset ever being resident.
 *
 * Semantics are not a variant: {@link executeInMemory} is a thin wrapper over
 * this accumulator, so both paths are the same code. Per-cell additions still
 * happen in record order, which keeps floating-point results identical to the
 * previous implementation.
 */
export function createTabulationAccumulator(
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): TabulationAccumulator {
  const warnings = new Set(plan.warnings);
  const observedRows = new Map<string, string>();
  const observedColumns = new Map<string, string>();
  const totals = new Map<string, Map<string, number>>();
  let recordsSeen = 0;
  let recordsAccepted = 0;

  // Counted over every record seen, so the diagnostic describes the source and
  // not the subset that survived the ordinary filters.
  const rules = plan.spec.crossFieldRules ?? [];
  const ruleMatches = rules.map(() => 0);

  function push(records: Iterable<DataRecord>): void {
    for (const record of records) {
      recordsSeen++;
      rules.forEach((rule, index) => {
        if (crossFieldRuleMatches(record, rule, conversions)) ruleMatches[index]! += 1;
      });
      const resolved = resolvePlanRecord(record, plan, conversions);
      if (!resolved) continue;

      observedRows.set(resolved.rowKey, resolved.rowLabel);
      observedColumns.set(resolved.columnKey, resolved.columnLabel);
      let row = totals.get(resolved.rowKey);
      if (!row) totals.set(resolved.rowKey, row = new Map<string, number>());
      row.set(resolved.columnKey, (row.get(resolved.columnKey) ?? 0) + measureValue(record, plan, warnings));
      recordsAccepted++;
    }
  }

  function finish(): TabulationResult {
    return materializeTabulation({
      plan, conversions, warnings, observedRows, observedColumns, totals,
      recordsSeen, recordsAccepted, rules, ruleMatches,
    });
  }

  return { push, finish };
}

interface TabulationState {
  plan: QueryPlan;
  conversions: ConversionRegistry;
  warnings: Set<string>;
  observedRows: Map<string, string>;
  observedColumns: Map<string, string>;
  totals: Map<string, Map<string, number>>;
  recordsSeen: number;
  recordsAccepted: number;
  rules: readonly CrossFieldRuleSpec[];
  ruleMatches: readonly number[];
}

function materializeTabulation(state: TabulationState): TabulationResult {
  const {
    plan, conversions, warnings, observedRows, observedColumns, totals,
    recordsSeen, recordsAccepted, rules, ruleMatches,
  } = state;

  let rows = axisFromDimension(plan.spec.rows, conversions, observedRows);
  let columns = plan.spec.columns
    ? axisFromDimension(plan.spec.columns, conversions, observedColumns)
    : [{ key: '__single__', label: singleColumnLabel(plan), source: 'raw' as const }];

  let cells = rows.map((row) => {
    const accumulated = totals.get(row.key);
    return columns.map((column) => accumulated?.get(column.key) ?? 0);
  });

  if (plan.spec.rows.conversionId) propagateRowSubtotals(rows, cells);

  if (plan.spec.suppressZeroRows) {
    const keep = cells.map((row) => row.some((value) => value !== 0));
    rows = rows.filter((_, index) => keep[index]);
    cells = cells.filter((_, index) => keep[index]);
  }

  // The legacy panel exposes row and column zero suppression independently.
  // Preserve the synthetic single measure column when no column dimension was
  // requested; column suppression applies only to a materialized column axis.
  if (plan.spec.suppressZeroColumns && plan.spec.columns) {
    const keep = columns.map((_, columnIndex) =>
      cells.some((row) => (row[columnIndex] ?? 0) !== 0));
    columns = columns.filter((_, index) => keep[index]);
    cells = cells.map((row) => row.filter((_, index) => keep[index]));
  }

  return {
    rows,
    columns,
    cells,
    warnings: [...warnings],
    recordsSeen,
    recordsAccepted,
    ...(rules.length ? {
      dataQuality: rules.map((rule, index) => ({
        id: rule.id,
        label: rule.label,
        action: rule.action,
        matchedRecords: ruleMatches[index] ?? 0,
      })),
    } : {}),
  };
}

export function executeInMemory(
  records: Iterable<DataRecord>,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): TabulationResult {
  const accumulator = createTabulationAccumulator(plan, conversions);
  accumulator.push(records);
  return accumulator.finish();
}
