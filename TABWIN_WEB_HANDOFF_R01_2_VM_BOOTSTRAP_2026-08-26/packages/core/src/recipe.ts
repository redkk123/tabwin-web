import type { QueryPlan, SourceFingerprint, TabulationSpec } from './model.js';
import { compileQueryPlan } from './plan.js';

export interface ConversionFingerprint {
  id: string;
  name: string;
  sha256: string;
  size: number;
}

export interface AnalysisRecipeV1 {
  schema: 'tabwin-web.recipe';
  version: 1;
  name?: string;
  spec: TabulationSpec;
  conversions: ConversionFingerprint[];
  sourceHints: Array<Pick<SourceFingerprint, 'name' | 'sha256' | 'size'>>;
  view?: {
    chartType?: 'horizontal-bar' | 'vertical-bar' | 'line' | 'area' | 'pie' | 'points' | 'bubbles' | 'arrows';
    mapClassification?: 'continuous' | 'equal-interval' | 'quantile';
    mapClassCount?: number;
    mapPalette?: 'green' | 'blue' | 'orange' | 'purple';
    statisticsOperation?: 'descriptive' | 'correlation' | 'regression' | 'histogram';
    statisticsXColumnKey?: string;
    statisticsYColumnKey?: string;
    histogramBins?: number;
  };
}

export interface RunManifestV1 {
  schema: 'tabwin-web.run-manifest';
  version: 1;
  appVersion: string;
  executedAt: string;
  plan: QueryPlan;
  sources: SourceFingerprint[];
  conversions: ConversionFingerprint[];
  result: {
    recordsSeen: number;
    recordsAccepted: number;
    rowCount: number;
    columnCount: number;
    warnings: string[];
  };
}

/**
 * Deterministic JSON representation for diffs, signatures and future content
 * addressing. Array order is preserved because it can encode meaningful legacy
 * precedence; object keys are sorted recursively.
 */
export function stableJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return current;
  };
  return JSON.stringify(normalize(value), null, 2);
}

export function serializeRecipe(recipe: AnalysisRecipeV1): string {
  return stableJson(recipe);
}

export function parseRecipe(json: string): AnalysisRecipeV1 {
  const parsed = JSON.parse(json) as Partial<AnalysisRecipeV1>;
  if (parsed.schema !== 'tabwin-web.recipe' || parsed.version !== 1 || !parsed.spec ||
      !Array.isArray(parsed.conversions) || !Array.isArray(parsed.sourceHints)) {
    throw new Error('unsupported or invalid TabWin Web recipe');
  }
  compileQueryPlan(parsed.spec);
  for (const conversion of parsed.conversions) {
    if (!conversion || typeof conversion.id !== 'string' || typeof conversion.name !== 'string' ||
        typeof conversion.sha256 !== 'string' || typeof conversion.size !== 'number') {
      throw new Error('invalid conversion fingerprint in TabWin Web recipe');
    }
  }
  for (const source of parsed.sourceHints) {
    if (!source || typeof source.name !== 'string' || typeof source.sha256 !== 'string' ||
        typeof source.size !== 'number') {
      throw new Error('invalid source fingerprint in TabWin Web recipe');
    }
  }
  const allowedChartTypes = new Set(['horizontal-bar', 'vertical-bar', 'line', 'area', 'pie', 'points', 'bubbles', 'arrows']);
  if (parsed.view?.chartType && !allowedChartTypes.has(parsed.view.chartType)) {
    throw new Error('invalid chart type in TabWin Web recipe');
  }
  const allowedMapClassifications = new Set(['continuous', 'equal-interval', 'quantile']);
  if (parsed.view?.mapClassification && !allowedMapClassifications.has(parsed.view.mapClassification)) {
    throw new Error('invalid map classification in TabWin Web recipe');
  }
  if (parsed.view?.mapClassCount !== undefined
    && (!Number.isInteger(parsed.view.mapClassCount) || parsed.view.mapClassCount < 2 || parsed.view.mapClassCount > 9)) {
    throw new Error('invalid map class count in TabWin Web recipe');
  }
  const allowedMapPalettes = new Set(['green', 'blue', 'orange', 'purple']);
  if (parsed.view?.mapPalette && !allowedMapPalettes.has(parsed.view.mapPalette)) {
    throw new Error('invalid map palette in TabWin Web recipe');
  }
  const allowedStatisticsOperations = new Set(['descriptive', 'correlation', 'regression', 'histogram']);
  if (parsed.view?.statisticsOperation && !allowedStatisticsOperations.has(parsed.view.statisticsOperation)) {
    throw new Error('invalid statistics operation in TabWin Web recipe');
  }
  if (parsed.view?.histogramBins !== undefined
    && (!Number.isInteger(parsed.view.histogramBins) || parsed.view.histogramBins < 1 || parsed.view.histogramBins > 50)) {
    throw new Error('invalid histogram bin count in TabWin Web recipe');
  }
  return parsed as AnalysisRecipeV1;
}
