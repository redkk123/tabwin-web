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
