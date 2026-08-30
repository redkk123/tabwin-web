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

import { validateCrossFieldRuleShape, validateFilter } from '../../core/src/plan.js';
import {
  evaluateTableExpression,
  expressionReadsEveryRow,
  parseExpression,
} from './table-expression.js';
import { matchesFilters, type ConversionRegistry } from '../../core/src/execute.js';
import type { CrossFieldRuleSpec, DataRecord, FilterSpec } from '../../core/src/model.js';

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

/**
 * `mutate()`: a new numeric field computed per record by the same
 * Excel-familiar formula language the derived-column operation uses, over
 * the dataset's own fields instead of a tabulation's columns.
 */
export interface DeriveColumnStep extends TransformStepBase {
  kind: 'derive-column';
  /** Name of the field being created; must not collide with one already present. */
  field: string;
  formula: string;
  /** Same explicit choice the derived-column operation offers; there is no invisible default. */
  divisionByZero: 'error' | 'zero';
}

export interface CastTypeStep extends TransformStepBase {
  kind: 'cast-type';
  field: string;
  to: 'number' | 'text' | 'date';
  /** What a value that will not convert becomes. There is no silent option. */
  onFailure: 'missing' | 'keep';
}

export type DatePart =
  | 'year' | 'month' | 'day' | 'quarter'
  | 'epidemiological-week' | 'epidemiological-year';

export interface DatePartStep extends TransformStepBase {
  kind: 'date-part';
  /** Source field, read as a date; see {@link parseDateValue} for what counts as one. */
  field: string;
  /** Name of the numeric field being created. */
  target: string;
  part: DatePart;
}

export type TextOperation =
  | { kind: 'trim' }
  | { kind: 'upper' }
  | { kind: 'lower' }
  | { kind: 'pad-start'; length: number; fill: string }
  | { kind: 'substring'; start: number; length?: number }
  /** Standardizes a Brazilian municipality code to 6 digits without destroying a leading zero. */
  | { kind: 'ibge-municipality' };

export interface TextNormalizeStep extends TransformStepBase {
  kind: 'text-normalize';
  field: string;
  operations: TextOperation[];
}

/**
 * One summary column produced by a {@link GroupSummarizeStep}. Every kind but
 * `count` reads a source field; `count` is the group's size. `as` names the
 * resulting column.
 */
export type SummaryAggregation =
  | { kind: 'count'; as: string }
  | { kind: 'sum'; field: string; as: string }
  | { kind: 'mean'; field: string; as: string }
  | { kind: 'median'; field: string; as: string }
  | { kind: 'min'; field: string; as: string }
  | { kind: 'max'; field: string; as: string }
  | { kind: 'distinct'; field: string; as: string };

/**
 * `group_by() + summarise()`: collapses the records into one row per distinct
 * combination of `groupFields`, each carrying the requested aggregations. The
 * shape changes completely - after this step the only fields are the group
 * keys and the summary columns, so anything a later step needs must be one of
 * those.
 */
export interface GroupSummarizeStep extends TransformStepBase {
  kind: 'group-summarize';
  groupFields: string[];
  aggregations: SummaryAggregation[];
}

/**
 * A second record set embedded in a step, for the verbs that combine two
 * datasets ({@link BindRowsStep} for now). Carried inline rather than
 * referenced, so a pipeline stays self-contained; `label` names its origin in
 * diagnostics and in the optional origin column.
 */
export interface PipelineSource {
  label: string;
  fields: string[];
  records: DataRecord[];
}

/**
 * `bind_rows()`: appends a second record set below the current one, unioning
 * the columns. A column present on only one side becomes absent (`null`) on
 * the other - never a silent type coercion, and never a fabricated value. An
 * optional origin column marks which set each record came from.
 */
export interface BindRowsStep extends TransformStepBase {
  kind: 'bind-rows';
  source: PipelineSource;
  /** Value written into `originField` for the records already in the pipeline. */
  currentLabel?: string;
  /** When set, adds a field of this name holding each record's origin label. */
  originField?: string;
}

export type JoinType = 'inner' | 'left' | 'right' | 'full';

/**
 * `join()`: brings the second source's columns onto the current records,
 * matched on an explicit key. `keyPairs` maps a current field to a source
 * field (they may be named differently). A many-to-many match is blocked by
 * default - it multiplies rows in a way that is almost always a mistake, so
 * it must be opted into with `allowManyToMany`.
 */
