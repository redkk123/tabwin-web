import { validateAxisBounds } from './axis-bounds.js';
import type { QueryPlan, SourceFingerprint, TableOperation, TabulationSpec } from './model.js';
import { compileQueryPlan } from './plan.js';

export interface ConversionFingerprint {
  id: string;
  name: string;
  sha256: string;
  size: number;
}

export interface RecipeSourceHint extends Pick<SourceFingerprint, 'name' | 'sha256' | 'size'> {
  /** Official catalog address when the source was acquired from DATASUS. */
  sourceUrl?: string;
  /** Official catalog modality, such as final or preliminary data. */
  modality?: string;
  /** ISO-8601 time at which the containing official archive was retrieved. */
  retrievedAt?: string;
  /** SHA-256 of the official ZIP envelope, distinct from the extracted source hash. */
  archiveSha256?: string;
}

/**
 * A transform-pipeline step as the recipe carries it.
 *
 * Structural on purpose rather than the analysis package's `TransformStep`
 * union: the recipe contract lives in core, and core must not depend on
 * analysis. It is also honest about when a step can be fully checked - each
 * step is validated against the fields present *at its own point in the
 * pipeline*, which only exists once a dataset is open. `parseRecipe` checks
 * the shape every step must have; applying the pipeline is what checks it
 * against real data, and a step that no longer fits is exactly the schema
 * drift the caller has to report.
 */
export interface RecipeTransformStep {
  id: string;
  kind: string;
  [key: string]: unknown;
}

