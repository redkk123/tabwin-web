/**
 * A user-authored, ordered sequence of record-level cleaning/reshaping steps
 * over the raw dataset - the interface's answer to "I'd need dplyr/pandas
 * for this" (spec section 5, "Módulo A - Transformação e limpeza manual").
 *
 * Deliberately scoped to five step kinds for this first cut: `select-columns`,
 * `filter-rows`, `recode`, `missing-value-policy`, `dedupe`. Formula-backed
 * derived columns (`mutate()` with an expression), joins, bind-rows and
 * group/summarize are not here - see the R11.4 handoff for why each is cut
 * and where it is expected to land.
 *
 * Every step is validated and executed against the field list *as of that
 * point in the pipeline* - a `select-columns` step earlier can drop or rename
 * a field a later step depends on, and that later step must fail clearly
 * rather than silently operate on `undefined`. Application is all-or-nothing:
 * the first invalid or failing step throws, and the caller gets no partial
 * result, matching how the rest of this project treats a dataset swap as
 * transactional.
 */

import { validateCrossFieldRuleShape, validateFilter } from './plan.js';
import { matchesFilters, type ConversionRegistry } from './execute.js';
import type { CrossFieldRuleSpec, DataRecord, FilterSpec } from './model.js';

export class TransformPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransformPipelineError';
  }
}

interface TransformStepBase {
  /** Stable, unique-within-pipeline id - how the UI/history/recipe refer back to a step. */
  id: string;
  label?: string;
  /** Defaults to true. A disabled step is validated but has no effect on records or fields. */
  enabled?: boolean;
}

export interface SelectColumnsStep extends TransformStepBase {
  kind: 'select-columns';
  /** Field names to keep, in this exact order; every other field is dropped. */
  keepFields: string[];
  /** Optional rename applied to a kept field: original name -> new name. */
  renameFields?: Record<string, string>;
}

export interface FilterRowsStep extends TransformStepBase {
  kind: 'filter-rows';
  filters: FilterSpec[];
  crossFieldRules?: CrossFieldRuleSpec[];
}

export type RecodeOtherwise =
  | { policy: 'keep' }
  | { policy: 'missing' }
  | { policy: 'category'; label: string };

export interface RecodeStep extends TransformStepBase {
  kind: 'recode';
  field: string;
  /** Ordered value(s)->value mapping; the first entry whose `from` contains the record's raw (stringified) value wins. */
  mapping: Array<{ from: string[]; to: string }>;
  otherwise: RecodeOtherwise;
}

export interface MissingValuePolicyStep extends TransformStepBase {
  kind: 'missing-value-policy';
  field: string;
  /** Raw values (compared as trimmed strings) rewritten to `null` - the sentinel is never assumed, only applied on request. */
  sentinelValues: string[];
}

export interface DedupeStep extends TransformStepBase {
  kind: 'dedupe';
  /** Composite key; a record's key is these fields' values, in order. Keeps the first occurrence, never the last - see the module doc. */
  keyFields: string[];
}

export type TransformStep =
  | SelectColumnsStep
  | FilterRowsStep
  | RecodeStep
  | MissingValuePolicyStep
  | DedupeStep;

export interface TransformStepResult {
  id: string;
  kind: TransformStep['kind'];
  label: string;
  enabled: boolean;
  recordsBefore: number;
  recordsAfter: number;
  warnings: string[];
  /** Step-specific counters (records changed, groups removed, etc.) - always present, even when zero. */
  detail: Record<string, number>;
}

export interface TransformedField {
  /** The field's name after the pipeline - what a consumer should display and index records by. */
  name: string;
  /** The name this field had in the pipeline's original input, traced through every rename. Never invented: a caller needing the field's original type/length/decimals looks it up by this. */
  originalName: string;
}

export interface TransformPipelineResult {
  records: DataRecord[];
  /** Field order after the pipeline - only `select-columns` steps change this. */
  fields: TransformedField[];
  steps: TransformStepResult[];
}

function defaultLabel(step: TransformStep): string {
  switch (step.kind) {
    case 'select-columns': return `Selecionar colunas (${step.keepFields.length})`;
    case 'filter-rows': return `Filtrar linhas (${step.filters.length} filtro(s))`;
    case 'recode': return `Recodificar ${step.field}`;
    case 'missing-value-policy': return `Ausentes em ${step.field}`;
    case 'dedupe': return `Deduplicar por ${step.keyFields.join(', ')}`;
  }
}

