import type { TabulationResult } from '../../core/src/model.js';

export type ChartType = 'horizontal-bar' | 'vertical-bar' | 'line' | 'area' | 'pie' | 'points' | 'bubbles' | 'arrows';

export interface ChartDatum {
  key: string;
  label: string;
  value: number;
  values: number[];
}

export interface ArrowDatum extends ChartDatum {
  start: number;
  end: number;
}

export interface ChartDataOptions {
  limit: number;
  order: 'ranked' | 'source';
}

export function chartDataFromResult(
  result: TabulationResult,
  options: ChartDataOptions,
): ChartDatum[] {
  const data = result.rows.map((row, index) => {
    const values = [...(result.cells[index] ?? [])];
    return {
      key: row.key,
      label: row.label,
      value: values.reduce((sum, value) => sum + value, 0),
      values,
    };
  });
  if (options.order === 'ranked') data.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return data.slice(0, Math.max(0, options.limit));
}

export function arrowDataFromResult(result: TabulationResult, limit: number): ArrowDatum[] {
  if (result.columns.length < 2) return [];
  return chartDataFromResult(result, { limit: result.rows.length, order: 'source' })
    .map((item) => ({
      ...item,
      start: item.values[0] ?? 0,
      end: item.values[item.values.length - 1] ?? 0,
    }))
    .sort((a, b) => Math.abs(b.end - b.start) - Math.abs(a.end - a.start) || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit));
}

