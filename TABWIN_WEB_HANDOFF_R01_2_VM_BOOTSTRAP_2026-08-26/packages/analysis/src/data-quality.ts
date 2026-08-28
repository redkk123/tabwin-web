import type { DataRecord } from '../../core/src/model.js';

export interface NumericFieldProfile {
  field: string;
  totalRecords: number;
  numericRecords: number;
  missingRecords: number;
  invalidRecords: number;
  distinctValues: number;
  minimum?: number;
  firstQuartile?: number;
  median?: number;
  thirdQuartile?: number;
  maximum?: number;
  lowerIqrFence?: number;
  upperIqrFence?: number;
  iqrOutlierRecords: number;
}

export interface FieldCombination {
  /** One entry per requested field, in the requested order; null when absent. */
  values: Array<string | null>;
  records: number;
  /** Fraction of all profiled records, between 0 and 1. */
  share: number;
}

export interface FieldCombinationProfile {
  fields: string[];
  totalRecords: number;
  distinctCombinations: number;
  /** True when the combination cap was reached and counting stopped. */
  truncated: boolean;
  /** Rarest first. Order is deterministic for equal counts. */
  combinations: FieldCombination[];
}

const DEFAULT_COMBINATION_LIMIT = 50;
const DEFAULT_MAX_COMBINATIONS = 200_000;
/** One retained numeric column: 5 million values is roughly 40 MiB. */
const DEFAULT_MAX_RETAINED_VALUES = 5_000_000;

/**
 * Incremental profiler fed by bounded record batches.
 *
 * Every one-shot profile in this module is a thin wrapper over its accumulator,
 * so the streaming and in-memory paths can never drift apart.
 */
export interface ProfileAccumulator<T> {
  push(records: Iterable<DataRecord>): void;
  finish(): T;
}

/**
 * Collects the distinct values of one field for the filter picker.
 *
 * Bounded by construction: once `limit` values are known it keeps counting
 * records but stops growing, so a high-cardinality field cannot exhaust memory.
 */
export function createDistinctValueCollector(
  field: string,
  limit = 500,
): ProfileAccumulator<{ values: string[]; truncated: boolean }> {
  if (!field.trim()) throw new Error('distinct values require a field');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`limite inválido de valores distintos: ${limit}`);
  const values = new Set<string>();
  let truncated = false;

  return {
    push(records: Iterable<DataRecord>): void {
      for (const record of records) {
        const raw = record[field];
        if (raw === null || raw === undefined) continue;
        if (values.size >= limit) {
          truncated = true;
          continue;
        }
        values.add(String(raw));
      }
    },
    finish() {
      return {
        values: [...values].sort((left, right) => left.localeCompare(right, 'pt-BR', { numeric: true })),
        truncated,
      };
    },
  };
}

function combinationValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

/**
 * Counts how often each combination of the given fields occurs.
 *
 * This is a frequency observation and nothing more: it reports that a
 * combination is rare, never that it is wrong. Deciding that a rare
 * combination is implausible is the user's call, expressed as a
 * `CrossFieldRuleSpec`. No clinical or epidemiological meaning is applied
 * here, because the project has no oracle for any.
 */
export function createFieldCombinationProfiler(
  fields: readonly string[],
  options: { limit?: number; maxCombinations?: number } = {},
): ProfileAccumulator<FieldCombinationProfile> {
  const requested = fields.map((field) => field.trim());
  if (requested.length < 2) throw new Error('combination profile requires at least two fields');
  if (requested.some((field) => !field)) throw new Error('combination profile requires non-empty fields');
  if (new Set(requested).size !== requested.length) throw new Error('combination profile requires distinct fields');
  const limit = options.limit ?? DEFAULT_COMBINATION_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`limite inválido para combinações: ${limit}`);
  const maxCombinations = options.maxCombinations ?? DEFAULT_MAX_COMBINATIONS;
  if (!Number.isSafeInteger(maxCombinations) || maxCombinations < 1) {
    throw new Error(`limite inválido de combinações distintas: ${maxCombinations}`);
  }

  const counts = new Map<string, { values: Array<string | null>; records: number }>();
  let truncated = false;
  let total = 0;

  function push(records: Iterable<DataRecord>): void {
    for (const record of records) {
      total += 1;
      const values = requested.map((field) => combinationValue(record[field]));
      // JSON is injective for Array<string | null>, so no separator character
      // can collide with a real field value and absence stays distinct from ''.
      const key = JSON.stringify(values);
      const existing = counts.get(key);
      if (existing) {
        existing.records += 1;
        continue;
      }
      if (counts.size >= maxCombinations) {
        truncated = true;
        continue;
      }
      counts.set(key, { values, records: 1 });
    }
  }

  function finish(): FieldCombinationProfile {
    const combinations = [...counts.entries()]
      .sort(([leftKey, left], [rightKey, right]) =>
        left.records - right.records || leftKey.localeCompare(rightKey))
      .slice(0, limit)
      .map(([, entry]) => ({
        values: entry.values,
        records: entry.records,
        share: total ? entry.records / total : 0,
      }));

    return {
      fields: requested,
      totalRecords: total,
      distinctCombinations: counts.size,
      truncated,
      combinations,
    };
  }

  return { push, finish };
}