export interface AnalysisRecipeV1 {
  schema: 'tabwin-web.recipe';
  version: 1;
  name?: string;
  spec: TabulationSpec;
  conversions: ConversionFingerprint[];
  sourceHints: RecipeSourceHint[];
  /**
   * Record-level transformations replayed **before** the tabulation, in array
   * order. They change the data the plan runs over, so a recipe that omitted
   * them would replay `spec` against the untransformed file and produce a
   * different table than the one that was saved - while its source
   * fingerprints still asserted a match.
   */
  transformSteps?: RecipeTransformStep[];
  /** Deterministic post-tabulation transforms, replayed in array order. */
  resultOperations?: TableOperation[];
  view?: {
    chartType?: 'horizontal-bar' | 'vertical-bar' | 'line' | 'area' | 'pie' | 'points' | 'bubbles' | 'arrows';
    chartTitle?: string;
    chartSubtitle?: string;
    chartFontFamily?: 'system' | 'serif' | 'monospace';
    chartPrimaryColor?: string;
    chartAccentColor?: string;
    chartBackgroundColor?: string;
    chartShowLegend?: boolean;
    chartShowValueLabels?: boolean;
    chartDecimalPlaces?: number;
    chartXColumnKey?: string;
    chartYColumnKey?: string;
    chartSizeColumnKey?: string;
    chartSeriesMode?: 'total' | 'columns';
    chartAxisXLabel?: string;
    chartAxisYLabel?: string;
    chartAxisXMin?: number;
    chartAxisXMax?: number;
    chartAxisYMin?: number;
    chartAxisYMax?: number;
    chartAxisTickCount?: number;
    chartShowGrid?: boolean;
    mapClassification?: 'continuous' | 'equal-interval' | 'quantile' | 'manual';
    mapManualBreaks?: number[];
    mapClassCount?: number;
    mapPalette?: 'green' | 'blue' | 'orange' | 'purple';
    /**
     * Rampa lida do escuro para o claro, para indicador em que o alto é bom.
     *
     * Precisa entrar na receita: sem ela, reabrir uma análise de cobertura
     * vacinal devolveria o mapa com as cores trocadas, e a leitura invertida
     * do indicador — que é o erro que a opção existe para evitar.
     */
    mapInvertPalette?: boolean;
    statisticsOperation?: 'descriptive' | 'correlation' | 'regression' | 'histogram' | 'epidemiology';
    statisticsXColumnKey?: string;
    statisticsYColumnKey?: string;
    histogramBins?: number;
    histogramGaussian?: boolean;
    /**
     * Epidemiology settings.
     *
     * The standard-population and reference-rate columns are stored by column
     * **key**, never by index: a recipe reopened against the same source can
     * legitimately produce columns in a different order, and an index would
     * then silently point at the wrong series while the recipe still claimed
     * fidelity to its source.
     */
    epidemiologyMethod?: 'direct' | 'indirect';
    epidemiologyPer?: 1000 | 10000 | 100000;
    epidemiologyStandardColumnKey?: string;
    epidemiologyReferenceColumnKey?: string;
    tableSortColumnKey?: string;
    tableSortDirection?: 'original' | 'ascending' | 'descending';
    tableDecimalPlaces?: number;
    tableKeyVisible?: boolean;
    tableTitle?: string;
    tableSubtitle?: string;
    tableFooter?: string;
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
    if (source.sourceUrl !== undefined && typeof source.sourceUrl !== 'string') {
      throw new Error('invalid source URL in TabWin Web recipe');
    }
    if (source.modality !== undefined && (typeof source.modality !== 'string' || !source.modality.trim())) {
      throw new Error('invalid source modality in TabWin Web recipe');
    }
    if (source.retrievedAt !== undefined
      && (typeof source.retrievedAt !== 'string' || !Number.isFinite(Date.parse(source.retrievedAt)))) {
      throw new Error('invalid retrieval time in TabWin Web recipe');
    }
    if (source.archiveSha256 !== undefined
      && (typeof source.archiveSha256 !== 'string' || !/^[a-f\d]{64}$/i.test(source.archiveSha256))) {
      throw new Error('invalid archive fingerprint in TabWin Web recipe');
    }
  }
  if (parsed.transformSteps !== undefined) {
    if (!Array.isArray(parsed.transformSteps)) throw new Error('invalid transform steps in TabWin Web recipe');
    const stepIds = new Set<string>();
    for (const step of parsed.transformSteps) {
      if (!step || typeof step !== 'object') throw new Error('invalid transform step in TabWin Web recipe');
      if (typeof step.id !== 'string' || !step.id.trim()) throw new Error('transform step has no id in TabWin Web recipe');
      if (typeof step.kind !== 'string' || !step.kind.trim()) throw new Error('transform step has no kind in TabWin Web recipe');
      if (stepIds.has(step.id)) throw new Error(`transform step repeats id ${step.id} in TabWin Web recipe`);
      stepIds.add(step.id);
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
  const allowedChartFonts = new Set(['system', 'serif', 'monospace']);
  if (parsed.view?.chartFontFamily !== undefined && !allowedChartFonts.has(parsed.view.chartFontFamily)) {
    throw new Error('invalid chart font in TabWin Web recipe');
  }
  for (const [name, value, maximum] of [
    ['title', parsed.view?.chartTitle, 160],
    ['subtitle', parsed.view?.chartSubtitle, 240],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.length > maximum)) {
      throw new Error(`invalid chart ${name} in TabWin Web recipe`);
    }
  }
  for (const [name, value] of [
    ['primary color', parsed.view?.chartPrimaryColor],
    ['accent color', parsed.view?.chartAccentColor],
    ['background color', parsed.view?.chartBackgroundColor],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))) {
      throw new Error(`invalid chart ${name} in TabWin Web recipe`);
    }
  }
  if (parsed.view?.chartShowLegend !== undefined && typeof parsed.view.chartShowLegend !== 'boolean') {
    throw new Error('invalid chart legend visibility in TabWin Web recipe');
  }
  if (parsed.view?.chartShowValueLabels !== undefined && typeof parsed.view.chartShowValueLabels !== 'boolean') {
    throw new Error('invalid chart value-label visibility in TabWin Web recipe');
  }
  if (parsed.view?.chartDecimalPlaces !== undefined
    && (!Number.isInteger(parsed.view.chartDecimalPlaces) || parsed.view.chartDecimalPlaces < 0 || parsed.view.chartDecimalPlaces > 6)) {
    throw new Error('invalid chart decimal places in TabWin Web recipe');
  }
  for (const [name, value] of [
    ['x binding', parsed.view?.chartXColumnKey],
    ['y binding', parsed.view?.chartYColumnKey],
    ['size binding', parsed.view?.chartSizeColumnKey],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || !value)) {
      throw new Error(`invalid chart ${name} in TabWin Web recipe`);
    }
  }
  if (parsed.view?.chartSeriesMode !== undefined && !new Set(['total', 'columns']).has(parsed.view.chartSeriesMode)) {
    throw new Error('invalid chart series mode in TabWin Web recipe');
  }
  for (const [name, value, maximum] of [
    ['x axis label', parsed.view?.chartAxisXLabel, 60],
    ['y axis label', parsed.view?.chartAxisYLabel, 40],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.length > maximum)) {
      throw new Error(`invalid chart ${name} in TabWin Web recipe`);
    }
  }
  for (const [name, value] of [
    ['x axis minimum', parsed.view?.chartAxisXMin],
    ['x axis maximum', parsed.view?.chartAxisXMax],
    ['y axis minimum', parsed.view?.chartAxisYMin],
    ['y axis maximum', parsed.view?.chartAxisYMax],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new Error(`invalid chart ${name} in TabWin Web recipe`);
    }
  }
  // An inverted or collapsed pair is rejected here rather than silently
  // dropped at render time: a saved recipe is a claim about what the reader
  // will see, and a bound the renderer refuses to honour is not that.
  for (const [axis, min, max] of [
    ['x', parsed.view?.chartAxisXMin, parsed.view?.chartAxisXMax],
    ['y', parsed.view?.chartAxisYMin, parsed.view?.chartAxisYMax],
  ] as const) {
    // A lone bound (min without max, or vice versa) is allowed here - only an
    // ordered, complete pair is required. That is deliberately looser than
    // what the renderer treats as usable, and validateAxisBounds' 'none' and
    // 'incomplete' cases both fall through fine; only 'inverted' rejects.
    if (validateAxisBounds(min, max).kind === 'inverted') {
      throw new Error(`chart ${axis} axis maximum must exceed its minimum in TabWin Web recipe`);
    }
  }
  if (parsed.view?.chartAxisTickCount !== undefined
    && (!Number.isInteger(parsed.view.chartAxisTickCount) || parsed.view.chartAxisTickCount < 2 || parsed.view.chartAxisTickCount > 20)) {
    throw new Error('invalid chart tick count in TabWin Web recipe');
  }
  if (parsed.view?.chartShowGrid !== undefined && typeof parsed.view.chartShowGrid !== 'boolean') {
    throw new Error('invalid chart grid visibility in TabWin Web recipe');
  }
  const allowedMapClassifications = new Set(['continuous', 'equal-interval', 'quantile', 'manual']);
  if (parsed.view?.mapClassification && !allowedMapClassifications.has(parsed.view.mapClassification)) {
    throw new Error('invalid map classification in TabWin Web recipe');
  }
  if (parsed.view?.mapClassCount !== undefined
    && (!Number.isInteger(parsed.view.mapClassCount) || parsed.view.mapClassCount < 2 || parsed.view.mapClassCount > 9)) {
    throw new Error('invalid map class count in TabWin Web recipe');
  }
  if (parsed.view?.mapClassification === 'manual'
    && (!parsed.view.mapManualBreaks || parsed.view.mapManualBreaks.length === 0)) {
    throw new Error('manual map classification requires breaks in TabWin Web recipe');
  }
  if (parsed.view?.mapManualBreaks !== undefined) {
    if (!Array.isArray(parsed.view.mapManualBreaks) || parsed.view.mapManualBreaks.length > 8
      || parsed.view.mapManualBreaks.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('invalid manual map breaks in TabWin Web recipe');
    }
    for (let index = 1; index < parsed.view.mapManualBreaks.length; index++) {
      if (parsed.view.mapManualBreaks[index]! <= parsed.view.mapManualBreaks[index - 1]!) {
        throw new Error('manual map breaks must be strictly increasing in TabWin Web recipe');
      }
    }
  }
  const allowedMapPalettes = new Set(['green', 'blue', 'orange', 'purple']);
  if (parsed.view?.mapPalette && !allowedMapPalettes.has(parsed.view.mapPalette)) {
    throw new Error('invalid map palette in TabWin Web recipe');
  }
  const allowedStatisticsOperations = new Set(['descriptive', 'correlation', 'regression', 'histogram', 'epidemiology']);
  if (parsed.view?.statisticsOperation && !allowedStatisticsOperations.has(parsed.view.statisticsOperation)) {
    throw new Error('invalid statistics operation in TabWin Web recipe');
  }
  if (parsed.view?.histogramBins !== undefined
    && (!Number.isInteger(parsed.view.histogramBins) || parsed.view.histogramBins < 1 || parsed.view.histogramBins > 50)) {
    throw new Error('invalid histogram bin count in TabWin Web recipe');
  }
  if (parsed.view?.histogramGaussian !== undefined && typeof parsed.view.histogramGaussian !== 'boolean') {
    throw new Error('invalid histogram gaussian flag in TabWin Web recipe');
  }
  if (parsed.view?.epidemiologyMethod !== undefined
    && !new Set(['direct', 'indirect']).has(parsed.view.epidemiologyMethod)) {
    throw new Error('invalid epidemiology method in TabWin Web recipe');
  }
  if (parsed.view?.epidemiologyPer !== undefined
    && !new Set([1000, 10000, 100000]).has(parsed.view.epidemiologyPer)) {
    throw new Error('invalid epidemiology rate scale in TabWin Web recipe');
  }
  for (const key of ['epidemiologyStandardColumnKey', 'epidemiologyReferenceColumnKey'] as const) {
    if (parsed.view?.[key] !== undefined
      && (typeof parsed.view[key] !== 'string' || !parsed.view[key].trim())) {
      throw new Error(`invalid ${key} in TabWin Web recipe`);
    }
  }
  if (parsed.view?.tableSortColumnKey !== undefined && typeof parsed.view.tableSortColumnKey !== 'string') {
    throw new Error('invalid table sort column in TabWin Web recipe');
  }
  if (parsed.view?.tableSortDirection !== undefined
    && !new Set(['original', 'ascending', 'descending']).has(parsed.view.tableSortDirection)) {
    throw new Error('invalid table sort direction in TabWin Web recipe');
  }
  if (parsed.view?.tableDecimalPlaces !== undefined
    && (!Number.isInteger(parsed.view.tableDecimalPlaces) || parsed.view.tableDecimalPlaces < -1 || parsed.view.tableDecimalPlaces > 6)) {
    throw new Error('invalid table decimal places in TabWin Web recipe');
  }
  if (parsed.view?.tableKeyVisible !== undefined && typeof parsed.view.tableKeyVisible !== 'boolean') {
    throw new Error('invalid table key visibility in TabWin Web recipe');
  }
  for (const [name, value, maximum] of [
    ['title', parsed.view?.tableTitle, 160],
    ['subtitle', parsed.view?.tableSubtitle, 240],
    ['footer', parsed.view?.tableFooter, 240],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.length > maximum)) {
      throw new Error(`invalid table ${name} in TabWin Web recipe`);
    }
  }
  return parsed as AnalysisRecipeV1;
}

