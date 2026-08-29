import type { FilterSpec, MeasureSpec, QueryPlan, TabulationSpec, TotalPolicy } from './model.js';

export class QueryPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryPlanError';
  }
}

/**
 * Shared by ordinary filters and by cross-field rule conditions, so a rule can
 * never accept a predicate that a filter would reject.
 */
function validateFilter(filter: FilterSpec, label: string): void {
  if (typeof filter?.field !== 'string' || !filter.field.trim()) throw new QueryPlanError(`${label} has no field`);
  if (filter.origin !== undefined && filter.origin !== 'data-quality') {
    throw new QueryPlanError(`${label} origin is invalid`);
  }
  if (filter.startPosition !== undefined && (!Number.isInteger(filter.startPosition) || filter.startPosition <= 0)) {
    throw new QueryPlanError(`${label} startPosition must be a positive integer`);
  }
  if (filter.mode !== undefined && filter.mode !== 'include' && filter.mode !== 'exclude') {
    throw new QueryPlanError(`${label} mode is invalid`);
  }
  if (filter.kind === 'numeric-range') {
    if (filter.conversionId) throw new QueryPlanError(`${label} numeric range cannot use a conversion`);
    if (filter.minimum === undefined && filter.maximum === undefined) {
      throw new QueryPlanError(`${label} numeric range has no bounds`);
    }
    for (const [bound, value] of [['minimum', filter.minimum], ['maximum', filter.maximum]] as const) {
      if (value !== undefined && !Number.isFinite(value)) throw new QueryPlanError(`${label} ${bound} is invalid`);
    }
    if (filter.minimum !== undefined && filter.maximum !== undefined && filter.minimum > filter.maximum) {
      throw new QueryPlanError(`${label} minimum exceeds maximum`);
    }
  } else if (!Array.isArray(filter.acceptedCategories)) {
    throw new QueryPlanError(`${label} has no selected categories`);
  } else if (filter.acceptedCategories.length === 0 && !filter.includeUnclassified) {
    throw new QueryPlanError(`${label} has no selected categories`);
  }
}

const TOTAL_POLICIES = new Set<TotalPolicy>([
  'none', 'sum', 'product', 'mean', 'initial', 'final', 'min', 'max', 'precalculated',
]);

/**
 * Recipes are JSON input, so the runtime boundary must not rely only on the
 * TypeScript shape. Keep the single- and multi-measure paths on one validator
 * so G017 cannot silently accept a malformed entry that the legacy path would
 * reject (or vice versa).
 */
function validateMeasure(measure: MeasureSpec, label: string): void {
  if (!measure || typeof measure !== 'object') throw new QueryPlanError(`${label} is invalid`);
  if (measure.kind !== 'count' && measure.kind !== 'sum') {
    throw new QueryPlanError(`${label} kind is invalid`);
  }
  if (measure.kind === 'sum' && (typeof measure.field !== 'string' || !measure.field.trim())) {
    throw new QueryPlanError(`${label} sum requires a field`);
  }
  if (measure.weightField !== undefined) {
    if (typeof measure.weightField !== 'string' || !measure.weightField.trim()) {
      throw new QueryPlanError(`${label} weightField cannot be empty`);
    }
    if (measure.kind === 'sum') {
      throw new QueryPlanError(`${label} weightField is only valid for count/frequency measures`);
    }
  }
  if (measure.totalPolicy !== undefined && !TOTAL_POLICIES.has(measure.totalPolicy)) {
    throw new QueryPlanError(`${label} totalPolicy is invalid`);
  }
}

function measuresEqual(left: MeasureSpec, right: MeasureSpec): boolean {
  return left.kind === right.kind
    && left.field === right.field
    && left.label === right.label
    && left.weightField === right.weightField
    && left.totalPolicy === right.totalPolicy;
}

