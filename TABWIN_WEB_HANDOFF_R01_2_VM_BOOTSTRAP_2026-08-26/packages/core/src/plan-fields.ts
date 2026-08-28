import type { QueryPlan } from './model.js';

/**
 * Every source field a plan can read while resolving a record.
 *
 * This exists so an execution layer can hand the executor records projected to
 * just these fields instead of decoding all of them. It is deliberately
 * structural: it enumerates the fields the spec names, and never decides what
 * they mean.
 *
 * Keeping it beside the model matters — if a future spec option reads another
 * field, it must be added here in the same change, or projection would starve
 * the executor of a value it needs. `tests/plan-fields.test.mjs` guards that by
 * comparing projected execution against unprojected execution.
 */
export function fieldsUsedByPlan(plan: QueryPlan): string[] {
  const fields = new Set<string>();
  const add = (field: string | undefined): void => {
    if (typeof field === 'string' && field.trim()) fields.add(field);
  };

  add(plan.spec.rows.field);
  add(plan.spec.columns?.field);
  add(plan.spec.measure.field);
  add(plan.spec.measure.weightField);
  for (const filter of plan.spec.filters) add(filter.field);
  for (const rule of plan.spec.crossFieldRules ?? []) {
    for (const condition of rule.conditions) add(condition.field);
  }
  return [...fields];
}