export interface JoinStep extends TransformStepBase {
  kind: 'join';
  source: PipelineSource;
  keyPairs: Array<{ current: string; source: string }>;
  joinType: JoinType;
  /** Source fields to bring in; the key fields are always excluded (they are already on the row). Defaults to every non-key source field. */
  bringFields?: string[];
  /** Prefix applied to brought-in field names, to avoid colliding with current fields. */
  sourcePrefix?: string;
  allowManyToMany?: boolean;
}

export type TransformStep =
  | SelectColumnsStep
  | FilterRowsStep
  | RecodeStep
  | MissingValuePolicyStep
  | DedupeStep
  | DeriveColumnStep
  | CastTypeStep
  | DatePartStep
  | TextNormalizeStep
  | GroupSummarizeStep
  | BindRowsStep
  | JoinStep;

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
  /**
   * The name this field had in the pipeline's original input, traced through
   * every rename. Never invented: a caller needing the field's original
   * type/length/decimals looks it up by this. `undefined` means the pipeline
   * created the field itself (a `derive-column` step), so there is no
   * original to inherit from and the caller must supply a numeric shape.
   */
  originalName?: string;
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
    case 'derive-column': return `Criar ${step.field}`;
    case 'cast-type': return `Converter ${step.field} para ${step.to}`;
    case 'date-part': return `Extrair ${step.part} de ${step.field}`;
    case 'text-normalize': return `Normalizar ${step.field} (${step.operations.length} operação(ões))`;
    case 'group-summarize': return `Agrupar por ${step.groupFields.join(', ')} (${step.aggregations.length} resumo(s))`;
    case 'bind-rows': return `Empilhar ${step.source.label} (${step.source.records.length} registro(s))`;
    case 'join': return `Juntar ${step.source.label} (${step.joinType}) por ${step.keyPairs.map((pair) => pair.current).join(', ')}`;
  }
}

/**
 * Reads a raw field value as a calendar date, accepting the shapes DATASUS
 * actually ships: a real Date (DBF type `D`), the bare `YYYYMMDD` string used
 * by DTOBITO/DT_NOTIFIC and friends, ISO `YYYY-MM-DD`, and `DD/MM/YYYY`.
 * Anything else returns undefined - it is not guessed at.
 *
 * Everything is handled in UTC, so a date never shifts a day because of the
 * reader's time zone.
 */
export function parseDateValue(raw: unknown): Date | undefined {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw;
  if (raw === null || raw === undefined) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;

  let year: number;
  let month: number;
  let day: number;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (compact) [, year, month, day] = compact.map(Number) as [number, number, number, number];
  else if (iso) [, year, month, day] = iso.map(Number) as [number, number, number, number];
  else if (brazilian) {
    const [, d, m, y] = brazilian.map(Number) as [number, number, number, number];
    year = y; month = m; day = d;
  } else return undefined;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2024-02-31 and friends, which Date would roll forward silently.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date;
}

/**
 * Brazilian epidemiological week (semana epidemiológica), which follows the
 * same construction as the CDC's MMWR week:
 *
 * - a week runs Sunday through Saturday;
 * - week 1 of a year is the one ending on the first Saturday of January that
 *   falls on the 4th or later, i.e. the first week with at least four of its
 *   days in the new year.
 *
 * A date in early January can therefore belong to the last week of the
 * previous epidemiological year, and a date in late December to week 1 of
 * the next - which is why the epidemiological *year* is reported separately
 * rather than assumed equal to the calendar year.
 */
function epidemiologicalWeek(date: Date): { week: number; year: number } {
  /** The Saturday that closes the Sunday-Saturday week containing `value`. */
  const weekEnd = (value: Date): Date => {
    const end = new Date(value.getTime());
    end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()));
    return end;
  };
  /** The Saturday that closes week 1 of the given epidemiological year. */
  const firstWeekEnd = (year: number): Date => {
    // Jan 4 is in week 1 by definition: any week containing it necessarily
    // has at least four January days.
    return weekEnd(new Date(Date.UTC(year, 0, 4)));
  };

  const end = weekEnd(date);
  // The epidemiological year is the calendar year the week *ends* in, unless
  // that week is still week 1 of the following year.
  let year = end.getUTCFullYear();
  if (end.getTime() >= firstWeekEnd(year + 1).getTime()) year += 1;
  else if (end.getTime() < firstWeekEnd(year).getTime()) year -= 1;

  const start = firstWeekEnd(year);
  const week = Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return { week, year };
}

