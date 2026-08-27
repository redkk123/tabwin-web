import type { QueryPlan, TabulationSpec } from './model.js';

export class QueryPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryPlanError';
  }
}

export function compileQueryPlan(spec: TabulationSpec): QueryPlan {
  const warnings: string[] = [];

  if (!spec.rows.field.trim()) throw new QueryPlanError('row field is required');
  if (spec.columns && !spec.columns.field.trim()) {
    throw new QueryPlanError('column field cannot be empty');
  }
  for (const [label, dimension] of [['row', spec.rows], ['column', spec.columns]] as const) {
    if (dimension?.startPosition !== undefined && (!Number.isInteger(dimension.startPosition) || dimension.startPosition <= 0)) {
      throw new QueryPlanError(`${label} startPosition must be a positive integer`);
    }
    if (dimension?.unclassifiedPolicy !== undefined
      && dimension.unclassifiedPolicy !== 'omit' && dimension.unclassifiedPolicy !== 'discriminate') {
      throw new QueryPlanError(`${label} unclassifiedPolicy is invalid`);
    }
  }
  if (spec.measure.kind === 'sum' && !spec.measure.field?.trim()) {
    throw new QueryPlanError('sum measure requires a field');
  }
  if (spec.measure.weightField !== undefined && !spec.measure.weightField.trim()) {
    throw new QueryPlanError('weightField cannot be empty');
  }
  if (spec.measure.kind === 'sum' && spec.measure.weightField) {
    throw new QueryPlanError('weightField is only valid for count/frequency measures');
  }
  for (const [index, filter] of spec.filters.entries()) {
    if (!filter.field.trim()) throw new QueryPlanError(`filter ${index + 1} has no field`);
    if (filter.startPosition !== undefined && (!Number.isInteger(filter.startPosition) || filter.startPosition <= 0)) {
      throw new QueryPlanError(`filter ${index + 1} startPosition must be a positive integer`);
    }
    if (filter.mode !== undefined && filter.mode !== 'include' && filter.mode !== 'exclude') {
      throw new QueryPlanError(`filter ${index + 1} mode is invalid`);
    }
    if (filter.kind === 'numeric-range') {
      if (filter.conversionId) throw new QueryPlanError(`filter ${index + 1} numeric range cannot use a conversion`);
      if (filter.minimum === undefined && filter.maximum === undefined) {
        throw new QueryPlanError(`filter ${index + 1} numeric range has no bounds`);
      }
      for (const [bound, value] of [['minimum', filter.minimum], ['maximum', filter.maximum]] as const) {
        if (value !== undefined && !Number.isFinite(value)) throw new QueryPlanError(`filter ${index + 1} ${bound} is invalid`);
      }
      if (filter.minimum !== undefined && filter.maximum !== undefined && filter.minimum > filter.maximum) {
        throw new QueryPlanError(`filter ${index + 1} minimum exceeds maximum`);
      }
    } else if (filter.acceptedCategories.length === 0 && !filter.includeUnclassified) {
      throw new QueryPlanError(`filter ${index + 1} has no selected categories`);
    }
    if (filter.mode === 'exclude') warnings.push(`filter ${index + 1} uses explicit exclusion policy; TabWin default equivalence is pending`);
    if (filter.kind === 'numeric-range') warnings.push(`filter ${index + 1} uses an explicit numeric range policy`);
  }

  if (spec.measure.kind === 'count' && spec.measure.totalPolicy) {
    warnings.push('totalPolicy is ignored for count measure during R01 execution');
  }
  if (spec.compatibilityProfile === 'modern') {
    warnings.push('modern profile exists as an architectural boundary; R01 executor uses compatibility-safe ordering');
  }

  return { version: 1, spec, warnings };
}
