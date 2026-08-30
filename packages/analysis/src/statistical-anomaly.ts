/**
 * Statistical anomaly primitives for TabWin Web.
 *
 * Design contract:
 * - statistical unusualness is evidence, never a declaration that a record is wrong;
 * - no clinical/epidemiological rule is embedded here;
 * - every detector returns interpretable effect-size evidence;
 * - automatic exclusion is intentionally impossible in this module.
 */

export type StatisticalSignalKind =
  | 'numeric-outlier'
  | 'temporal-outlier'
  | 'rare-category'
  | 'distribution-shift'
  | 'subgroup-divergence'
  | 'geographic-concentration'
  | 'missingness-shift';

export type StatisticalSeverity = 'info' | 'review' | 'strong';

export interface StatisticalEvidence {
  metric: string;
  value: number;
  reference?: number;
  threshold?: number;
  unit?: string;
  note?: string;
}

export interface StatisticalSignal {
  id: string;
  kind: StatisticalSignalKind;
  severity: StatisticalSeverity;
  score: number; // 0..100. Evidence strength, NOT probability of error.
  fields: string[];
  label: string;
  explanation: string;
  evidence: StatisticalEvidence[];
  automaticAction: 'none';
}

export interface QuantileSummary {
  count: number;
  minimum?: number;
  q1?: number;
  median?: number;
  q3?: number;
  maximum?: number;
  iqr?: number;
  mad?: number;
}

export interface NumericOutlierPoint {
  index: number;
  value: number;
  robustZ: number;
  outsideIqrFence: boolean;
  score: number;
}

export interface NumericOutlierScan {
  summary: QuantileSummary;
  lowerIqrFence?: number;
  upperIqrFence?: number;
  points: NumericOutlierPoint[];
}

export interface TimePoint {
  key: string | number;
  value: number;
}

export interface TemporalOutlierPoint extends TimePoint {
  index: number;
  localMedian: number;
  localMad: number;
  robustZ: number;
  score: number;
}

export interface DistributionComparison {
  keys: string[];
  leftTotal: number;
  rightTotal: number;
  jensenShannonDivergence: number; // 0..1 when log base 2 is used.
  totalVariationDistance: number; // 0..1.
  maxAbsoluteShareDifference: number; // 0..1.
  rows: Array<{
    key: string;
    leftCount: number;
    rightCount: number;
    leftShare: number;
    rightShare: number;
    difference: number;
    log2Lift?: number;
  }>;
}

export interface ConcentrationProfile {
  total: number;
  distinct: number;
  topKey?: string;
  topShare: number;
  hhi: number; // sum(p^2), 1/n..1
  normalizedEntropy: number; // 0..1, higher = more diffuse
}

export interface ProportionComparison {
  exposedEvents: number;
  exposedTotal: number;
  referenceEvents: number;
  referenceTotal: number;
  exposedProportion: number;
  referenceProportion: number;
  riskDifference: number;
  riskRatio?: number;
  oddsRatio?: number;
  z?: number;
  pValue?: number;
  exposedWilson95: [number, number];
  referenceWilson95: [number, number];
}