/** Same coercion the rest of the project uses for a raw field value: comma decimals included. */
function numericValue(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (raw === null || raw === undefined) return Number.NaN;
  const text = String(raw).trim();
  if (!text) return Number.NaN;
  return Number(text.replace(',', '.'));
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
  } else if (step.kind === 'derive-column') {
    if (typeof step.field !== 'string' || !step.field.trim()) throw new TransformPipelineError(`${label} has no field name`);
    if (currentFields.some((candidate) => candidate.name === step.field)) {
      throw new TransformPipelineError(`${label}: field ${step.field} already exists at this point in the pipeline`);
    }
    if (typeof step.formula !== 'string' || !step.formula.trim()) throw new TransformPipelineError(`${label} has no formula`);
    if (step.divisionByZero !== 'error' && step.divisionByZero !== 'zero') {
      throw new TransformPipelineError(`${label} divisionByZero policy is invalid`);
    }
    // Parsed here so a bad formula or a missing field reference fails while
    // the pipeline is being validated, not partway through the records.
    parseExpression(currentFields.map((field) => ({ key: field.name, label: field.name })), step.formula);
  } else if (step.kind === 'cast-type') {
    requireKnownField(step.field, currentFields, label);
    if (!['number', 'text', 'date'].includes(step.to)) throw new TransformPipelineError(`${label} target type is invalid`);
    if (step.onFailure !== 'missing' && step.onFailure !== 'keep') {
      throw new TransformPipelineError(`${label} onFailure policy is invalid`);
    }
  } else if (step.kind === 'date-part') {
    requireKnownField(step.field, currentFields, label);
    if (typeof step.target !== 'string' || !step.target.trim()) throw new TransformPipelineError(`${label} has no target field name`);
    if (currentFields.some((candidate) => candidate.name === step.target)) {
      throw new TransformPipelineError(`${label}: field ${step.target} already exists at this point in the pipeline`);
    }
    const parts: DatePart[] = ['year', 'month', 'day', 'quarter', 'epidemiological-week', 'epidemiological-year'];
    if (!parts.includes(step.part)) throw new TransformPipelineError(`${label} date part is invalid`);
  } else if (step.kind === 'text-normalize') {
    requireKnownField(step.field, currentFields, label);
    if (!Array.isArray(step.operations) || step.operations.length === 0) {
      throw new TransformPipelineError(`${label} has no operations`);
    }
    for (const [index, operation] of step.operations.entries()) {
      const position = `${label} operation ${index + 1}`;
      if (operation.kind === 'pad-start') {
        if (!Number.isInteger(operation.length) || operation.length < 1) throw new TransformPipelineError(`${position} length must be a positive whole number`);
        if (typeof operation.fill !== 'string' || operation.fill.length !== 1) throw new TransformPipelineError(`${position} fill must be a single character`);
      } else if (operation.kind === 'substring') {
        if (!Number.isInteger(operation.start) || operation.start < 1) throw new TransformPipelineError(`${position} start must be a positive whole number`);
        if (operation.length !== undefined && (!Number.isInteger(operation.length) || operation.length < 1)) {
          throw new TransformPipelineError(`${position} length must be a positive whole number`);
        }
      } else if (!['trim', 'upper', 'lower', 'ibge-municipality'].includes(operation.kind)) {
        throw new TransformPipelineError(`${position} kind is invalid`);
      }
    }
  } else if (step.kind === 'group-summarize') {
    if (!Array.isArray(step.groupFields) || step.groupFields.length === 0) {
      throw new TransformPipelineError(`${label} has no group fields`);
    }
    if (new Set(step.groupFields).size !== step.groupFields.length) {
      throw new TransformPipelineError(`${label} repeats a group field`);
    }
    for (const field of step.groupFields) requireKnownField(field, currentFields, label);
    if (!Array.isArray(step.aggregations) || step.aggregations.length === 0) {
      throw new TransformPipelineError(`${label} has no aggregations`);
    }
    const kinds = new Set(['count', 'sum', 'mean', 'median', 'min', 'max', 'distinct']);
    // The output field names must be unique among themselves and must not
    // collide with a group key, so the resulting rows have no ambiguous field.
    const outputNames = new Set(step.groupFields);
    for (const [index, aggregation] of step.aggregations.entries()) {
      const position = `${label} aggregation ${index + 1}`;
      if (!kinds.has(aggregation.kind)) throw new TransformPipelineError(`${position} kind is invalid`);
      if (typeof aggregation.as !== 'string' || !aggregation.as.trim()) throw new TransformPipelineError(`${position} has no output name`);
      if (outputNames.has(aggregation.as)) throw new TransformPipelineError(`${label} output name ${aggregation.as} is used more than once`);
      outputNames.add(aggregation.as);
      if (aggregation.kind !== 'count') {
        if (typeof aggregation.field !== 'string' || !aggregation.field.trim()) throw new TransformPipelineError(`${position} has no field`);
        requireKnownField(aggregation.field, currentFields, label);
      }
    }
  } else if (step.kind === 'bind-rows') {
    const source = step.source;
    if (!source || typeof source !== 'object') throw new TransformPipelineError(`${label} has no source`);
    if (typeof source.label !== 'string' || !source.label.trim()) throw new TransformPipelineError(`${label} source has no label`);
    if (!Array.isArray(source.fields) || source.fields.length === 0) throw new TransformPipelineError(`${label} source has no fields`);
    if (new Set(source.fields).size !== source.fields.length) throw new TransformPipelineError(`${label} source repeats a field`);
    if (!Array.isArray(source.records)) throw new TransformPipelineError(`${label} source has no records`);
    if (step.originField !== undefined) {
      if (typeof step.originField !== 'string' || !step.originField.trim()) throw new TransformPipelineError(`${label} origin field name is empty`);
      // The origin column is created by this step, so it must not already
      // exist on either side or the union would carry two of it.
      if (currentFields.some((candidate) => candidate.name === step.originField)) {
        throw new TransformPipelineError(`${label}: field ${step.originField} already exists at this point in the pipeline`);
      }
      if (source.fields.includes(step.originField)) throw new TransformPipelineError(`${label}: the source already has a field named ${step.originField}`);
    }
  } else if (step.kind === 'join') {
    const source = step.source;
    if (!source || typeof source !== 'object') throw new TransformPipelineError(`${label} has no source`);
    if (typeof source.label !== 'string' || !source.label.trim()) throw new TransformPipelineError(`${label} source has no label`);
    if (!Array.isArray(source.fields) || source.fields.length === 0) throw new TransformPipelineError(`${label} source has no fields`);
    if (!Array.isArray(source.records)) throw new TransformPipelineError(`${label} source has no records`);
    if (!['inner', 'left', 'right', 'full'].includes(step.joinType)) throw new TransformPipelineError(`${label} join type is invalid`);
    if (!Array.isArray(step.keyPairs) || step.keyPairs.length === 0) throw new TransformPipelineError(`${label} has no key`);
    const sourceFieldSet = new Set(source.fields);
    for (const [index, pair] of step.keyPairs.entries()) {
      const position = `${label} key ${index + 1}`;
      if (!pair || typeof pair.current !== 'string' || typeof pair.source !== 'string') throw new TransformPipelineError(`${position} is malformed`);
      requireKnownField(pair.current, currentFields, label);
      if (!sourceFieldSet.has(pair.source)) throw new TransformPipelineError(`${position}: the source has no field ${pair.source}`);
    }
    const keySourceFields = new Set(step.keyPairs.map((pair) => pair.source));
    const bring = step.bringFields ?? source.fields.filter((name) => !keySourceFields.has(name));
    for (const name of bring) {
      if (!sourceFieldSet.has(name)) throw new TransformPipelineError(`${label}: the source has no field ${name} to bring in`);
    }
    if (step.sourcePrefix !== undefined && typeof step.sourcePrefix !== 'string') throw new TransformPipelineError(`${label} sourcePrefix must be a string`);
    // The brought-in fields, once prefixed, must not collide with a current
    // field or with each other, so the joined row has no ambiguous column.
    const currentNames = new Set(currentFields.map((candidate) => candidate.name));
    const produced = new Set<string>();
    for (const name of bring.filter((candidate) => !keySourceFields.has(candidate))) {
      const finalName = `${step.sourcePrefix ?? ''}${name}`;
      if (currentNames.has(finalName)) throw new TransformPipelineError(`${label}: brought-in field ${finalName} collides with a current field; set a prefix`);
      if (produced.has(finalName)) throw new TransformPipelineError(`${label}: brought-in field ${finalName} is produced more than once`);
      produced.add(finalName);
    }
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

function runGroupSummarize(
  records: readonly DataRecord[],
  step: GroupSummarizeStep,
  currentFields: readonly TransformedField[],
): { records: DataRecord[]; fields: TransformedField[]; detail: Record<string, number> } {
  interface Group {
    keyValues: unknown[];
    /** Finite numeric values per source field, retained for sum/mean/median/min/max. */
    numeric: Map<string, number[]>;
    /** Distinct raw values per field, retained for `distinct`. */
    distinct: Map<string, Set<string>>;
    count: number;
  }
  const groups = new Map<string, Group>();
  // Which fields actually need retained values, so a group only holds what
  // its aggregations ask for.
  const numericFields = new Set(step.aggregations
    .filter((aggregation) => ['sum', 'mean', 'median', 'min', 'max'].includes(aggregation.kind))
    .map((aggregation) => (aggregation as { field: string }).field));
  const distinctFields = new Set(step.aggregations
    .filter((aggregation) => aggregation.kind === 'distinct')
    .map((aggregation) => (aggregation as { field: string }).field));

  for (const record of records) {
    const keyValues = step.groupFields.map((field) => record[field] ?? null);
    const key = JSON.stringify(keyValues);
    let group = groups.get(key);
    if (!group) {
      group = { keyValues, numeric: new Map(), distinct: new Map(), count: 0 };
      for (const field of numericFields) group.numeric.set(field, []);
      for (const field of distinctFields) group.distinct.set(field, new Set());
      groups.set(key, group);
    }
    group.count++;
    for (const field of numericFields) {
      const value = numericValue(record[field]);
      if (Number.isFinite(value)) group.numeric.get(field)!.push(value);
    }
    for (const field of distinctFields) {
      const raw = record[field];
      if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
        group.distinct.get(field)!.add(String(raw));
      }
    }
  }

  const summarize = (group: Group, aggregation: SummaryAggregation): number | null => {
    if (aggregation.kind === 'count') return group.count;
    if (aggregation.kind === 'distinct') return group.distinct.get(aggregation.field)!.size;
    const values = group.numeric.get(aggregation.field)!;
    // A group with no finite value for this field has no honest number to
    // report - null says "absent", never a fabricated zero.
    if (!values.length) return null;
    switch (aggregation.kind) {
      case 'sum': return values.reduce((total, value) => total + value, 0);
      case 'mean': return values.reduce((total, value) => total + value, 0) / values.length;
      case 'min': return Math.min(...values);
      case 'max': return Math.max(...values);
      case 'median': {
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
      }
    }
  };

  const summarized: DataRecord[] = [...groups.values()].map((group) => {
    const record: DataRecord = {};
    step.groupFields.forEach((field, index) => { record[field] = group.keyValues[index]; });
    for (const aggregation of step.aggregations) record[aggregation.as] = summarize(group, aggregation);
    return record;
  });

  // The output schema is exactly the group keys (which keep whatever lineage
  // they already had - a group key can itself be a derived field) plus the
  // summary columns, which are created here and have no original to inherit.
  const lineageByName = new Map(currentFields.map((field) => [field.name, field.originalName]));
  const keptFields: TransformedField[] = [];
  for (const field of step.groupFields) {
    const originalName = lineageByName.get(field);
    keptFields.push(originalName === undefined ? { name: field } : { name: field, originalName });
  }
  for (const aggregation of step.aggregations) keptFields.push({ name: aggregation.as });

  return {
    records: summarized,
    fields: keptFields,
    detail: { gruposFormados: groups.size, colunasResumo: step.aggregations.length },
  };
}