export function compileQueryPlan(spec: TabulationSpec): QueryPlan {
  const warnings: string[] = [];

  if (!spec.rows.field.trim()) throw new QueryPlanError('row field is required');
  for (const [label, value] of [
    ['suppressZeroRows', spec.suppressZeroRows],
    ['suppressZeroColumns', spec.suppressZeroColumns],
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new QueryPlanError(`${label} must be boolean`);
    }
  }
  if (spec.columns && !spec.columns.field.trim()) {
    throw new QueryPlanError('column field cannot be empty');
  }
  for (const [label, dimension] of [['row', spec.rows], ['column', spec.columns]] as const) {
    if (dimension?.conversionId && dimension.lookupId) {
      throw new QueryPlanError(`${label} dimension cannot use a CNV conversion and a DBF lookup together`);
    }
    if (dimension?.startPosition !== undefined && (!Number.isInteger(dimension.startPosition) || dimension.startPosition <= 0)) {
      throw new QueryPlanError(`${label} startPosition must be a positive integer`);
    }
    if (dimension?.unclassifiedPolicy !== undefined
      && dimension.unclassifiedPolicy !== 'omit' && dimension.unclassifiedPolicy !== 'discriminate') {
      throw new QueryPlanError(`${label} unclassifiedPolicy is invalid`);
    }
  }
  validateMeasure(spec.measure, 'measure');
  if (spec.measures !== undefined && !Array.isArray(spec.measures)) {
    throw new QueryPlanError('measures must be an array');
  }
  if (spec.measures) {
    if (spec.measures.length < 2) {
      throw new QueryPlanError('measures must have at least two entries; a single measure belongs in `measure`');
    }
    if (spec.columns) {
      throw new QueryPlanError('multiple measures cannot combine with a column dimension yet — no TabWin oracle covers that pairing');
    }
    for (const [index, measure] of spec.measures.entries()) {
      const label = `measures[${index}]`;
      validateMeasure(measure, label);
    }
    if (!measuresEqual(spec.measure, spec.measures[0]!)) {
      throw new QueryPlanError('measure must equal measures[0] when multiple measures are present');
    }
  }
  for (const [index, filter] of spec.filters.entries()) {
    validateFilter(filter, `filter ${index + 1}`);
    if (filter.mode === 'exclude') warnings.push(`filter ${index + 1} uses explicit exclusion policy; TabWin default equivalence is pending`);
    if (filter.kind === 'numeric-range') warnings.push(`filter ${index + 1} uses an explicit numeric range policy`);
    if (filter.origin === 'data-quality') warnings.push(`filter ${index + 1} is an explicit, non-destructive data-quality rule`);
  }

  const ruleIds = new Set<string>();
  for (const [index, rule] of (spec.crossFieldRules ?? []).entries()) {
    const label = `cross-field rule ${index + 1}`;
    if (typeof rule.id !== 'string' || !rule.id.trim()) throw new QueryPlanError(`${label} has no id`);
    if (ruleIds.has(rule.id)) throw new QueryPlanError(`${label} repeats id ${rule.id}`);
    ruleIds.add(rule.id);
    if (typeof rule.label !== 'string' || !rule.label.trim()) throw new QueryPlanError(`${label} has no label`);
    if (rule.action !== 'flag' && rule.action !== 'exclude') throw new QueryPlanError(`${label} action is invalid`);
    if (!Array.isArray(rule.conditions) || rule.conditions.length < 2) {
      // One condition is an ordinary filter; the point of this rule is the
      // combination that no single-field filter can express.
      throw new QueryPlanError(`${label} requires at least two conditions`);
    }
    const fields = new Set<string>();
    for (const [position, condition] of rule.conditions.entries()) {
      validateFilter(condition, `${label} condition ${position + 1}`);
      fields.add(condition.field.trim());
    }
    if (fields.size < 2) throw new QueryPlanError(`${label} must span at least two distinct fields`);
    warnings.push(`cross-field rule ${rule.id} is a modern user-authored implausibility policy with no TabWin 4.15 oracle`);
    if (rule.action === 'exclude') {
      warnings.push(`cross-field rule ${rule.id} removes matching records from the tabulation`);
    }
  }

  if (spec.measure.kind === 'count' && spec.measure.totalPolicy) {
    warnings.push('totalPolicy is ignored for count measure during R01 execution');
  }
  if (spec.compatibilityProfile === 'modern') {
    warnings.push('modern profile exists as an architectural boundary; R01 executor uses compatibility-safe ordering');
  }

  return { version: 1, spec, warnings };
}