function finite(values: readonly number[]): number[] {
  return values.filter(Number.isFinite);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function median(values: readonly number[]): number | undefined {
  return quantile([...values].sort((a, b) => a - b), .5);
}

function mad(values: readonly number[], center?: number): number | undefined {
  if (!values.length) return undefined;
  const resolvedCenter = center ?? median(values);
  if (resolvedCenter === undefined) return undefined;
  return median(values.map((value) => Math.abs(value - resolvedCenter)));
}

export function summarizeRobust(valuesSource: readonly number[]): QuantileSummary {
  const values = finite(valuesSource).sort((a, b) => a - b);
  if (!values.length) return { count: 0 };
  const q1 = quantile(values, .25)!;
  const q2 = quantile(values, .5)!;
  const q3 = quantile(values, .75)!;
  return {
    count: values.length,
    minimum: values[0]!,
    q1,
    median: q2,
    q3,
    maximum: values.at(-1)!,
    iqr: q3 - q1,
    mad: mad(values, q2) ?? 0,
  };
}

/**
 * Modified z-score uses 0.67448975 * (x - median) / MAD.
 * If MAD is zero, falls back to IQR scaling; if both are zero, z=0.
 */
export function scanNumericOutliers(
  valuesSource: readonly number[],
  options: { robustZThreshold?: number; iqrMultiplier?: number } = {},
): NumericOutlierScan {
  const values = finite(valuesSource);
  const summary = summarizeRobust(values);
  if (!summary.count) return { summary, points: [] };
  const robustZThreshold = options.robustZThreshold ?? 3.5;
  const iqrMultiplier = options.iqrMultiplier ?? 1.5;
  const iqr = summary.iqr ?? 0;
  const lowerIqrFence = (summary.q1 ?? 0) - iqrMultiplier * iqr;
  const upperIqrFence = (summary.q3 ?? 0) + iqrMultiplier * iqr;
  const center = summary.median ?? 0;
  const scaleMad = summary.mad ?? 0;
  const scaleIqr = iqr > 0 ? iqr / 1.349 : 0; // normal-consistent robust sigma approx.

  const points = valuesSource.flatMap((value, index): NumericOutlierPoint[] => {
    if (!Number.isFinite(value)) return [];
    const robustZ = scaleMad > 0
      ? 0.67448975 * (value - center) / scaleMad
      : scaleIqr > 0 ? (value - center) / scaleIqr : 0;
    const outsideIqrFence = value < lowerIqrFence || value > upperIqrFence;
    if (Math.abs(robustZ) < robustZThreshold && !outsideIqrFence) return [];
    const zStrength = Math.abs(robustZ) / robustZThreshold;
    const fenceDistance = value < lowerIqrFence
      ? (lowerIqrFence - value) / (Math.abs(iqr) || 1)
      : value > upperIqrFence ? (value - upperIqrFence) / (Math.abs(iqr) || 1) : 0;
    return [{
      index,
      value,
      robustZ,
      outsideIqrFence,
      score: Math.round(100 * clamp(Math.max(zStrength / 2, fenceDistance / 3), 0, 1)),
    }];
  });

  return { summary, lowerIqrFence, upperIqrFence, points };
}

/** Rolling Hampel detector. Defaults to log1p transform for non-negative counts. */
export function scanTemporalOutliers(
  points: readonly TimePoint[],
  options: { windowRadius?: number; robustZThreshold?: number; log1p?: boolean } = {},
): TemporalOutlierPoint[] {
  const radius = options.windowRadius ?? 3;
  const threshold = options.robustZThreshold ?? 3.5;
  const useLog = options.log1p ?? true;
  if (!Number.isSafeInteger(radius) || radius < 1) throw new Error('windowRadius must be a positive integer');

  const transformed = points.map(({ value }) => {
    if (!Number.isFinite(value)) return Number.NaN;
    return useLog && value >= 0 ? Math.log1p(value) : value;
  });
  const output: TemporalOutlierPoint[] = [];

  for (let index = 0; index < points.length; index++) {
    const current = transformed[index]!;
    if (!Number.isFinite(current)) continue;
    const start = Math.max(0, index - radius);
    const end = Math.min(points.length, index + radius + 1);
    const local = transformed.slice(start, end).filter(Number.isFinite);
    if (local.length < 3) continue;
    const localMedian = median(local)!;
    const localMad = mad(local, localMedian) ?? 0;
    const localIqrSummary = summarizeRobust(local);
    const fallbackSigma = (localIqrSummary.iqr ?? 0) / 1.349;
    const robustZ = localMad > 0
      ? 0.67448975 * (current - localMedian) / localMad
      : fallbackSigma > 0 ? (current - localMedian) / fallbackSigma : 0;
    if (Math.abs(robustZ) < threshold) continue;
    output.push({
      ...points[index]!,
      index,
      localMedian: useLog ? Math.expm1(localMedian) : localMedian,
      localMad,
      robustZ,
      score: Math.round(100 * clamp(Math.abs(robustZ) / (threshold * 2), 0, 1)),
    });
  }
  return output;
}

function normalizeCounts(counts: ReadonlyMap<string, number>, keys: readonly string[]): number[] {
  const total = keys.reduce((sum, key) => sum + Math.max(0, counts.get(key) ?? 0), 0);
  return keys.map((key) => total ? Math.max(0, counts.get(key) ?? 0) / total : 0);
}

function klDivergence(p: readonly number[], q: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const pi = p[i] ?? 0;
    const qi = q[i] ?? 0;
    if (pi <= 0) continue;
    if (qi <= 0) return Number.POSITIVE_INFINITY;
    sum += pi * Math.log2(pi / qi);
  }
  return sum;
}

