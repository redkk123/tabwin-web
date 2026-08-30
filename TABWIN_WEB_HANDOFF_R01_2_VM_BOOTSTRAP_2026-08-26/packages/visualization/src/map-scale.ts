export type MapClassification = 'continuous' | 'equal-interval' | 'quantile' | 'manual';
export type MapPalette = 'green' | 'blue' | 'orange' | 'purple';

export interface MapClass {
  lower: number;
  upper: number;
  color: string;
}

export interface MapScale {
  min: number;
  max: number;
  classes: MapClass[];
  colorFor(value: number | undefined): string;
}

export interface MapScaleOptions {
  /**
   * Interior boundaries used only by `manual` classification. The observed
   * minimum and maximum remain the outer limits, so N breaks produce N+1
   * classes. Breaks must be finite, strictly increasing and inside [min,max].
   */
  manualBreaks?: readonly number[];
}

const RAMPS: Record<MapPalette, [string, string]> = {
  green: ['#dcefe7', '#08634f'],
  blue: ['#dcebf5', '#225ea8'],
  orange: ['#fff0d2', '#b84a12'],
  purple: ['#eee4f4', '#6a3d9a'],
};

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function rampColor(palette: MapPalette, ratio: number): string {
  const [startHex, endHex] = RAMPS[palette];
  const start = rgb(startHex);
  const end = rgb(endHex);
  const value = Math.min(1, Math.max(0, ratio));
  return `rgb(${start.map((channel, index) => Math.round(channel + ((end[index] ?? channel) - channel) * value)).join(',')})`;
}

function quantile(sorted: number[], ratio: number): number {
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const low = sorted[lower] ?? 0;
  const high = sorted[Math.min(lower + 1, sorted.length - 1)] ?? low;
  return low + (high - low) * fraction;
}

function manualThresholds(min: number, max: number, source: readonly number[] | undefined): number[] {
  if (!source?.length) throw new Error('manual map classification requires at least one break');
  const breaks = [...source];
  for (let index = 0; index < breaks.length; index++) {
    const value = breaks[index]!;
    if (!Number.isFinite(value)) throw new Error(`manual map break ${index + 1} is not finite`);
    if (value <= min || value >= max) {
      throw new Error(`manual map break ${value} must be strictly inside observed range ${min}..${max}`);
    }
    if (index > 0 && value <= breaks[index - 1]!) {
      throw new Error('manual map breaks must be strictly increasing');
    }
  }
  return [min, ...breaks, max];
}

export function createMapScale(
  source: Iterable<number>,
  classification: MapClassification,
  requestedClassCount: number,
  palette: MapPalette,
  options: MapScaleOptions = {},
): MapScale {
  const values = [...source].filter(Number.isFinite).sort((a, b) => a - b);
  const min = values[0] ?? 0;
  const max = values.at(-1) ?? min;
  const classCount = Math.min(9, Math.max(2, Math.round(requestedClassCount)));
  const thresholds = classification === 'manual'
    ? manualThresholds(min, max, options.manualBreaks)
    : Array.from({ length: classCount + 1 }, (_, index) => {
      if (classification === 'quantile') return quantile(values, index / classCount);
      return min + (max - min) * index / classCount;
    });
  const actualClassCount = Math.max(1, thresholds.length - 1);
  const classes = Array.from({ length: actualClassCount }, (_, index) => ({
    lower: thresholds[index] ?? min,
    upper: thresholds[index + 1] ?? max,
    color: rampColor(palette, actualClassCount === 1 ? 1 : index / (actualClassCount - 1)),
  }));
  return {
    min,
    max,
    classes,
    colorFor(value) {
      if (value === undefined || !Number.isFinite(value)) return '#dfe8e5';
      if (classification === 'continuous') {
        const ratio = max === min ? 1 : (value - min) / (max - min);
        return rampColor(palette, Math.sqrt(Math.min(1, Math.max(0, ratio))));
      }
      const index = classes.findIndex((item, classIndex) => value <= item.upper || classIndex === classes.length - 1);
      return classes[Math.max(0, index)]?.color ?? '#dfe8e5';
    },
  };
}