function runBindRows(
  records: readonly DataRecord[],
  step: BindRowsStep,
  currentFields: readonly TransformedField[],
): { records: DataRecord[]; fields: TransformedField[]; detail: Record<string, number> } {
  const currentNames = currentFields.map((field) => field.name);
  const currentNameSet = new Set(currentNames);
  const sourceNameSet = new Set(step.source.fields);

  // Column order: current fields first, then source-only fields, then the
  // origin column if requested. Nothing is dropped from either side.
  const sourceOnly = step.source.fields.filter((name) => !currentNameSet.has(name));
  const fields: TransformedField[] = [
    ...currentFields,
    // A source column has no original in *this* pipeline's primary dataset,
    // so it carries no originalName; the Worker infers its shape from values.
    ...sourceOnly.map((name) => ({ name })),
  ];
  if (step.originField) fields.push({ name: step.originField });

  const currentLabel = step.currentLabel?.trim() || 'atual';
  const withCurrent = records.map((record) => {
    const next: DataRecord = { ...record };
    // A column only the source has is absent here - null, never invented.
    for (const name of sourceOnly) next[name] = null;
    if (step.originField) next[step.originField] = currentLabel;
    return next;
  });
  const currentOnly = currentNames.filter((name) => !sourceNameSet.has(name));
  const withSource = step.source.records.map((record) => {
    const next: DataRecord = {};
    for (const name of step.source.fields) next[name] = record[name] ?? null;
    // A column only the current dataset has is absent for source records.
    for (const name of currentOnly) next[name] = null;
    if (step.originField) next[step.originField] = step.source.label;
    return next;
  });

  return {
    records: [...withCurrent, ...withSource],
    fields,
    detail: {
      registrosAtuais: records.length,
      registrosAdicionados: step.source.records.length,
      colunasSoAtual: currentOnly.length,
      colunasSoFonte: sourceOnly.length,
    },
  };
}