export function compareCategoricalDistributions(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): DistributionComparison {
  const keys = [...new Set([...left.keys(), ...right.keys()])]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  const leftTotal = keys.reduce((sum, key) => sum + Math.max(0, left.get(key) ?? 0), 0);
  const rightTotal = keys.reduce((sum, key) => sum + Math.max(0, right.get(key) ?? 0), 0);
  const p = normalizeCounts(left, keys);
  const q = normalizeCounts(right, keys);
  const m = p.map((value, index) => (value + (q[index] ?? 0)) / 2);
  const jsd = Number.isFinite(klDivergence(p, m)) && Number.isFinite(klDivergence(q, m))
    ? (klDivergence(p, m) + klDivergence(q, m)) / 2 : 1;
  let totalVariation = 0;
  let maxDifference = 0;
  const rows = keys.map((key, index) => {
    const leftShare = p[index] ?? 0;
    const rightShare = q[index] ?? 0;
    const difference = leftShare - rightShare;
    totalVariation += Math.abs(difference);
    maxDifference = Math.max(maxDifference, Math.abs(difference));
    const log2Lift = leftShare > 0 && rightShare > 0 ? Math.log2(leftShare / rightShare) : undefined;
    return {
      key,
      leftCount: Math.max(0, left.get(key) ?? 0),
      rightCount: Math.max(0, right.get(key) ?? 0),
      leftShare,
      rightShare,
      difference,
      ...(log2Lift === undefined ? {} : { log2Lift }),
    };
  });
  return {
    keys,
    leftTotal,
    rightTotal,
    jensenShannonDivergence: clamp(jsd, 0, 1),
    totalVariationDistance: clamp(totalVariation / 2, 0, 1),
    maxAbsoluteShareDifference: maxDifference,
    rows,
  };
}

