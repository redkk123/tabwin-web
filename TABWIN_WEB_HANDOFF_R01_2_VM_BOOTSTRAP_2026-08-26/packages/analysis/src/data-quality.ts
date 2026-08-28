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
export function profileFieldCombinations(
  records: readonly DataRecord[],
  fields: readonly string[],
  options: { limit?: number; maxCombinations?: number } = {},
): FieldCombinationProfile {
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
  for (const record of records) {
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

  const total = records.length;
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

/** Descriptive diagnostics only. Nothing is removed or rewritten here. */
export function profileNumericField(records: readonly DataRecord[], field: string): NumericFieldProfile {
  if (!field.trim()) throw new Error('numeric profile requires a field');
  const values: number[] = [];
  let missingRecords = 0;
  let invalidRecords = 0;
  for (const record of records) {
    const raw = record[field];
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      missingRecords++;
      continue;
    }
    const value = numericValue(raw);
    if (value === undefined) invalidRecords++;
    else values.push(value);
  }
  values.sort((left, right) => left - right);
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
    totalRecords: records.length,
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