function stringify(raw: unknown): string {
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

function requireKnownField(field: string, currentFields: readonly TransformedField[], label: string): void {
  if (!currentFields.some((candidate) => candidate.name === field)) {
    throw new TransformPipelineError(`${label}: field ${field} does not exist at this point in the pipeline`);
  }
}

function validateStepShape(step: TransformStep, label: string, currentFields: readonly TransformedField[]): void {
  if (typeof step.id !== 'string' || !step.id.trim()) throw new TransformPipelineError(`${label} has no id`);
  if (step.enabled !== undefined && typeof step.enabled !== 'boolean') {
    throw new TransformPipelineError(`${label} enabled must be a boolean`);
  }

  if (step.kind === 'select-columns') {
    if (!Array.isArray(step.keepFields) || step.keepFields.length === 0) {
      throw new TransformPipelineError(`${label} has no fields to keep`);
    }
    if (new Set(step.keepFields).size !== step.keepFields.length) {
      throw new TransformPipelineError(`${label} repeats a field in keepFields`);
    }
    for (const field of step.keepFields) requireKnownField(field, currentFields, label);
    const finalNames = step.keepFields.map((field) => step.renameFields?.[field] ?? field);
    if (new Set(finalNames).size !== finalNames.length) {
      throw new TransformPipelineError(`${label} rename produces duplicate field names`);
    }
    for (const original of Object.keys(step.renameFields ?? {})) {
      if (!step.keepFields.includes(original)) {
        throw new TransformPipelineError(`${label} renames ${original}, which is not in keepFields`);
      }
    }
  } else if (step.kind === 'filter-rows') {
    if (!step.filters.length && !(step.crossFieldRules ?? []).length) {
      throw new TransformPipelineError(`${label} has no filters or cross-field rules`);
    }
    step.filters.forEach((filter, index) => {
      validateFilter(filter, `${label} filter ${index + 1}`);
      requireKnownField(filter.field, currentFields, label);
    });
    const ruleIds = new Set<string>();
    (step.crossFieldRules ?? []).forEach((rule, index) => {
      const ruleLabel = `${label} cross-field rule ${index + 1}`;
      validateCrossFieldRuleShape(rule, ruleLabel);
      if (ruleIds.has(rule.id)) throw new TransformPipelineError(`${ruleLabel} repeats id ${rule.id}`);
      ruleIds.add(rule.id);
      for (const condition of rule.conditions) requireKnownField(condition.field, currentFields, ruleLabel);
    });
  } else if (step.kind === 'recode') {
    if (typeof step.field !== 'string' || !step.field.trim()) throw new TransformPipelineError(`${label} has no field`);
    requireKnownField(step.field, currentFields, label);
    if (!Array.isArray(step.mapping) || step.mapping.length === 0) {
      throw new TransformPipelineError(`${label} has no mapping rules`);
    }
    const seenFrom = new Set<string>();
    for (const [index, entry] of step.mapping.entries()) {
      if (!Array.isArray(entry.from) || entry.from.length === 0) {
        throw new TransformPipelineError(`${label} rule ${index + 1} has no source value`);
      }
      if (typeof entry.to !== 'string') throw new TransformPipelineError(`${label} rule ${index + 1} has no target value`);
      for (const raw of entry.from) {
        const key = raw.trim();
        if (!key) throw new TransformPipelineError(`${label} rule ${index + 1} has an empty source value`);
        if (seenFrom.has(key)) throw new TransformPipelineError(`${label} maps ${key} more than once`);
        seenFrom.add(key);
      }
    }
    if (!step.otherwise || !['keep', 'missing', 'category'].includes(step.otherwise.policy)) {
      throw new TransformPipelineError(`${label} otherwise policy is invalid`);
    }
    if (step.otherwise.policy === 'category' && !step.otherwise.label.trim()) {
      throw new TransformPipelineError(`${label} otherwise category has no label`);
    }
  } else if (step.kind === 'missing-value-policy') {
    if (typeof step.field !== 'string' || !step.field.trim()) throw new TransformPipelineError(`${label} has no field`);
    requireKnownField(step.field, currentFields, label);
    if (!Array.isArray(step.sentinelValues) || step.sentinelValues.length === 0) {
      throw new TransformPipelineError(`${label} has no sentinel values`);
    }
  } else if (step.kind === 'dedupe') {
    if (!Array.isArray(step.keyFields) || step.keyFields.length === 0) {
      throw new TransformPipelineError(`${label} has no key fields`);
    }
    for (const field of step.keyFields) requireKnownField(field, currentFields, label);
  } else {
    throw new TransformPipelineError(`${label} has an unknown kind`);
  }
}

function runSelectColumns(
  records: readonly DataRecord[],
  step: SelectColumnsStep,
  currentFields: readonly TransformedField[],
): { records: DataRecord[]; fields: TransformedField[]; detail: Record<string, number> } {
  const originalByCurrentName = new Map(currentFields.map((field) => [field.name, field.originalName]));
  const finalNames = step.keepFields.map((field) => step.renameFields?.[field] ?? field);
  const transformed = records.map((record) => {
    const next: DataRecord = {};
    step.keepFields.forEach((field, index) => { next[finalNames[index]!] = record[field]; });
    return next;
  });
  const fields = step.keepFields.map((field, index) => ({
    name: finalNames[index]!,
    // Guaranteed present: keepFields was already validated against currentFields.
    originalName: originalByCurrentName.get(field)!,
  }));
  return {
    records: transformed,
    fields,
    detail: { camposMantidos: step.keepFields.length },
  };
}

function runFilterRows(
  records: readonly DataRecord[],
  step: FilterRowsStep,
  conversions: ConversionRegistry,
): { records: DataRecord[]; detail: Record<string, number> } {
  const kept = records.filter((record) => matchesFilters(record, step.filters, step.crossFieldRules, conversions));
  return { records: kept, detail: { registrosRemovidos: records.length - kept.length } };
}

function runRecode(
  records: readonly DataRecord[],
  step: RecodeStep,
): { records: DataRecord[]; detail: Record<string, number> } {
  const lookup = new Map<string, string>();
  for (const entry of step.mapping) for (const raw of entry.from) lookup.set(raw.trim(), entry.to);

  let changed = 0;
  let unmapped = 0;
  const transformed = records.map((record) => {
    const raw = stringify(record[step.field]);
    const mapped = lookup.get(raw);
    let next: unknown;
    if (mapped !== undefined) {
      next = mapped;
    } else {
      unmapped++;
      next = step.otherwise.policy === 'keep' ? record[step.field]
        : step.otherwise.policy === 'missing' ? null
        : step.otherwise.label;
    }
    if (next !== record[step.field]) changed++;
    return { ...record, [step.field]: next };
  });
  return { records: transformed, detail: { registrosAlterados: changed, semCorrespondencia: unmapped } };
}

function runMissingValuePolicy(
  records: readonly DataRecord[],
  step: MissingValuePolicyStep,
): { records: DataRecord[]; detail: Record<string, number> } {
  const sentinels = new Set(step.sentinelValues.map((value) => value.trim()));
  let marked = 0;
  const transformed = records.map((record) => {
    if (record[step.field] === null || !sentinels.has(stringify(record[step.field]))) return record;
    marked++;
    return { ...record, [step.field]: null };
  });
  return { records: transformed, detail: { marcadosComoAusentes: marked } };
}

function runDedupe(
  records: readonly DataRecord[],
  step: DedupeStep,
): { records: DataRecord[]; detail: Record<string, number> } {
  const seen = new Set<string>();
  const kept: DataRecord[] = [];
  for (const record of records) {
    const key = JSON.stringify(step.keyFields.map((field) => record[field] ?? null));
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(record);
  }
  return { records: kept, detail: { registrosRemovidos: records.length - kept.length, chavesDistintas: seen.size } };
}

export function applyTransformPipeline(
  records: readonly DataRecord[],
  fields: readonly string[],
  steps: readonly TransformStep[],
  conversions: ConversionRegistry = {},
): TransformPipelineResult {
  const stepIds = new Set<string>();
  let currentRecords: DataRecord[] = [...records];
  let currentFields: TransformedField[] = fields.map((name) => ({ name, originalName: name }));
  const stepResults: TransformStepResult[] = [];

  steps.forEach((step, index) => {
    const label = `step ${index + 1} (${step.kind})`;
    validateStepShape(step, label, currentFields);
    if (stepIds.has(step.id)) throw new TransformPipelineError(`${label} repeats id ${step.id}`);
    stepIds.add(step.id);

    const enabled = step.enabled ?? true;
    const recordsBefore = currentRecords.length;
    let detail: Record<string, number> = {};

    if (enabled) {
      if (step.kind === 'select-columns') {
        const outcome = runSelectColumns(currentRecords, step, currentFields);
        currentRecords = outcome.records;
        currentFields = outcome.fields;
        detail = outcome.detail;
      } else if (step.kind === 'filter-rows') {
        const outcome = runFilterRows(currentRecords, step, conversions);
        currentRecords = outcome.records;
        detail = outcome.detail;
      } else if (step.kind === 'recode') {
        const outcome = runRecode(currentRecords, step);
        currentRecords = outcome.records;
        detail = outcome.detail;
      } else if (step.kind === 'missing-value-policy') {
        const outcome = runMissingValuePolicy(currentRecords, step);
        currentRecords = outcome.records;
        detail = outcome.detail;
      } else if (step.kind === 'dedupe') {
        const outcome = runDedupe(currentRecords, step);
        currentRecords = outcome.records;
        detail = outcome.detail;
      }
    }

    stepResults.push({
      id: step.id,
      kind: step.kind,
      label: step.label?.trim() || defaultLabel(step),
      enabled,
      recordsBefore,
      recordsAfter: currentRecords.length,
      warnings: enabled ? [] : ['etapa desativada; nenhum efeito aplicado'],
      detail,
    });
  });

  return { records: currentRecords, fields: currentFields, steps: stepResults };
}