export function validateTableOperation(value: unknown): asserts value is TableOperation {
  if (!value || typeof value !== 'object') throw new Error('invalid table operation in TabWin Web recipe');
  const operation = value as Partial<TableOperation> & Record<string, unknown> & { output?: Record<string, unknown> };
  const stringField = (key: string): boolean => typeof operation[key] === 'string' && String(operation[key]).length > 0;
  const allowedKinds = new Set(['binary', 'factor', 'cumulative', 'absolute', 'integer', 'sequence', 'constant', 'expression',
    'rename-column', 'move-column', 'delete-column', 'transpose', 'include-table', 'suppress-rows', 'aggregate-rows']);
  if (!operation.kind || !allowedKinds.has(operation.kind)) {
    throw new Error('invalid table operation in TabWin Web recipe');
  }
  if (operation.kind === 'transpose') return;
  if (operation.kind === 'include-table') {
    const rows = operation.rows as Array<Record<string, unknown>> | undefined;
    const columns = operation.columns as Array<Record<string, unknown>> | undefined;
    const cells = operation.cells as unknown[][] | undefined;
    if (!stringField('sourceLabel') || String(operation.sourceLabel).length > 160
      || typeof operation.requireMatchingLabels !== 'boolean'
      || !Array.isArray(rows) || !Array.isArray(columns) || !Array.isArray(cells)
      || rows.length !== cells.length || columns.length === 0
      || rows.length > 100_000 || columns.length > 10_000 || rows.length * columns.length > 5_000_000
      || rows.some((row) => !row || typeof row.key !== 'string' || !row.key || typeof row.label !== 'string')
      || columns.some((column) => !column || typeof column.key !== 'string' || !column.key
        || typeof column.label !== 'string' || !column.label
        || !new Set(['raw', 'conversion', 'derived']).has(String(column.source))
        || (column.subtotalTargetKey !== undefined && typeof column.subtotalTargetKey !== 'string')
        || (column.excludeFromTotal !== undefined && typeof column.excludeFromTotal !== 'boolean')
        || (column.totalPolicy !== undefined && !new Set([
          'none', 'sum', 'product', 'mean', 'initial', 'final', 'min', 'max', 'precalculated',
        ]).has(String(column.totalPolicy))))
      || cells.some((row) => !Array.isArray(row) || row.length !== columns.length
        || row.some((cell) => typeof cell !== 'number' || !Number.isFinite(cell)))) {
      throw new Error('invalid include-table operation in TabWin Web recipe');
    }
    if (new Set(rows.map((row) => row.key)).size !== rows.length
      || new Set(columns.map((column) => column.key)).size !== columns.length) {
      throw new Error('duplicate key in include-table operation in TabWin Web recipe');
    }
    return;
  }
  if (operation.kind === 'rename-column') {
    if (!stringField('columnKey') || !stringField('label')) throw new Error('invalid rename-column operation in TabWin Web recipe');
    return;
  }
  if (operation.kind === 'move-column') {
    if (!stringField('columnKey') || !new Set(['left', 'right']).has(String(operation.direction))) throw new Error('invalid move-column operation in TabWin Web recipe');
    return;
  }
  if (operation.kind === 'delete-column') {
    if (!stringField('columnKey')) throw new Error('invalid delete-column operation in TabWin Web recipe');
    return;
  }
  if (operation.kind === 'suppress-rows') {
    if (!Array.isArray(operation.rowKeys) || !operation.rowKeys.length || !operation.rowKeys.every((key) => typeof key === 'string')) {
      throw new Error('invalid suppress-rows operation in TabWin Web recipe');
    }
    return;
  }
  if (operation.kind === 'aggregate-rows') {
    const outputRow = operation.outputRow as Record<string, unknown> | undefined;
    if (!Array.isArray(operation.rowKeys) || !operation.rowKeys.length || !operation.rowKeys.every((key) => typeof key === 'string')
      || !outputRow || typeof outputRow.key !== 'string' || !outputRow.key || typeof outputRow.label !== 'string' || !outputRow.label
      || typeof outputRow.excludeFromTotal !== 'boolean' || typeof operation.removeSources !== 'boolean') {
      throw new Error('invalid aggregate-rows operation in TabWin Web recipe');
    }
    return;
  }
  if (!operation.output
    || typeof operation.output.key !== 'string' || !operation.output.key.trim()
    || typeof operation.output.label !== 'string' || !operation.output.label.trim()
    || !new Set(['none', 'sum', 'product', 'mean', 'initial', 'final', 'min', 'max']).has(String(operation.output.totalPolicy))) {
    throw new Error('invalid table operation in TabWin Web recipe');
  }
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
  } else if (operation.kind === 'constant' && !finiteField('value')) {
    throw new Error('invalid constant operation in TabWin Web recipe');
  } else if (operation.kind === 'expression'
    && (!stringField('expression') || !new Set(['error', 'zero']).has(String(operation.divisionByZero)))) {
    throw new Error('invalid expression operation in TabWin Web recipe');
  }
}