function runJoin(
  records: readonly DataRecord[],
  step: JoinStep,
  currentFields: readonly TransformedField[],
): { records: DataRecord[]; fields: TransformedField[]; detail: Record<string, number> } {
  const keySourceFields = new Set(step.keyPairs.map((pair) => pair.source));
  const bring = (step.bringFields ?? step.source.fields.filter((name) => !keySourceFields.has(name)))
    .filter((name) => !keySourceFields.has(name));
  const prefix = step.sourcePrefix ?? '';
  const broughtNames = bring.map((name) => ({ source: name, final: `${prefix}${name}` }));

  const keyOf = (record: DataRecord, side: 'current' | 'source'): string =>
    JSON.stringify(step.keyPairs.map((pair) => {
      const value = record[side === 'current' ? pair.current : pair.source];
      return value === undefined || value === '' ? null : value;
    }));

  // Index the source by key so each current record's match is a lookup, not a scan.
  const sourceByKey = new Map<string, DataRecord[]>();
  for (const record of step.source.records) {
    const key = keyOf(record, 'source');
    const bucket = sourceByKey.get(key);
    if (bucket) bucket.push(record); else sourceByKey.set(key, [record]);
  }
  const currentByKey = new Map<string, DataRecord[]>();
  for (const record of records) {
    const key = keyOf(record, 'current');
    const bucket = currentByKey.get(key);
    if (bucket) bucket.push(record); else currentByKey.set(key, [record]);
  }

  // A many-to-many key (duplicated on both sides) multiplies rows; block it
  // unless the author opted in, since it is almost always a mistake.
  if (!step.allowManyToMany) {
    for (const [key, currents] of currentByKey) {
      if (currents.length > 1 && (sourceByKey.get(key)?.length ?? 0) > 1) {
        throw new TransformPipelineError(
          `join: a chave ${key} aparece ${currents.length}x na base atual e ${sourceByKey.get(key)!.length}x na fonte (N:N); confirme antes de multiplicar linhas`,
        );
      }
    }
  }

  const emptySource = (): DataRecord => Object.fromEntries(broughtNames.map(({ final }) => [final, null]));
  const withSource = (base: DataRecord, sourceRecord: DataRecord | null): DataRecord => {
    const next: DataRecord = { ...base };
    for (const { source, final } of broughtNames) next[final] = sourceRecord ? (sourceRecord[source] ?? null) : null;
    return next;
  };

  const output: DataRecord[] = [];
  let matchedCurrent = 0;
  const matchedSourceKeys = new Set<string>();
  for (const record of records) {
    const key = keyOf(record, 'current');
    const matches = sourceByKey.get(key);
    if (matches && matches.length) {
      matchedCurrent++;
      matchedSourceKeys.add(key);
      for (const match of matches) output.push(withSource(record, match));
    } else if (step.joinType === 'left' || step.joinType === 'full') {
      output.push(withSource(record, null));
    }
    // inner/right with no match: the current record is dropped.
  }
  // right/full: source records whose key matched nothing on the current side.
  let sourceOnly = 0;
  if (step.joinType === 'right' || step.joinType === 'full') {
    for (const [key, sourceRecords] of sourceByKey) {
      if (matchedSourceKeys.has(key)) continue;
      for (const sourceRecord of sourceRecords) {
        sourceOnly++;
        // The current-side columns are absent for a source-only row, but the
        // key columns are known - fill them from the source's key fields.
        const base: DataRecord = {};
        for (const field of currentFields) base[field.name] = null;
        for (const pair of step.keyPairs) base[pair.current] = sourceRecord[pair.source] ?? null;
        output.push(withSource(base, sourceRecord));
      }
    }
  }

  const fields: TransformedField[] = [
    ...currentFields,
    ...broughtNames.map(({ final }) => ({ name: final })),
  ];
  return {
    records: output,
    fields,
    detail: {
      registrosCorrespondentes: matchedCurrent,
      registrosSemCorrespondencia: records.length - matchedCurrent,
      registrosSoFonte: sourceOnly,
      colunasTrazidas: broughtNames.length,
    },
  };
}