export function profileFieldCombinations(
  records: readonly DataRecord[],
  fields: readonly string[],
  options: { limit?: number; maxCombinations?: number } = {},
): FieldCombinationProfile {
  const profiler = createFieldCombinationProfiler(fields, options);
  profiler.push(records);
  return profiler.finish();
}

function numericValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

function quantile(sorted: readonly number[], probability: number): number | undefined {
  if (!sorted.length) return undefined;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const start = sorted[lower]!;
  const end = sorted[Math.min(lower + 1, sorted.length - 1)]!;
  return start + (end - start) * fraction;
}

/**
 * Descriptive diagnostics only. Nothing is removed or rewritten here.
 *
 * Quartiles need every value, so this retains the profiled column — and only
 * that column. Beyond {@link DEFAULT_MAX_RETAINED_VALUES} it fails with an
 * explicit capacity message instead of quietly profiling a truncated sample,
 * because quantiles over a silent subset would be misleading rather than
 * merely incomplete.
 */
export function createNumericFieldProfiler(
  field: string,
  options: { maxRetainedValues?: number } = {},
): ProfileAccumulator<NumericFieldProfile> {
  if (!field.trim()) throw new Error('numeric profile requires a field');
  const maxRetainedValues = options.maxRetainedValues ?? DEFAULT_MAX_RETAINED_VALUES;
  if (!Number.isSafeInteger(maxRetainedValues) || maxRetainedValues < 1) {
    throw new Error(`limite inválido de valores retidos: ${maxRetainedValues}`);
  }
  const values: number[] = [];
  let totalRecords = 0;
  let missingRecords = 0;
  let invalidRecords = 0;

  function push(records: Iterable<DataRecord>): void {
    for (const record of records) {
      totalRecords += 1;
      const raw = record[field];
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        missingRecords++;
        continue;
      }
      const value = numericValue(raw);
      if (value === undefined) {
        invalidRecords++;
        continue;
      }
      if (values.length >= maxRetainedValues) {
        throw new Error(
          `O perfil numérico de ${field} precisaria reter mais de ${maxRetainedValues.toLocaleString('pt-BR')} valores. `
          + 'Quartis sobre uma amostra truncada seriam enganosos, então o perfil não foi calculado. '
          + 'Reduza o conjunto com um filtro antes de perfilar.',
        );
      }
      values.push(value);
    }
  }

  function finish(): NumericFieldProfile {
    return summarizeNumericValues(field, [...values].sort((left, right) => left - right), {
      totalRecords, missingRecords, invalidRecords,
    });
  }

  return { push, finish };
}

export function profileNumericField(records: readonly DataRecord[], field: string): NumericFieldProfile {
  const profiler = createNumericFieldProfiler(field);
  profiler.push(records);
  return profiler.finish();
}

function summarizeNumericValues(
  field: string,
  values: readonly number[],
  counts: { totalRecords: number; missingRecords: number; invalidRecords: number },
): NumericFieldProfile {
  const { totalRecords, missingRecords, invalidRecords } = counts;
  const firstQuartile = quantile(values, .25);
  const median = quantile(values, .5);
  const thirdQuartile = quantile(values, .75);
  const spread = firstQuartile === undefined || thirdQuartile === undefined
    ? undefined : thirdQuartile - firstQuartile;
  const lowerIqrFence = spread === undefined ? undefined : firstQuartile! - 1.5 * spread;
  const upperIqrFence = spread === undefined ? undefined : thirdQuartile! + 1.5 * spread;
  const iqrOutlierRecords = lowerIqrFence === undefined || upperIqrFence === undefined
    ? 0 : values.filter((value) => value < lowerIqrFence || value > upperIqrFence).length;
  const base = {
    field,
    totalRecords,
    numericRecords: values.length,
    missingRecords,
    invalidRecords,
    distinctValues: new Set(values).size,
    iqrOutlierRecords,
  };
  if (!values.length) return base;
  return {
    ...base,
    minimum: values[0]!,
    firstQuartile: firstQuartile!,
    median: median!,
    thirdQuartile: thirdQuartile!,
    maximum: values.at(-1)!,
    lowerIqrFence: lowerIqrFence!,
    upperIqrFence: upperIqrFence!,
  };
}
