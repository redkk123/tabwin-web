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

export interface ScatterDatum extends ChartDatum {
  x: number;
  y: number;
  /** Bubble radius input. Falls back to the row total when no size column is bound. */
  size: number;
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

/**
 * Derives an explicit x/y series from two result columns without mutating the
 * underlying TabulationResult. This is intentionally a presentation binding:
 * it does not alter the query plan or the table used by exports/audit.
 */
export function scatterDataFromResult(
  result: TabulationResult,
  xColumnKey: string,
  yColumnKey: string,
  limit = 100,
  sizeColumnKey?: string,
): ScatterDatum[] {
  const xIndex = result.columns.findIndex((column) => column.key === xColumnKey);
  const yIndex = result.columns.findIndex((column) => column.key === yColumnKey);
  if (xIndex < 0 || yIndex < 0) return [];
  const sizeIndex = sizeColumnKey ? result.columns.findIndex((column) => column.key === sizeColumnKey) : -1;
  return chartDataFromResult(result, { limit: result.rows.length, order: 'source' })
    .map((item) => ({
      ...item,
      x: item.values[xIndex] ?? 0,
      y: item.values[yIndex] ?? 0,
      size: sizeIndex >= 0 ? (item.values[sizeIndex] ?? 0) : item.value,
    }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .slice(0, Math.max(0, limit));
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

export interface ChartSeries {
  key: string;
  label: string;
  values: number[];
}

/**
 * One series per result column, aligned to the rows already selected for the
 * chart. This is what makes a legend mean something: before it existed the
 * renderer collapsed every row to its total, so a "legend" could only ever
 * name a single key.
 */
export function seriesFromResult(result: TabulationResult, data: ChartDatum[]): ChartSeries[] {
  return result.columns.map((column, index) => ({
    key: column.key,
    label: column.label,
    values: data.map((item) => item.values[index] ?? 0),
  }));
}

export interface AxisRequest {
  /** Manual bounds. Both are needed, and max must exceed min, or the pair is ignored. */
  min?: number | undefined;
  max?: number | undefined;
  tickCount?: number | undefined;
}

export interface AxisScale {
  min: number;
  max: number;
  ticks: number[];
  /** True when the caller's bounds were accepted verbatim. */
  manual: boolean;
}

/** 1, 2, 2.5 or 5 times a power of ten - the steps a reader can do arithmetic on. */
function niceStep(range: number, count: number): number {
  if (!(range > 0)) return 1;
  const rough = range / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const multiple of [1, 2, 2.5, 5]) {
    if (rough <= multiple * magnitude) return multiple * magnitude;
  }
  return 10 * magnitude;
}

/** Kills the 0.30000000000000004 that walking a float step produces. */
function tidy(value: number): number {
  return Number(value.toPrecision(12));
}

/**
 * Turns a data range into drawable bounds and tick positions.
 *
 * An invalid manual pair - one bound missing, or max at or below min - is
 * discarded rather than half-applied, because a chart drawn on a collapsed or
 * inverted axis is worse than one drawn on the data's own range. The caller is
 * responsible for telling the user; `manual` reports which path was taken.
 *
 * The check below duplicates `validateAxisBounds` in
 * packages/core/src/axis-bounds.ts, which apps/web/src/main.ts and
 * packages/core/src/recipe.ts both already share. It cannot be pulled in
 * here too: this file is loaded two ways - compiled, via dist/, where a real
 * cross-package import resolves fine, and directly from source by
 * tests/chart-renderer.test.mjs (through apps/web/src/chart-renderer.ts,
 * itself loaded uncompiled). In the second path a genuine value import of
 * `../../core/src/axis-bounds.js` has no literal file to resolve to outside
 * dist/ and throws ERR_MODULE_NOT_FOUND - confirmed by testing it. The
 * existing `import type { TabulationResult } from '../../core/src/model.js'`
 * above survives that same path only because `import type` is erased
 * entirely by type stripping before Node ever tries to resolve it; a real
 * function import like `validateAxisBounds` is not erased and does not get
 * that pass. If this rule ever needs to change, change it in both places.
 */
export function resolveAxis(dataMin: number, dataMax: number, request: AxisRequest = {}): AxisScale {
  const tickCount = Math.min(20, Math.max(2, Math.round(request.tickCount ?? 5)));
  const { min: wantedMin, max: wantedMax } = request;
  if (Number.isFinite(wantedMin) && Number.isFinite(wantedMax) && (wantedMax as number) > (wantedMin as number)) {
    const min = wantedMin as number;
    const step = ((wantedMax as number) - min) / tickCount;
    return {
      min,
      max: wantedMax as number,
      ticks: Array.from({ length: tickCount + 1 }, (_, index) => tidy(min + index * step)),
      manual: true,
    };
  }
  let low = Math.min(dataMin, dataMax);
  let high = Math.max(dataMin, dataMax);
  if (!Number.isFinite(low) || !Number.isFinite(high)) { low = 0; high = 1; }
  if (high === low) high = low + Math.abs(low || 1);
  const step = niceStep(high - low, tickCount);
  const min = tidy(Math.floor(low / step) * step);
  const max = tidy(Math.ceil(high / step) * step);
  const ticks: number[] = [];
  for (let index = 0; min + index * step <= max + step / 2; index += 1) ticks.push(tidy(min + index * step));
  return { min, max, ticks, manual: false };
}
