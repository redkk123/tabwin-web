import type { QueryPlan, SourceFingerprint, TableOperation, TabulationSpec } from './model.js';
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
  /** Deterministic post-tabulation transforms, replayed in array order. */
  resultOperations?: TableOperation[];
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
  if (parsed.resultOperations !== undefined) {
    if (!Array.isArray(parsed.resultOperations)) throw new Error('invalid result operations in TabWin Web recipe');
    for (const operation of parsed.resultOperations) validateTableOperation(operation);
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

function validateTableOperation(value: unknown): asserts value is TableOperation {
  if (!value || typeof value !== 'object') throw new Error('invalid table operation in TabWin Web recipe');
  const operation = value as Partial<TableOperation> & Record<string, unknown> & { output?: Record<string, unknown> };
  const allowedKinds = new Set(['binary', 'factor', 'cumulative', 'absolute', 'integer', 'sequence', 'constant']);
  if (!operation.kind || !allowedKinds.has(operation.kind) || !operation.output
    || typeof operation.output.key !== 'string' || !operation.output.key.trim()
    || typeof operation.output.label !== 'string' || !operation.output.label.trim()
    || !new Set(['none', 'sum', 'product', 'mean', 'initial', 'final', 'min', 'max']).has(String(operation.output.totalPolicy))) {
    throw new Error('invalid table operation in TabWin Web recipe');
  }
  const stringField = (key: string): boolean => typeof operation[key] === 'string' && String(operation[key]).length > 0;
  const finiteField = (key: string): boolean => typeof operation[key] === 'number' && Number.isFinite(operation[key]);
  if (operation.kind === 'binary') {
    if (!new Set(['add', 'subtract', 'multiply', 'divide', 'minimum', 'maximum', 'percentage']).has(String(operation.operator))
      || !stringField('leftColumnKey') || !stringField('rightColumnKey')
      || !new Set(['error', 'zero']).has(String(operation.divisionByZero))) {
      throw new Error('invalid binary table operation in TabWin Web recipe');
    }
  } else if (operation.kind === 'factor') {
    if (!stringField('sourceColumnKey') || !finiteField('factor')) throw new Error('invalid factor operation in TabWin Web recipe');
  } else if (operation.kind === 'cumulative' || operation.kind === 'absolute') {
    if (!stringField('sourceColumnKey')) throw new Error('invalid unary table operation in TabWin Web recipe');
  } else if (operation.kind === 'integer') {
    if (!stringField('sourceColumnKey') || !new Set(['truncate', 'round', 'floor', 'ceil']).has(String(operation.rounding))) {
      throw new Error('invalid integer operation in TabWin Web recipe');
    }
  } else if (operation.kind === 'sequence') {
    if (!finiteField('start') || !finiteField('step')) throw new Error('invalid sequence operation in TabWin Web recipe');
  } else if (!finiteField('value')) {
    throw new Error('invalid constant operation in TabWin Web recipe');
  }
}
