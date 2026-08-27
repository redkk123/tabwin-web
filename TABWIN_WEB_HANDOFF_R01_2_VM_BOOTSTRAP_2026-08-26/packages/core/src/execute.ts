import type { CnvDefinition } from '../../formats/src/cnv-model.js';
import { classifyCnv } from '../../formats/src/cnv-match.js';
import type {
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

const UNCLASSIFIED_KEY = '__tabwin_web_unclassified__';
const UNCLASSIFIED_LABEL = 'Não classificados';

function singleColumnLabel(plan: QueryPlan): string {
  // G001's lossless TabWin 4.15 export establishes the count header exactly.
  // Sum headers remain "Valor" until a focused increment golden captures them.
  if (plan.spec.measure.kind !== 'count') return 'Valor';
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
export function executeInMemory(
  records: Iterable<DataRecord>,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): TabulationResult {
  const warnings = new Set(plan.warnings);
  const observedRows = new Map<string, string>();
  const observedColumns = new Map<string, string>();
  const accepted: Array<{ rowKey: string; columnKey: string; value: number }> = [];
  let recordsSeen = 0;
  let recordsAccepted = 0;

  for (const record of records) {
    recordsSeen++;
    if (!plan.spec.filters.every((filter) => acceptsFilter(record, filter, conversions))) continue;

    const row = resolveDimension(record, plan.spec.rows, conversions);
    if (!row.key || row.label === undefined) continue;
    const column = plan.spec.columns
      ? resolveDimension(record, plan.spec.columns, conversions)
      : { key: '__single__', label: singleColumnLabel(plan) };
    if (!column.key || column.label === undefined) continue;

    observedRows.set(row.key, row.label);
    observedColumns.set(column.key, column.label);
    accepted.push({ rowKey: row.key, columnKey: column.key, value: measureValue(record, plan, warnings) });
    recordsAccepted++;
  }

  let rows = axisFromDimension(plan.spec.rows, conversions, observedRows);
  let columns = plan.spec.columns
    ? axisFromDimension(plan.spec.columns, conversions, observedColumns)
    : [{ key: '__single__', label: singleColumnLabel(plan), source: 'raw' as const }];

  const rowIndex = new Map(rows.map((row, index) => [row.key, index]));
  const columnIndex = new Map(columns.map((column, index) => [column.key, index]));
  let cells = rows.map(() => columns.map(() => 0));

  for (const item of accepted) {
    const r = rowIndex.get(item.rowKey);
    const c = columnIndex.get(item.columnKey);
    if (r !== undefined && c !== undefined) cells[r]![c] = (cells[r]![c] ?? 0) + item.value;
  }

  if (plan.spec.rows.conversionId) propagateRowSubtotals(rows, cells);

  if (plan.spec.suppressZeroRows) {
    const keep = cells.map((row) => row.some((value) => value !== 0));
    rows = rows.filter((_, index) => keep[index]);
    cells = cells.filter((_, index) => keep[index]);
  }

  return {
    rows,
    columns,
    cells,
    warnings: [...warnings],
    recordsSeen,
    recordsAccepted,
  };
}