function runCastType(
  records: readonly DataRecord[],
  step: CastTypeStep,
): { records: DataRecord[]; detail: Record<string, number> } {
  let converted = 0;
  let failed = 0;
  let alreadyMissing = 0;
  const transformed = records.map((record) => {
    const raw = record[step.field];
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      alreadyMissing++;
      return record;
    }
    let next: unknown;
    if (step.to === 'number') {
      const value = numericValue(raw);
      next = Number.isFinite(value) ? value : undefined;
    } else if (step.to === 'text') {
      next = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).trim();
    } else {
      next = parseDateValue(raw);
    }
    if (next === undefined) {
      failed++;
      // `keep` leaves the unconvertible value exactly as it was, so nothing
      // is lost; `missing` marks it, which is a decision the author made.
      return step.onFailure === 'keep' ? record : { ...record, [step.field]: null };
    }
    converted++;
    return { ...record, [step.field]: next };
  });
  return { records: transformed, detail: { convertidos: converted, falhas: failed, jaAusentes: alreadyMissing } };
}

function runDatePart(
  records: readonly DataRecord[],
  step: DatePartStep,
  currentFields: readonly TransformedField[],
): { records: DataRecord[]; fields: TransformedField[]; detail: Record<string, number> } {
  let extracted = 0;
  let unparsed = 0;
  const transformed = records.map((record) => {
    const date = parseDateValue(record[step.field]);
    if (!date) {
      unparsed++;
      // No date means no part of one. Null says "absent", which is true;
      // a zero would be a value the record does not have.
      return { ...record, [step.target]: null };
    }
    extracted++;
    let value: number;
    switch (step.part) {
      case 'year': value = date.getUTCFullYear(); break;
      case 'month': value = date.getUTCMonth() + 1; break;
      case 'day': value = date.getUTCDate(); break;
      case 'quarter': value = Math.floor(date.getUTCMonth() / 3) + 1; break;
      case 'epidemiological-week': value = epidemiologicalWeek(date).week; break;
      case 'epidemiological-year': value = epidemiologicalWeek(date).year; break;
    }
    return { ...record, [step.target]: value };
  });
  return {
    records: transformed,
    fields: [...currentFields, { name: step.target }],
    detail: { extraidos: extracted, semDataValida: unparsed },
  };
}

