export interface DescriptiveStatistics {
  count: number;
  sum: number;
  mean: number;
  minimum: number;
  maximum: number;
  median: number;
  sampleVariance: number;
  sampleStandardDeviation: number;
}

export interface LinearRegression {
  count: number;
  slope: number;
  intercept: number;
  rSquared: number;
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
}

function finite(values: Iterable<number>): number[] {
  return [...values].filter(Number.isFinite);
}

export function descriptiveStatistics(source: Iterable<number>): DescriptiveStatistics {
  const values = finite(source).sort((a, b) => a - b);
  if (!values.length) throw new Error('descriptive statistics require at least one finite value');
  const count = values.length;
  const sum = values.reduce((total, value) => total + value, 0);
  const mean = sum / count;
  const middle = Math.floor(count / 2);
  const median = count % 2 ? values[middle]! : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
  const squaredError = values.reduce((total, value) => total + (value - mean) ** 2, 0);
  const sampleVariance = count > 1 ? squaredError / (count - 1) : 0;
  return {
    count,
    sum,
    mean,
    minimum: values[0]!,
    maximum: values.at(-1)!,
    median,
    sampleVariance,
    sampleStandardDeviation: Math.sqrt(sampleVariance),
  };
}

function paired(xSource: Iterable<number>, ySource: Iterable<number>): Array<[number, number]> {
  const x = [...xSource];
  const y = [...ySource];
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < Math.min(x.length, y.length); index++) {
    const xValue = x[index];
    const yValue = y[index];
    if (xValue !== undefined && yValue !== undefined && Number.isFinite(xValue) && Number.isFinite(yValue)) {
      pairs.push([xValue, yValue]);
    }
  }
  return pairs;
}

export function pearsonCorrelation(xSource: Iterable<number>, ySource: Iterable<number>): number {
  const pairs = paired(xSource, ySource);
  if (pairs.length < 2) throw new Error('correlation requires at least two finite pairs');
  const xMean = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const yMean = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let covariance = 0;
  let xSquared = 0;
  let ySquared = 0;
  for (const [x, y] of pairs) {
    covariance += (x - xMean) * (y - yMean);
    xSquared += (x - xMean) ** 2;
    ySquared += (y - yMean) ** 2;
  }
  const denominator = Math.sqrt(xSquared * ySquared);
  if (!denominator) throw new Error('correlation is undefined for a constant series');
  return covariance / denominator;
}

export function simpleLinearRegression(xSource: Iterable<number>, ySource: Iterable<number>): LinearRegression {
  const pairs = paired(xSource, ySource);
  if (pairs.length < 2) throw new Error('linear regression requires at least two finite pairs');
  const xMean = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const yMean = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of pairs) {
    numerator += (x - xMean) * (y - yMean);
    denominator += (x - xMean) ** 2;
  }
  if (!denominator) throw new Error('linear regression is undefined for a constant predictor');
  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  const correlation = pearsonCorrelation(pairs.map(([x]) => x), pairs.map(([, y]) => y));
  return { count: pairs.length, slope, intercept, rSquared: correlation ** 2 };
}

export interface GaussianFit {
  count: number;
  mean: number;
  standardDeviation: number;
}

export interface GaussianOverlayPoint {
  lower: number;
  upper: number;
  expectedCount: number;
}

/**
 * Fits a normal distribution to the sample mean and sample standard
 * deviation. This is a descriptive reference curve, not a test of normality:
 * it answers "what would a normal curve with this mean and spread look
 * like", not "is this distribution normal". Nothing here classifies the data
 * or flags a mismatch - that judgment stays with the reader.
 */
export function fitGaussian(source: Iterable<number>): GaussianFit {
  const values = finite(source);
  if (values.length < 2) throw new Error('gaussian fit requires at least two finite values');
  const count = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
  const standardDeviation = Math.sqrt(variance);
  if (!(standardDeviation > 0)) throw new Error('gaussian fit is undefined for a constant series');
  return { count, mean, standardDeviation };
}

/** Standard normal probability density, evaluated at a fitted mean/spread. */
export function gaussianDensity(x: number, fit: Pick<GaussianFit, 'mean' | 'standardDeviation'>): number {
  const z = (x - fit.mean) / fit.standardDeviation;
  return Math.exp(-0.5 * z * z) / (fit.standardDeviation * Math.sqrt(2 * Math.PI));
}

/**
 * Expected count per histogram bin under the fitted curve, so a caller can
 * draw it as a line or a second bar alongside the observed one. Approximates
 * the bin's integral by the density at its midpoint times its width - exact
 * enough to compare by eye against real bins, and it does not claim to be a
 * fitted goodness-of-fit statistic.
 */
export function gaussianOverlay(bins: readonly HistogramBin[], fit: GaussianFit): GaussianOverlayPoint[] {
  return bins.map((bin) => {
    const width = bin.upper - bin.lower;
    const midpoint = (bin.lower + bin.upper) / 2;
    return {
      lower: bin.lower,
      upper: bin.upper,
      expectedCount: width > 0 ? gaussianDensity(midpoint, fit) * width * fit.count : 0,
    };
  });
}

export function histogram(source: Iterable<number>, requestedBins?: number): HistogramBin[] {
  const values = finite(source);
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binCount = Math.min(50, Math.max(1, requestedBins ?? Math.ceil(Math.log2(values.length) + 1)));
  if (min === max) return [{ lower: min, upper: max, count: values.length }];
  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lower: min + index * width,
    upper: min + (index + 1) * width,
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    bins[index]!.count++;
  }
  return bins;
}
