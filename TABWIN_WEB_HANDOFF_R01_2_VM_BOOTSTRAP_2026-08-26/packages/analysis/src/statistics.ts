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