function applyTextOperation(text: string, operation: TextOperation): string | undefined {
  switch (operation.kind) {
    case 'trim': return text.trim();
    case 'upper': return text.toLocaleUpperCase('pt-BR');
    case 'lower': return text.toLocaleLowerCase('pt-BR');
    case 'pad-start': return text.padStart(operation.length, operation.fill);
    case 'substring': return operation.length === undefined
      ? text.slice(operation.start - 1)
      : text.slice(operation.start - 1, operation.start - 1 + operation.length);
    case 'ibge-municipality': {
      const digits = text.trim();
      if (!/^\d+$/.test(digits)) return undefined;
      // 7 digits carry the check digit that TabWin's own tables omit; 6 is
      // the form every DATASUS municipality table keys on. Shorter codes are
      // left-padded, which is exactly the leading zero a spreadsheet ate.
      if (digits.length === 7) return digits.slice(0, 6);
      if (digits.length === 6) return digits;
      if (digits.length < 6) return digits.padStart(6, '0');
      return undefined;
    }
  }
}

function runTextNormalize(
  records: readonly DataRecord[],
  step: TextNormalizeStep,
): { records: DataRecord[]; detail: Record<string, number> } {
  let changed = 0;
  let failed = 0;
  const transformed = records.map((record) => {
    const raw = record[step.field];
    if (raw === null || raw === undefined) return record;
    let text: string | undefined = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
    for (const operation of step.operations) {
      if (text === undefined) break;
      text = applyTextOperation(text, operation);
    }
    if (text === undefined) {
      // A value an operation could not make sense of is left untouched and
      // counted, never quietly blanked.
      failed++;
      return record;
    }
    if (text === raw) return record;
    changed++;
    return { ...record, [step.field]: text };
  });
  return { records: transformed, detail: { registrosAlterados: changed, naoReconhecidos: failed } };
}