export function concentrationProfile(counts: ReadonlyMap<string, number>): ConcentrationProfile {
  const entries = [...counts.entries()].filter(([, value]) => Number.isFinite(value) && value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return { total: 0, distinct: 0, topShare: 0, hhi: 0, normalizedEntropy: 0 };
  const shares = entries.map(([key, value]) => ({ key, share: value / total }));
  shares.sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
  const hhi = shares.reduce((sum, { share }) => sum + share ** 2, 0);
  const entropy = -shares.reduce((sum, { share }) => sum + share * Math.log(share), 0);
  const maxEntropy = shares.length > 1 ? Math.log(shares.length) : 0;
  const topKey = shares[0]?.key;
  return {
    total,
    distinct: shares.length,
    ...(topKey === undefined ? {} : { topKey }),
    topShare: shares[0]?.share ?? 0,
    hhi,
    normalizedEntropy: maxEntropy > 0 ? entropy / maxEntropy : 0,
  };
}

export function wilsonInterval95(events: number, total: number): [number, number] {
  if (!Number.isFinite(events) || !Number.isFinite(total) || total <= 0 || events < 0 || events > total) {
    throw new Error('invalid binomial counts');
  }
  const z = 1.959963984540054;
  const p = events / total;
  const denominator = 1 + z ** 2 / total;
  const center = (p + z ** 2 / (2 * total)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total) / denominator;
  // At events=0 or events=total, center and half nearly cancel and leave a
  // float residual like 3e-18 on the bound that should be exactly 0 or 1 - the
  // kind of value that reads as broken math in a report. toPrecision rounds by
  // significant digits, which does nothing for a value already near zero, so
  // this snaps to a fixed number of decimal places instead - plenty for a
  // proportion - which does collapse the residual without touching a real,
  // non-degenerate bound.
  const tidy = (value: number): number => Math.round(clamp(value, 0, 1) * 1e12) / 1e12;
  return [tidy(center - half), tidy(center + half)];
}

// Abramowitz & Stegun-style approximation; enough for screening diagnostics.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function standardNormalCdf(x: number): number {
  return .5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Two-proportion comparison. The p-value is a screening statistic only;
 * callers must combine it with effect size and multiple-testing control.
 */
export function compareProportions(
  exposedEvents: number,
  exposedTotal: number,
  referenceEvents: number,
  referenceTotal: number,
): ProportionComparison {
  if (exposedTotal <= 0 || referenceTotal <= 0
    || exposedEvents < 0 || exposedEvents > exposedTotal
    || referenceEvents < 0 || referenceEvents > referenceTotal) {
    throw new Error('invalid proportion counts');
  }
  const p1 = exposedEvents / exposedTotal;
  const p2 = referenceEvents / referenceTotal;
  const pooled = (exposedEvents + referenceEvents) / (exposedTotal + referenceTotal);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / exposedTotal + 1 / referenceTotal));
  const z = standardError > 0 ? (p1 - p2) / standardError : undefined;
  const pValue = z === undefined ? undefined : clamp(2 * (1 - standardNormalCdf(Math.abs(z))), 0, 1);
  const riskRatio = p2 > 0 ? p1 / p2 : undefined;
  const odds1 = p1 < 1 ? p1 / (1 - p1) : undefined;
  const odds2 = p2 > 0 && p2 < 1 ? p2 / (1 - p2) : undefined;
  const oddsRatio = odds1 !== undefined && odds2 !== undefined ? odds1 / odds2 : undefined;
  return {
    exposedEvents,
    exposedTotal,
    referenceEvents,
    referenceTotal,
    exposedProportion: p1,
    referenceProportion: p2,
    riskDifference: p1 - p2,
    ...(riskRatio === undefined ? {} : { riskRatio }),
    ...(oddsRatio === undefined ? {} : { oddsRatio }),
    ...(z === undefined ? {} : { z }),
    ...(pValue === undefined ? {} : { pValue }),
    exposedWilson95: wilsonInterval95(exposedEvents, exposedTotal),
    referenceWilson95: wilsonInterval95(referenceEvents, referenceTotal),
  };
}

/** Benjamini-Hochberg false-discovery-rate adjustment. */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const indexed = pValues.map((p, index) => ({ p: clamp(p, 0, 1), index }))
    .sort((a, b) => a.p - b.p || a.index - b.index);
  const adjusted = new Array<number>(pValues.length).fill(1);
  let running = 1;
  for (let i = indexed.length - 1; i >= 0; i--) {
    const item = indexed[i]!;
    const rank = i + 1;
    running = Math.min(running, item.p * indexed.length / rank);
    adjusted[item.index] = clamp(running, 0, 1);
  }
  return adjusted;
}

/**
 * Converts effect evidence into a review score without pretending it is
 * a probability of error. p/q alone can never create a strong signal.
 */
export function scoreDistributionShift(comparison: DistributionComparison): number {
  const js = comparison.jensenShannonDivergence;
  const tv = comparison.totalVariationDistance;
  const max = comparison.maxAbsoluteShareDifference;
  return Math.round(100 * clamp(.45 * (js / .25) + .35 * (tv / .35) + .20 * (max / .25), 0, 1));
}

export function severityFromScore(score: number): StatisticalSeverity {
  return score >= 75 ? 'strong' : score >= 40 ? 'review' : 'info';
}