function runDeriveColumn(
  records: readonly DataRecord[],
  step: DeriveColumnStep,
  currentFields: readonly TransformedField[],
): { records: DataRecord[]; fields: TransformedField[]; detail: Record<string, number> } {
  const columns = currentFields.map((field) => ({ key: field.name, label: field.name }));
  const node = parseExpression(columns, step.formula);

  // A formula reading a whole column (LAG, ZSCORE) needs every record
  // projected up front; one that only reads its own row does not, and
  // projecting lazily there keeps a large dataset from paying for a second
  // full copy of itself as numbers.
  const project = (record: DataRecord): number[] => currentFields.map((field) => numericValue(record[field.name]));
  const allCells = expressionReadsEveryRow(node) ? records.map(project) : [];

  let nonFinite = 0;
  const transformed = records.map((record, rowIndex) => {
    const cells = allCells[rowIndex] ?? project(record);
    const value = evaluateTableExpression(node, {
      cells, rowIndex, allCells, divisionByZero: step.divisionByZero,
    });
    if (!Number.isFinite(value)) {
      // Same rule as the derived-column operation: a non-finite result is
      // reported, never written as if it were a number. IFERROR is how an
      // author says what should appear instead.
      nonFinite++;
      throw new TransformPipelineError(
        `${step.field}: formula produced a non-finite value at record ${rowIndex + 1}; wrap it in IFERROR to say what that record should show`,
      );
    }
    return { ...record, [step.field]: value };
  });

  return {
    records: transformed,
    fields: [...currentFields, { name: step.field }],
    detail: { registrosCalculados: transformed.length, naoFinitos: nonFinite },
  };
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
      } else if (step.kind === 'derive-column') {
        const outcome = runDeriveColumn(currentRecords, step, currentFields);
        currentRecords = outcome.records;
        currentFields = outcome.fields;
        detail = outcome.detail;
      } else if (step.kind === 'cast-type') {
        const outcome = runCastType(currentRecords, step);
        currentRecords = outcome.records;
        detail = outcome.detail;
      } else if (step.kind === 'date-part') {
        const outcome = runDatePart(currentRecords, step, currentFields);
        currentRecords = outcome.records;
        currentFields = outcome.fields;
        detail = outcome.detail;
      } else if (step.kind === 'text-normalize') {
        const outcome = runTextNormalize(currentRecords, step);
        currentRecords = outcome.records;
        detail = outcome.detail;
      } else if (step.kind === 'group-summarize') {
        const outcome = runGroupSummarize(currentRecords, step, currentFields);
        currentRecords = outcome.records;
        currentFields = outcome.fields;
        detail = outcome.detail;
      } else if (step.kind === 'bind-rows') {
        const outcome = runBindRows(currentRecords, step, currentFields);
        currentRecords = outcome.records;
        currentFields = outcome.fields;
        detail = outcome.detail;
      } else if (step.kind === 'join') {
        const outcome = runJoin(currentRecords, step, currentFields);
        currentRecords = outcome.records;
        currentFields = outcome.fields;
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
