import {
  readDbfHeader,
  type DbfField,
  type DbfHeader,
  type DbfRecord,
} from '@precisa-saude/datasus-dbc';
import {
  compileQueryPlan,
  parsePortableTable,
  parseRecipe,
  serializePortableTable,
  serializeRecipe,
  type AnalysisRecipeV1,
  type FilterSpec,
  type QueryPlan,
  type PortableTableV1,
  type TableOperation,
  type TabulationResult,
  type TotalPolicy,
} from '../../../packages/core/src/index.ts';
import {
  optionsForRole,
  parseCnv,
  parseDelimited,
  parseDef,
  parseTabwinMap,
  type CnvDefinition,
  type DefDefinition,
  type MapCoordinate,
  type TabwinMapDefinition,
  type TabwinMapObject,
} from '../../../packages/formats/src/index.ts';
import {
  DATASUS_SYSTEMS,
  catalogCapabilities,
  compareSourceManifests,
  createSourceManifest,
  expandDatasusSearchSelection,
  fileTypesForSystem,
  parseSourceManifest,
  serializeSourceManifest,
  systemIsAnnual,
  verifiedAuxiliaryBundleName,
  type DatasusAvailabilityManifest,
  type DatasusRemoteFile,
  type DatasusSearchQuery,
} from '../../../packages/acquisition/src/datasus.ts';
import { tabulationToCsv, tabulationToXml } from '../../../packages/export/src/tabulation.ts';
import { tabulationToXlsx } from '../../../packages/export/src/xlsx.ts';
import { extractSourceDbf } from '../../../packages/export/src/dbf-source.ts';
import {
  chooseVerifiedAuxiliaryBundle,
  extractSupportedArchiveFiles,
  fetchOfficialArchive,
  prepareOfficialDownload,
  searchOfficialAuxiliaries,
  searchOfficialCatalogBatch,
  searchOfficialFiles,
  suggestedDefinitionName,
  type ExtractedArchiveFile,
} from './datasus-client.ts';
import {
  clearCachedArchives,
  deleteCachedArchive,
  listCachedArchives,
  readCachedArchive,
  writeCachedArchive,
  type CachedArchiveRole,
  type CachedArchiveSummary,
} from './archive-cache.ts';
import { renderChartSvg } from './chart-renderer.ts';
import type { ChartType } from '../../../packages/visualization/src/chart-model.ts';
import {
  createMapScale,
  type MapClassification,
  type MapPalette,
} from '../../../packages/visualization/src/map-scale.ts';
import {
  descriptiveStatistics,
  histogram,
  pearsonCorrelation,
  simpleLinearRegression,
} from '../../../packages/analysis/src/statistics.ts';
import type { NumericFieldProfile } from '../../../packages/analysis/src/data-quality.ts';
import {
  applyTableOperation,
  calculateColumnTotal,
  createIncludeTableOperation,
  replayTableOperations,
} from '../../../packages/analysis/src/table-operations.ts';
import { tableRowIndexes, tableRowsToTsv } from '../../../packages/analysis/src/table-presentation.ts';
import './styles.css';

type ViewName = 'table' | 'chart' | 'map' | 'statistics' | 'audit';

interface LoadedSource {
  name: string;
  extension: string;
  size: number;
  sha256: string;
  origin?: string;
  retrievedAt?: string;
  archiveSha256?: string;
  cacheKey?: string;
  /** Explicit catalog selection for an acquired official data source. */
  catalogQuery?: DatasusSearchQuery | undefined;
}

interface OfficialArchiveProvenance {
  cacheKey: string;
  cacheHit: boolean;
  retrievedAt: string;
  archiveSha256: string;
}

interface DownloadedArchive {
  files: ExtractedArchiveFile[];
  provenance: OfficialArchiveProvenance;
}

type OpenOfficialFileResult = { ok: true } | { ok: false; error: string };

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const integerFormat = new Intl.NumberFormat('pt-BR');
const textDecoder = new TextDecoder('windows-1252');

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing UI element: ${selector}`);
  return found;
}

const fileInput = element<HTMLInputElement>('#file-input');
const dropZone = element<HTMLElement>('#drop-zone');
const fileList = element<HTMLElement>('#file-list');
const sourceDbfButton = element<HTMLButtonElement>('#source-dbf-button');
const selectedDbfButton = element<HTMLButtonElement>('#selected-dbf-button');
const decodeCancelButton = element<HTMLButtonElement>('#decode-cancel-button');
const combineCompatibleFiles = element<HTMLInputElement>('#combine-compatible-files');
const form = element<HTMLFormElement>('#analysis-form');
const fieldSearch = element<HTMLInputElement>('#field-search');
const rowField = element<HTMLSelectElement>('#row-field');
const columnField = element<HTMLSelectElement>('#column-field');
const rowConversion = element<HTMLSelectElement>('#row-conversion');
const columnConversion = element<HTMLSelectElement>('#column-conversion');
const measureKind = element<HTMLSelectElement>('#measure-kind');
const measureField = element<HTMLSelectElement>('#measure-field');
const measureFieldLabel = element<HTMLElement>('#measure-field-label');
const filterField = element<HTMLSelectElement>('#filter-field');
const filterMode = element<HTMLSelectElement>('#filter-mode');
const filterKind = element<HTMLSelectElement>('#filter-kind');
const filterValueSearch = element<HTMLInputElement>('#filter-value-search');
const filterValues = element<HTMLElement>('#filter-values');
const filterRange = element<HTMLElement>('#filter-range');
const filterMinimum = element<HTMLInputElement>('#filter-minimum');
const filterMaximum = element<HTMLInputElement>('#filter-maximum');
const filterIncludeMinimum = element<HTMLInputElement>('#filter-include-minimum');
const filterIncludeMaximum = element<HTMLInputElement>('#filter-include-maximum');
const filterInfo = element<HTMLElement>('#filter-info');
const filterCount = element<HTMLElement>('#filter-count');
const clearFilterButton = element<HTMLButtonElement>('#clear-filter-button');
const selectAllFilterButton = element<HTMLButtonElement>('#select-all-filter-button');
const addFilterButton = element<HTMLButtonElement>('#add-filter-button');
const activeFilterList = element<HTMLElement>('#active-filter-list');
const qualityField = element<HTMLSelectElement>('#quality-field');
const qualitySummary = element<HTMLElement>('#quality-summary');
const qualityMinimum = element<HTMLInputElement>('#quality-minimum');
const qualityMaximum = element<HTMLInputElement>('#quality-maximum');
const qualitySuggestButton = element<HTMLButtonElement>('#quality-suggest-button');
const qualityApplyButton = element<HTMLButtonElement>('#quality-apply-button');
const openRecipeButton = element<HTMLButtonElement>('#open-recipe-button');
const saveRecipeButton = element<HTMLButtonElement>('#save-recipe-button');
const recipeInput = element<HTMLInputElement>('#recipe-input');
const openTableButton = element<HTMLButtonElement>('#open-table-button');
const includeTableButton = element<HTMLButtonElement>('#include-table-button');
const saveTableButton = element<HTMLButtonElement>('#save-table-button');
const tableInput = element<HTMLInputElement>('#table-input');
const includeTableInput = element<HTMLInputElement>('#include-table-input');
const startPosition = element<HTMLInputElement>('#start-position');
const columnStartPosition = element<HTMLInputElement>('#column-start-position');
const suppressZero = element<HTMLInputElement>('#suppress-zero');
const suppressZeroColumns = element<HTMLInputElement>('#suppress-zero-columns');
const discriminateUnclassified = element<HTMLInputElement>('#discriminate-unclassified');
const discriminateColumnUnclassified = element<HTMLInputElement>('#discriminate-column-unclassified');
const runButton = element<HTMLButtonElement>('#run-button');
const exportCsvButton = element<HTMLButtonElement>('#export-csv-button');
const exportXlsxButton = element<HTMLButtonElement>('#export-xlsx-button');
const exportXmlButton = element<HTMLButtonElement>('#export-xml-button');
const chartPngButton = element<HTMLButtonElement>('#chart-png-button');
const chartSvgButton = element<HTMLButtonElement>('#chart-svg-button');
const chartType = element<HTMLSelectElement>('#chart-type');
const mapPngButton = element<HTMLButtonElement>('#map-png-button');
const mapClassification = element<HTMLSelectElement>('#map-classification');
const mapClassCount = element<HTMLSelectElement>('#map-class-count');
const mapPalette = element<HTMLSelectElement>('#map-palette');
const mapZoomOut = element<HTMLButtonElement>('#map-zoom-out');
const mapZoomReset = element<HTMLButtonElement>('#map-zoom-reset');
const mapZoomIn = element<HTMLButtonElement>('#map-zoom-in');
const resultKicker = element<HTMLElement>('#result-kicker');
const resultTitle = element<HTMLElement>('#result-title');
const datasetStats = element<HTMLElement>('#dataset-stats');
const emptyState = element<HTMLElement>('#empty-state');
const tableWrap = element<HTMLElement>('#table-wrap');
const resultTable = element<HTMLTableElement>('#result-table');
const tableOperationsPanel = element<HTMLElement>('#table-operations');
const tableOperationKind = element<HTMLSelectElement>('#table-operation-kind');
const tableOperationLeft = element<HTMLSelectElement>('#table-operation-left');
const tableOperationRight = element<HTMLSelectElement>('#table-operation-right');
const tableOperationLeftLabel = element<HTMLElement>('#table-operation-left-label');
const tableOperationRightLabel = element<HTMLElement>('#table-operation-right-label');
const tableOperationNumberLabel = element<HTMLElement>('#table-operation-number-label');
const tableOperationNumber = element<HTMLInputElement>('#table-operation-number');
const tableOperationExpressionLabel = element<HTMLElement>('#table-operation-expression-label');
const tableOperationExpression = element<HTMLInputElement>('#table-operation-expression');
const tableOperationZeroLabel = element<HTMLElement>('#table-operation-zero-label');
const tableOperationZero = element<HTMLSelectElement>('#table-operation-zero');
const tableOperationLabel = element<HTMLInputElement>('#table-operation-label');
const tableOperationTotal = element<HTMLSelectElement>('#table-operation-total');
const tableOperationApply = element<HTMLButtonElement>('#table-operation-apply');
const tableOperationUndo = element<HTMLButtonElement>('#table-operation-undo');
const tableOperationReset = element<HTMLButtonElement>('#table-operation-reset');
const tableOperationHistory = element<HTMLOListElement>('#table-operation-history');
const tablePresentation = element<HTMLElement>('#table-presentation');
const tableTitle = element<HTMLInputElement>('#table-title');
const tableSubtitle = element<HTMLInputElement>('#table-subtitle');
const tableFooter = element<HTMLInputElement>('#table-footer');
const tableLocate = element<HTMLInputElement>('#table-locate');
const tableSortColumn = element<HTMLSelectElement>('#table-sort-column');
const tableSortDirection = element<HTMLSelectElement>('#table-sort-direction');
const tableDecimals = element<HTMLSelectElement>('#table-decimals');
const tableKeyVisible = element<HTMLInputElement>('#table-key-visible');
const tableCopy = element<HTMLButtonElement>('#table-copy');
const tablePrint = element<HTMLButtonElement>('#table-print');
const tableEditing = element<HTMLElement>('#table-editing');
const tableEditColumn = element<HTMLSelectElement>('#table-edit-column');
const tableEditColumnLabel = element<HTMLInputElement>('#table-edit-column-label');
const tableColumnRename = element<HTMLButtonElement>('#table-column-rename');
const tableColumnLeft = element<HTMLButtonElement>('#table-column-left');
const tableColumnRight = element<HTMLButtonElement>('#table-column-right');
const tableColumnDelete = element<HTMLButtonElement>('#table-column-delete');
const tableAggregateLabel = element<HTMLInputElement>('#table-aggregate-label');
const tableAggregateRemove = element<HTMLInputElement>('#table-aggregate-remove');
const tableTranspose = element<HTMLButtonElement>('#table-transpose');
const tableRowAggregate = element<HTMLButtonElement>('#table-row-aggregate');
const tableRowSuppress = element<HTMLButtonElement>('#table-row-suppress');
const chart = element<HTMLElement>('#chart');
const auditOutput = element<HTMLElement>('#audit-output');
const mapCanvas = element<HTMLCanvasElement>('#map-canvas');
const mapMessage = element<HTMLElement>('#map-message');
const mapLegend = element<HTMLElement>('#map-legend');
const mapTooltip = element<HTMLOutputElement>('#map-tooltip');
const statisticsOperation = element<HTMLSelectElement>('#statistics-operation');
const statisticsX = element<HTMLSelectElement>('#statistics-x');
const statisticsY = element<HTMLSelectElement>('#statistics-y');
const statisticsYLabel = element<HTMLElement>('#statistics-y-label');
const histogramBinsLabel = element<HTMLElement>('#histogram-bins-label');
const histogramBins = element<HTMLInputElement>('#histogram-bins');
const statisticsResult = element<HTMLElement>('#statistics-result');
const toast = element<HTMLElement>('#toast');
const aboutDialog = element<HTMLDialogElement>('#about-dialog');
const catalogDialog = element<HTMLDialogElement>('#catalog-dialog');
const catalogForm = element<HTMLFormElement>('#catalog-form');
const catalogSystem = element<HTMLSelectElement>('#catalog-system');
const catalogFileType = element<HTMLSelectElement>('#catalog-file-type');
const catalogYear = element<HTMLSelectElement>('#catalog-year');
const catalogMonth = element<HTMLSelectElement>('#catalog-month');
const catalogUf = element<HTMLSelectElement>('#catalog-uf');
const catalogMonthLabel = element<HTMLElement>('#catalog-month-label');
const catalogUfLabel = element<HTMLElement>('#catalog-uf-label');
const catalogCapabilitiesOutput = element<HTMLElement>('#catalog-capabilities');
const catalogAuxiliary = element<HTMLInputElement>('#catalog-auxiliary');
const catalogSearchButton = element<HTMLButtonElement>('#catalog-search-button');
const catalogCancelButton = element<HTMLButtonElement>('#catalog-cancel-button');
const catalogStatus = element<HTMLElement>('#catalog-status');
const catalogResults = element<HTMLElement>('#catalog-results');
const catalogAuxiliaryPicker = element<HTMLElement>('#catalog-auxiliary-picker');
const catalogAuxiliaryResults = element<HTMLElement>('#catalog-auxiliary-results');
const catalogRecentSummary = element<HTMLElement>('#catalog-recent-summary');
const catalogRecentList = element<HTMLElement>('#catalog-recent-list');
const catalogCacheClear = element<HTMLButtonElement>('#catalog-cache-clear');

let dbfHeader: DbfHeader | null = null;
let currentDatasetFile: File | null = null;
let currentCompatibilityProfile: 'tabwin-4.15' | 'modern' = 'tabwin-4.15';
let datasetName = '';
let datasetFingerprint: LoadedSource | null = null;
let activeDef: DefDefinition | null = null;
let activeMap: TabwinMapDefinition | null = null;
let activeMapSource = '';
let mapNameByGeocode = new Map<string, string>();
let currentPlan: QueryPlan | null = null;
let baseResult: TabulationResult | null = null;
let currentResult: TabulationResult | null = null;
let tableOperations: TableOperation[] = [];
let currentRowLabel = '';
let currentView: ViewName = 'table';
let toastTimer = 0;
const cnvByName = new Map<string, CnvDefinition>();
const loadedSources: LoadedSource[] = [];
const activeDatasetSources: LoadedSource[] = [];
let activeFilterConversion = '';
let activeFilterStartPosition: number | undefined;
let configuredFilters: FilterSpec[] = [];
let mapZoom = 1;
let mapPanX = 0;
let mapPanY = 0;
let mapProjection: { west: number; north: number; fit: number; offsetX: number; offsetY: number } | null = null;
let lastMapValues = new Map<TabwinMapObject, number | undefined>();
let mapDrag: { pointerId: number; x: number; y: number } | null = null;
let activeCatalogController: AbortController | null = null;
let activeDecode: { cancel: () => void } | null = null;
const MAX_LOCAL_INPUT_BYTES = 512 * 1024 * 1024;

function showToast(message: string, isError = false): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3600);
}

function extensionOf(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? '').toUpperCase() : '';
}

function baseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? path.toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function rememberSource(source: LoadedSource): void {
  const existing = loadedSources.findIndex((item) => item.name.toLowerCase() === source.name.toLowerCase());
  if (existing >= 0) loadedSources.splice(existing, 1, source);
  else loadedSources.push(source);
  renderFileList();
}

function renderFileList(): void {
  fileList.replaceChildren();
  const visible = loadedSources.slice(-8);
  for (const source of visible) {
    const chip = document.createElement('div');
    chip.className = 'file-chip ok';
    const name = document.createElement('b');
    name.textContent = source.name;
    const meta = document.createElement('span');
    meta.textContent = `${source.extension} · ${formatBytes(source.size)}`;
    chip.append(name, meta);
    fileList.append(chip);
  }
  if (loadedSources.length > visible.length) {
    const summary = document.createElement('div');
    summary.className = 'file-chip';
    summary.textContent = `+ ${integerFormat.format(loadedSources.length - visible.length)} auxiliares carregados`;
    fileList.prepend(summary);
  }
}

function setBusy(message: string): void {
  resultKicker.textContent = 'Processando localmente';
  resultTitle.textContent = message;
  runButton.disabled = true;
}

function updateColumnControls(): void {
  const enabled = Boolean(dbfHeader && columnField.value);
  columnConversion.disabled = !enabled;
  columnStartPosition.disabled = !enabled;
  discriminateColumnUnclassified.disabled = !enabled;
}

function setControlsEnabled(enabled: boolean): void {
  for (const control of [fieldSearch, rowField, columnField, rowConversion, columnConversion, measureKind, measureField, filterField, filterMode,
    filterKind, filterValueSearch, filterMinimum, filterMaximum, filterIncludeMinimum, filterIncludeMaximum, startPosition, columnStartPosition,
    qualityField, qualityMinimum, qualityMaximum, suppressZero, suppressZeroColumns, discriminateUnclassified,
    discriminateColumnUnclassified, runButton]) {
    control.disabled = !enabled;
  }
  if (enabled) updateMeasureControls();
  updateColumnControls();
  clearFilterButton.disabled = !enabled || !filterField.value;
  selectAllFilterButton.disabled = !enabled || !filterField.value || filterKind.value === 'numeric-range';
  if (!enabled) addFilterButton.disabled = true;
  if (!enabled) {
    qualitySuggestButton.disabled = true;
    qualityApplyButton.disabled = true;
  }
}

function fieldLabel(fieldName: string, role: 'row' | 'column' = 'row'): string {
  if (!activeDef) return fieldName;
  const match = activeDef.options.find((option) =>
    option.field.toUpperCase() === fieldName.toUpperCase() && option.roles.includes(role));
  return match ? `${match.label} · ${fieldName}` : fieldName;
}

function activeRowLabel(): string {
  return currentRowLabel || fieldLabel(rowField.value) || currentPlan?.spec.rows.field || 'Linha';
}

function incrementLabel(fieldName: string): string {
  const increment = activeDef?.increments.find((item) => item.field.toUpperCase() === fieldName.toUpperCase());
  return increment ? `${increment.label} · ${fieldName}` : fieldName;
}

function selectionLabel(fieldName: string): string {
  const option = activeDef?.options.find((item) =>
    item.field.toUpperCase() === fieldName.toUpperCase() && item.roles.includes('selection'));
  return option ? `${option.label} · ${fieldName}` : fieldName;
}

function chooseDefaultField(fields: DbfHeader['fields']): string {
  const names = new Set(fields.map((field) => field.name.toUpperCase()));
  for (const preferred of ['MUNIC_RES', 'MUNIC_MOV', 'MUNICIPIO', 'UF_ZI', 'SEXO']) {
    if (names.has(preferred)) return preferred;
  }
  return fields.find((field) => field.type === 'C')?.name ?? fields[0]?.name ?? '';
}

function populateControls(preferredField?: string): void {
  if (!dbfHeader) return;
  fieldSearch.value = '';
  const previousRow = preferredField ?? rowField.value;
  const previousColumn = columnField.value;
  rowField.replaceChildren();
  columnField.replaceChildren(new Option('Sem colunas', ''));

  for (const field of dbfHeader.fields) {
    rowField.add(new Option(fieldLabel(field.name, 'row'), field.name));
    columnField.add(new Option(fieldLabel(field.name, 'column'), field.name));
  }
  const available = new Set(dbfHeader.fields.map((field) => field.name));
  rowField.value = available.has(previousRow) ? previousRow : chooseDefaultField(dbfHeader.fields);
  columnField.value = available.has(previousColumn) ? previousColumn : '';
  populateMeasureFields();
  populateFilterFields();
  populateQualityFields();
  populateConversions();
  setControlsEnabled(true);
}

function searchDimensionFields(): void {
  if (!dbfHeader) return;
  const previousRow = rowField.value;
  const previousColumn = columnField.value;
  const query = normalizeLabel(fieldSearch.value);
  const matches = dbfHeader.fields.filter((field) => {
    if (field.name === previousRow || field.name === previousColumn) return true;
    const searchable = `${field.name} ${fieldLabel(field.name, 'row')} ${fieldLabel(field.name, 'column')}`;
    return normalizeLabel(searchable).includes(query);
  });
  rowField.replaceChildren();
  columnField.replaceChildren(new Option('Sem colunas', ''));
  for (const field of matches) {
    rowField.add(new Option(fieldLabel(field.name, 'row'), field.name));
    columnField.add(new Option(fieldLabel(field.name, 'column'), field.name));
  }
  rowField.value = matches.some((field) => field.name === previousRow)
    ? previousRow
    : matches[0]?.name ?? '';
  columnField.value = matches.some((field) => field.name === previousColumn)
    ? previousColumn
    : '';
  updateColumnControls();
}

function populateMeasureFields(): void {
  if (!dbfHeader) return;
  const previous = measureField.value;
  measureField.replaceChildren();
  const incrementNames = new Set(activeDef?.increments.map((item) => item.field.toUpperCase()) ?? []);
  const numericTypes = new Set(['N', 'F', 'I', 'B', 'Y']);
  const candidates = dbfHeader.fields.filter((field) =>
    numericTypes.has(field.type) || incrementNames.has(field.name.toUpperCase()));
  for (const field of candidates) measureField.add(new Option(incrementLabel(field.name), field.name));
  if (candidates.some((field) => field.name === previous)) measureField.value = previous;
  const sumOption = measureKind.querySelector<HTMLOptionElement>('option[value="sum"]');
  if (sumOption) sumOption.disabled = candidates.length === 0;
  if (!candidates.length) measureKind.value = 'count';
  updateMeasureControls();
}

function populateQualityFields(): void {
  if (!dbfHeader) return;
  const previous = qualityField.value;
  const numericTypes = new Set(['N', 'F', 'I', 'B', 'Y']);
  const fields = [...dbfHeader.fields].sort((left, right) =>
    Number(numericTypes.has(right.type)) - Number(numericTypes.has(left.type)));
  qualityField.replaceChildren(new Option('Escolha um campo', ''));
  for (const field of fields) {
    qualityField.add(new Option(`${selectionLabel(field.name)} · tipo ${field.type}`, field.name));
  }
  qualityField.value = fields.some((field) => field.name === previous) ? previous : '';
  qualityMinimum.value = '';
  qualityMaximum.value = '';
  updateQualityProfile();
}

function conciseQualityNumber(value: number | undefined): string {
  return value === undefined ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(value);
}

function inputQualityNumber(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

/** Kept so suggesting a range does not re-read the dataset. */
let lastQualityProfile: NumericFieldProfile | null = null;

async function updateQualityProfile(): Promise<void> {
  lastQualityProfile = null;
  if (!qualityField.value || !datasetRecordCount) {
    qualitySummary.textContent = 'Escolha um campo para ver distribuição, ausências e valores extremos.';
    qualitySuggestButton.disabled = true;
    qualityApplyButton.disabled = true;
    return;
  }
  qualitySummary.textContent = 'Perfilando o campo…';
  qualitySuggestButton.disabled = true;
  let profile: NumericFieldProfile;
  try {
    ({ profile } = await askDataset<{ profile: NumericFieldProfile }>(
      { type: 'profile-numeric', field: qualityField.value },
      { label: 'Perfil de qualidade' },
    ));
  } catch (error) {
    qualitySummary.textContent = error instanceof Error ? error.message : String(error);
    qualityApplyButton.disabled = true;
    return;
  }
  lastQualityProfile = profile;
  if (!profile.numericRecords) {
    qualitySummary.textContent = `${selectionLabel(profile.field)} não possui valores numéricos reconhecidos; ${integerFormat.format(profile.missingRecords)} ausente(s) e ${integerFormat.format(profile.invalidRecords)} inválido(s).`;
    qualitySuggestButton.disabled = true;
    qualityApplyButton.disabled = true;
    return;
  }
  qualitySummary.textContent = [
    `${integerFormat.format(profile.numericRecords)} numérico(s)`,
    `${integerFormat.format(profile.missingRecords)} ausente(s)`,
    `${integerFormat.format(profile.invalidRecords)} inválido(s)`,
    `faixa ${conciseQualityNumber(profile.minimum)}–${conciseQualityNumber(profile.maximum)}`,
    `mediana ${conciseQualityNumber(profile.median)}`,
    `${integerFormat.format(profile.iqrOutlierRecords)} extremo(s) estatístico(s)`,
  ].join(' · ');
  qualitySuggestButton.disabled = profile.lowerIqrFence === undefined || profile.upperIqrFence === undefined;
  updateQualityApplyState();
}

function updateQualityApplyState(): void {
  const minimum = qualityMinimum.value.trim();
  const maximum = qualityMaximum.value.trim();
  qualityApplyButton.disabled = !qualityField.value || (!minimum && !maximum);
}

function suggestQualityRange(): void {
  const profile = lastQualityProfile;
  if (!profile || profile.minimum === undefined || profile.maximum === undefined
    || profile.lowerIqrFence === undefined || profile.upperIqrFence === undefined) return;
  qualityMinimum.value = inputQualityNumber(Math.max(profile.minimum, profile.lowerIqrFence));
  qualityMaximum.value = inputQualityNumber(Math.min(profile.maximum, profile.upperIqrFence));
  updateQualityApplyState();
  showToast('Sugestão preenchida; revise antes de aplicar');
}

function applyQualityRange(): void {
  if (!qualityField.value) return;
  const minimum = qualityMinimum.value.trim() === '' ? undefined : Number(qualityMinimum.value);
  const maximum = qualityMaximum.value.trim() === '' ? undefined : Number(qualityMaximum.value);
  if (minimum === undefined && maximum === undefined) return;
  if ((minimum !== undefined && !Number.isFinite(minimum)) || (maximum !== undefined && !Number.isFinite(maximum))) {
    throw new Error('Informe limites numéricos válidos');
  }
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new Error('O mínimo válido não pode ser maior que o máximo');
  }
  configuredFilters.push({
    field: qualityField.value, kind: 'numeric-range', mode: 'include', origin: 'data-quality',
    ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}),
    includeMinimum: true, includeMaximum: true,
  });
  renderConfiguredFilters();
  showToast('Regra de limpeza aplicada sem alterar o arquivo original');
  void runAnalysis();
}

function populateFilterFields(): void {
  if (!dbfHeader) return;
  const previous = filterField.value;
  filterField.replaceChildren(new Option('Sem filtro', ''));
  for (const field of dbfHeader.fields) filterField.add(new Option(selectionLabel(field.name), field.name));
  filterField.value = dbfHeader.fields.some((field) => field.name === previous) ? previous : '';
  void populateFilterValues();
}

function updateMeasureControls(): void {
  const isSum = measureKind.value === 'sum';
  measureFieldLabel.hidden = !isSum;
  measureField.disabled = !dbfHeader || !isSum;
}

async function populateFilterValues(): Promise<void> {
  filterValues.replaceChildren();
  filterValueSearch.value = '';
  activeFilterConversion = '';
  activeFilterStartPosition = undefined;
  addFilterButton.disabled = true;
  updateFilterCount();
  const field = filterField.value;
  const rangeMode = filterKind.value === 'numeric-range';
  filterRange.hidden = !rangeMode;
  filterValues.hidden = rangeMode;
  filterValueSearch.hidden = rangeMode || !field;
  filterValueSearch.disabled = rangeMode || !field;
  clearFilterButton.disabled = !field;
  selectAllFilterButton.disabled = !field || rangeMode;
  if (!field) {
    filterInfo.textContent = 'Escolha um campo para selecionar valores.';
    return;
  }

  if (rangeMode) {
    filterInfo.textContent = 'Informe pelo menos um limite. Os limites marcados são inclusivos.';
    updateFilterCount();
    return;
  }

  const option = activeDef?.options.find((candidate) =>
    candidate.field.toUpperCase() === field.toUpperCase() && candidate.roles.includes('selection'));
  if (option?.kind === 'conversion') {
    const wanted = baseName(option.conversionFile);
    const loadedName = [...cnvByName.keys()].find((name) => baseName(name) === wanted);
    if (loadedName) {
      activeFilterConversion = loadedName;
      activeFilterStartPosition = option.startPosition;
      const definition = cnvByName.get(loadedName)!;
      for (const category of definition.categories.slice(0, 500)) {
        addFilterOption(String(category.sequence), category.label || String(category.sequence));
      }
      addFilterOption('', 'Não classificados (sem correspondência CNV)', true);
      filterInfo.textContent = `${definition.categories.length} categorias de ${loadedName}. Marque os valores que deseja incluir.`;
      return;
    }
  }

  filterInfo.textContent = 'Lendo os valores do campo…';
  try {
    const collected = await askDataset<{ values: string[]; truncated: boolean }>(
      { type: 'distinct', field, limit: 500 },
      { label: 'Leitura de valores' },
    );
    for (const value of collected.values) addFilterOption(value, value || '(em branco)');
    filterInfo.textContent =
      `${collected.values.length}${collected.truncated ? '+' : ''} valores encontrados. Marque os valores que deseja incluir.`;
  } catch (error) {
    filterInfo.textContent = error instanceof Error ? error.message : String(error);
  }
}

function addFilterOption(value: string, label: string, unclassified = false): void {
  const wrapper = document.createElement('label');
  wrapper.className = 'filter-option';
  wrapper.dataset.search = normalizeLabel(`${label} ${value}`);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.filterValue = value;
  if (unclassified) input.dataset.filterUnclassified = 'true';
  input.addEventListener('change', updateFilterCount);
  const caption = document.createElement('span');
  caption.textContent = label;
  wrapper.append(input, caption);
  filterValues.append(wrapper);
}

function searchFilterValues(): void {
  const query = normalizeLabel(filterValueSearch.value);
  for (const option of filterValues.querySelectorAll<HTMLElement>('.filter-option')) {
    option.hidden = Boolean(query) && !option.dataset.search?.includes(query);
  }
}

function updateFilterCount(): void {
  const selectedCount = filterValues.querySelectorAll<HTMLInputElement>('input:checked').length;
  const rangeReady = filterKind.value === 'numeric-range'
    && (filterMinimum.value.trim() !== '' || filterMaximum.value.trim() !== '');
  addFilterButton.disabled = !filterField.value
    || (filterKind.value === 'numeric-range' ? !rangeReady : selectedCount === 0);
  filterCount.textContent = configuredFilters.length
    ? `${integerFormat.format(configuredFilters.length)} ativo(s)`
    : 'nenhum';
}

function addConfiguredFilter(): void {
  if (!filterField.value) return;
  let next: FilterSpec;
  if (filterKind.value === 'numeric-range') {
    const minimum = filterMinimum.value.trim() === '' ? undefined : Number(filterMinimum.value);
    const maximum = filterMaximum.value.trim() === '' ? undefined : Number(filterMaximum.value);
    if (minimum === undefined && maximum === undefined) return;
    next = {
      field: filterField.value, kind: 'numeric-range', mode: filterMode.value as 'include' | 'exclude',
      ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}),
      includeMinimum: filterIncludeMinimum.checked, includeMaximum: filterIncludeMaximum.checked,
    };
  } else {
    const checked = [...filterValues.querySelectorAll<HTMLInputElement>('input:checked')];
    const acceptedCategories = checked
      .filter((input) => input.dataset.filterUnclassified !== 'true')
      .map((input) => input.dataset.filterValue ?? '');
    const includeUnclassified = checked.some((input) => input.dataset.filterUnclassified === 'true');
    if (!acceptedCategories.length && !includeUnclassified) return;
    next = {
      field: filterField.value, mode: filterMode.value as 'include' | 'exclude', acceptedCategories,
      ...(includeUnclassified ? { includeUnclassified: true } : {}),
      ...(activeFilterConversion ? { conversionId: activeFilterConversion } : {}),
      ...(activeFilterStartPosition !== undefined ? { startPosition: activeFilterStartPosition } : {}),
    };
  }
  configuredFilters.push(next);
  renderConfiguredFilters();
  for (const input of filterValues.querySelectorAll<HTMLInputElement>('input:checked')) input.checked = false;
  filterMinimum.value = '';
  filterMaximum.value = '';
  updateFilterCount();
  void runAnalysis();
}

function renderConfiguredFilters(): void {
  activeFilterList.replaceChildren();
  configuredFilters.forEach((filter, index) => {
    const item = document.createElement('div');
    item.className = 'active-filter';
    const label = document.createElement('span');
    const prefix = filter.origin === 'data-quality' ? 'Limpeza'
      : filter.mode === 'exclude' ? 'Excluir' : 'Incluir';
    label.textContent = filter.kind === 'numeric-range'
      ? `${prefix} ${selectionLabel(filter.field)} · ${filter.minimum ?? '−∞'} a ${filter.maximum ?? '+∞'}`
      : `${prefix} ${selectionLabel(filter.field)} · ${filter.acceptedCategories.length + (filter.includeUnclassified ? 1 : 0)} valor(es)`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remover filtro ${selectionLabel(filter.field)}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      configuredFilters.splice(index, 1);
      renderConfiguredFilters();
      updateFilterCount();
      void runAnalysis();
    });
    item.append(label, remove);
    activeFilterList.append(item);
  });
  updateFilterCount();
}

function cloneFilter(filter: FilterSpec): FilterSpec {
  return filter.kind === 'numeric-range'
    ? { ...filter }
    : { ...filter, acceptedCategories: [...filter.acceptedCategories] };
}

function populateConversions(): void {
  const previousRow = rowConversion.value;
  const previousColumn = columnConversion.value;
  rowConversion.replaceChildren(new Option('Valores originais', ''));
  columnConversion.replaceChildren(new Option('Valores originais', ''));
  for (const name of [...cnvByName.keys()].sort((a, b) => a.localeCompare(b))) {
    const definition = cnvByName.get(name)!;
    const label = `${name} · ${definition.categories.length} categorias`;
    rowConversion.add(new Option(label, name));
    columnConversion.add(new Option(label, name));
  }
  if (cnvByName.has(previousRow)) rowConversion.value = previousRow;
  if (cnvByName.has(previousColumn)) columnConversion.value = previousColumn;
  applyDefDefaults();
  updateColumnControls();
  if (filterField.value) void populateFilterValues();
}

function applyDefDefaults(): void {
  if (!activeDef) return;
  const definition = activeDef;
  const apply = (
    role: 'row' | 'column',
    field: string,
    conversion: HTMLSelectElement,
    position: HTMLInputElement,
  ): void => {
    if (!field) return;
    const option = optionsForRole(definition, role).find(
      (candidate) => candidate.field.toUpperCase() === field.toUpperCase(),
    );
    if (option?.kind !== 'conversion') return;
    position.value = String(option.startPosition);
    const wanted = baseName(option.conversionFile);
    const loadedName = [...cnvByName.keys()].find((name) => baseName(name) === wanted);
    if (loadedName) conversion.value = loadedName;
  };
  apply('row', rowField.value, rowConversion, startPosition);
  apply('column', columnField.value, columnConversion, columnStartPosition);
}

function updateDatasetStats(): void {
  if (!dbfHeader || !activeDatasetSources.length) return;
  const sourceBytes = activeDatasetSources.reduce((total, source) => total + source.size, 0);
  const values: Array<readonly [string, string]> = [
    [integerFormat.format(datasetRecordCount), 'registros ativos'],
    [integerFormat.format(dbfHeader.fields.length), 'campos'],
    [formatBytes(sourceBytes), activeDatasetSources.length === 1 ? 'arquivo original' : `${activeDatasetSources.length} arquivos-fonte`],
    [datasetFingerprint?.sha256.slice(0, 10) ?? `${activeDatasetSources.length} fontes`, datasetFingerprint ? 'sha-256' : 'proveniências auditáveis'],
  ];
  datasetStats.replaceChildren();
  for (const [value, label] of values) {
    const item = document.createElement('div');
    const strong = document.createElement('b');
    const caption = document.createElement('span');
    strong.textContent = value;
    caption.textContent = label;
    item.append(strong, caption);
    datasetStats.append(item);
  }
  datasetStats.style.display = 'grid';
  datasetStats.hidden = false;
}

async function decodeDbf(bytes: Uint8Array, file: File, isDbc: boolean, source: LoadedSource): Promise<void> {
  const header = await openDatasetFile(bytes, file, isDbc);

  // Admit the source only after decoding succeeds. Cancellation or malformed
  // input must leave the previous dataset and its provenance intact.
  rememberSource(source);
  activeDatasetSources.splice(0, activeDatasetSources.length, source);
  dbfHeader = header;
  currentDatasetFile = file;
  currentCompatibilityProfile = 'tabwin-4.15';
  sourceDbfButton.disabled = false;
  configuredFilters = [];
  renderConfiguredFilters();
  datasetName = file.name;
  datasetFingerprint = source;
  populateControls(chooseDefaultField(header.fields));
  updateDatasetStats();
  await runAnalysis();
}

function schemaSignature(header: DbfHeader): string {
  return header.fields
    .map((field) => `${field.name}:${field.type}:${field.length}:${field.decimalCount}`)
    .join('|');
}

async function openDatasetFile(bytes: Uint8Array, file: File, isDbc: boolean): Promise<DbfHeader> {
  if (activeDecode) throw new Error('Outra leitura DBC/DBF ainda está em andamento');
  setBusy(isDbc ? `Abrindo ${file.name}…` : `Lendo ${file.name}…`);
  decodeCancelButton.hidden = false;
  try {
    return await openDataset(
      [{ kind: 'binary', name: file.name, bytes: transferableBytes(bytes), isDbc }],
      `Leitura de ${file.name}`,
    );
  } finally {
    decodeCancelButton.hidden = true;
    activeDecode = null;
  }
}

async function appendCompatibleDbf(
  bytes: Uint8Array,
  file: File,
  isDbc: boolean,
  source: LoadedSource,
): Promise<void> {
  if (activeDatasetSources.some((item) => item.size === source.size && item.sha256 === source.sha256)) {
    throw new Error(`${file.name}: este arquivo já faz parte do conjunto combinado`);
  }
  if (activeDecode) throw new Error('Outra leitura DBC/DBF ainda está em andamento');
  if (!dbfHeader) throw new Error('Abra um arquivo antes de combinar outro');
  setBusy(`Combinando ${file.name}…`);
  decodeCancelButton.hidden = false;
  try {
    // The Worker holds every source and checks the schema against the open
    // dataset, so nothing is concatenated on this thread.
    dbfHeader = await appendDataset(
      { kind: 'binary', name: file.name, bytes: transferableBytes(bytes), isDbc },
      `Combinação de ${file.name}`,
    );
  } finally {
    decodeCancelButton.hidden = true;
    activeDecode = null;
  }
  rememberSource(source);
  activeDatasetSources.push(source);
  currentDatasetFile = null;
  sourceDbfButton.disabled = true;
  datasetName = activeDatasetSources.map((item) => item.name).join(' + ');
  datasetFingerprint = null;
  updateDatasetStats();
  await runAnalysis();
}

type DatasetWorkerSource =
  | { kind: 'binary'; name: string; bytes: ArrayBuffer; isDbc: boolean }
  | { kind: 'records'; name: string; records: DbfRecord[] };

/**
 * The opened dataset lives in the Worker; this thread keeps only its shape.
 *
 * There is no second path for large files. Every request streams the retained
 * sources in bounded batches and decodes just the fields it needs, so the same
 * code serves a small SIH file and the national Dengue file.
 */
let datasetWorker: Worker | null = null;
let datasetRequestId = 0;
let datasetRecordCount = 0;

function disposeDatasetWorker(): void {
  datasetWorker?.terminate();
  datasetWorker = null;
}

function datasetWorkerInstance(): Worker {
  if (!datasetWorker) {
    datasetWorker = new Worker(new URL('./dataset-worker.ts', import.meta.url), { type: 'module' });
  }
  return datasetWorker;
}

interface DatasetAskOptions {
  label: string;
  transfer?: Transferable[];
  progress?: (recordsRead: number, recordCount: number) => void;
}

/**
 * Sends one request and resolves with its reply.
 *
 * Cancellation terminates the Worker rather than sending a message: the Worker
 * runs a synchronous decode loop and cannot process messages while it does.
 */
function askDataset<T>(message: Record<string, unknown>, options: DatasetAskOptions): Promise<T> {
  const worker = datasetWorkerInstance();
  const requestId = ++datasetRequestId;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onFailure);
      activeDecode = null;
      action();
    };
    const onMessage = (event: MessageEvent<Record<string, unknown>>): void => {
      const data = event.data;
      if (!data || data.requestId !== requestId) return;
      if (data.type === 'progress') {
        options.progress?.(Number(data.recordsRead), Number(data.recordCount));
        return;
      }
      if (data.type === 'error') {
        finish(() => reject(new Error(String(data.message))));
        return;
      }
      finish(() => resolve(data as T));
    };
    const onFailure = (): void => {
      disposeDatasetWorker();
      finish(() => reject(new Error(`${options.label} falhou no trabalhador local`)));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onFailure, { once: true });
    activeDecode = {
      cancel: () => {
        disposeDatasetWorker();
        finish(() => reject(new Error(`${options.label} cancelada`)));
      },
    };
    try {
      worker.postMessage({ ...message, requestId }, options.transfer ?? []);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

function datasetProgress(label: string) {
  return (recordsRead: number, recordCount: number): void => {
    resultTitle.textContent = recordCount
      ? `${label}: ${integerFormat.format(recordsRead)} de ${integerFormat.format(recordCount)} registros…`
      : `${label}: ${integerFormat.format(recordsRead)} registros…`;
  };
}

async function openDataset(
  sources: DatasetWorkerSource[],
  label: string,
  fields?: DbfField[],
): Promise<DbfHeader> {
  disposeDatasetWorker();
  const transfer = sources.flatMap((source) => (source.kind === 'binary' ? [source.bytes] : []));
  const reply = await askDataset<{ header: DbfHeader; recordCount: number }>(
    { type: 'open', sources, ...(fields ? { fields } : {}) },
    { label, transfer },
  );
  datasetRecordCount = reply.recordCount;
  return reply.header;
}

async function appendDataset(source: DatasetWorkerSource, label: string): Promise<DbfHeader> {
  const transfer = source.kind === 'binary' ? [source.bytes] : [];
  const reply = await askDataset<{ header: DbfHeader; recordCount: number }>(
    { type: 'append', source },
    { label, transfer },
  );
  datasetRecordCount = reply.recordCount;
  return reply.header;
}

/** Detaches the buffer so a large file is never duplicated on this thread. */
function transferableBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}


async function decodeDelimitedFile(bytes: Uint8Array, file: File, source: LoadedSource): Promise<void> {
  setBusy(`Lendo ${file.name}…`);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = textDecoder.decode(bytes); }
  const dataset = parseDelimited(text, extensionOf(file.name) === 'TSV' ? { delimiter: '\t' } : {});
  rememberSource(source);
  activeDatasetSources.splice(0, activeDatasetSources.length, source);
  const fields = dataset.fields;
  // A parsed CSV becomes a dataset source like any other, so the same Worker
  // answers every request and this thread keeps no records for it either.
  dbfHeader = await openDataset(
    [{ kind: 'records', name: file.name, records: dataset.records as DbfRecord[] }],
    `Leitura de ${file.name}`,
    fields,
  );
  dbfHeader = { ...dbfHeader, dateOfLastUpdate: new Date(file.lastModified || Date.now()) };
  currentDatasetFile = null;
  currentCompatibilityProfile = 'modern';
  sourceDbfButton.disabled = true;
  configuredFilters = [];
  renderConfiguredFilters();
  datasetName = file.name;
  datasetFingerprint = source;
  populateControls(chooseDefaultField(fields));
  updateDatasetStats();
  await runAnalysis();
  showToast(`${file.name}: ${integerFormat.format(datasetRecordCount)} linhas CSV carregadas`);
}

async function loadFile(file: File): Promise<void> {
  const extension = extensionOf(file.name);
  if (!['DBC', 'DBF', 'CSV', 'TSV', 'DEF', 'CNV', 'MAP'].includes(extension)) {
    throw new Error(`${file.name}: formato ainda não suportado`);
  }
  if (file.size > MAX_LOCAL_INPUT_BYTES) {
    throw new Error(`${file.name}: excede o limite local de ${formatBytes(MAX_LOCAL_INPUT_BYTES)}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source: LoadedSource = {
    name: file.name,
    extension,
    size: file.size,
    sha256: await sha256(bytes),
  };

  if (extension === 'DBC' || extension === 'DBF') {
    if (combineCompatibleFiles.checked && dbfHeader && datasetRecordCount) {
      await appendCompatibleDbf(bytes, file, extension === 'DBC', source);
      return;
    }
    await decodeDbf(bytes, file, extension === 'DBC', source);
    return;
  }
  if (extension === 'CSV' || extension === 'TSV') {
    await decodeDelimitedFile(bytes, file, source);
    return;
  }
  rememberSource(source);
  if (extension === 'CNV') {
    const definition = parseCnv(textDecoder.decode(bytes));
    cnvByName.set(file.name, definition);
    populateConversions();
    showToast(`${file.name}: ${definition.categories.length} categorias carregadas`);
    return;
  }
  if (extension === 'DEF') {
    activeDef = parseDef(textDecoder.decode(bytes));
    if (dbfHeader) populateControls(rowField.value);
    showToast(`${file.name}: ${activeDef.options.length} opções de análise encontradas`);
    return;
  }
  activeMap = parseTabwinMap(bytes);
  indexActiveMapNames();
  activeMapSource = file.name;
  showToast(`${file.name}: ${integerFormat.format(activeMap.objects.length)} áreas carregadas`);
  if (currentResult) renderTable(currentResult);
  if (currentView === 'map') renderMap();
}

async function downloadSourceDbf(): Promise<void> {
  if (!currentDatasetFile) return;
  const label = sourceDbfButton.textContent;
  sourceDbfButton.disabled = true;
  sourceDbfButton.textContent = 'Preparando DBF…';
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const source = new Uint8Array(await currentDatasetFile.arrayBuffer());
    const extraction = extractSourceDbf(source, currentDatasetFile.name);
    downloadBlob(new Blob([extraction.bytes as BlobPart], { type: 'application/x-dbf' }), extraction.filename);
    showToast(`${extraction.filename}: ${integerFormat.format(extraction.header.recordCount)} registros`);
  } finally {
    sourceDbfButton.textContent = label;
    sourceDbfButton.disabled = false;
  }
}

async function downloadSelectedDbf(): Promise<void> {
  if (!dbfHeader || !currentPlan || !currentResult) return;
  const label = selectedDbfButton.textContent;
  selectedDbfButton.disabled = true;
  selectedDbfButton.textContent = 'Filtrando registros…';
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const conversions = conversionsForPlan(currentPlan);
    // The Worker selects with the same resolvePlanRecord boundary the table
    // used, so the exported subset cannot disagree with the accepted count.
    const reply = await askDataset<{ bytes: ArrayBuffer }>(
      { type: 'selected-dbf', plan: currentPlan, conversions },
      { label: 'Exportação de registros selecionados', progress: datasetProgress('Selecionando') },
    );
    const bytes = new Uint8Array(reply.bytes);
    const written = readDbfHeader(bytes).recordCount;
    if (written !== currentResult.recordsAccepted) {
      throw new Error('A seleção DBF divergiu da contagem aceita; exportação interrompida');
    }
    const filename = `${datasetName.replace(/\.[^.]+$/, '')}-selecionados.dbf`;
    downloadBlob(new Blob([bytes as BlobPart], { type: 'application/x-dbf' }), filename);
    showToast(`${filename}: ${integerFormat.format(written)} registros`);
  } finally {
    selectedDbfButton.textContent = label;
    selectedDbfButton.disabled = false;
  }
}

async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  try {
    // Metadata first lets a DEF/CNV influence the automatic first analysis even
    // when the user selected all files in one gesture.
    const ordered = [...files].sort((a, b) => {
      const rank = (file: File) => ({ DEF: 0, CNV: 1, MAP: 2, DBC: 3, DBF: 3, CSV: 3, TSV: 3 } as Record<string, number>)[extensionOf(file.name)] ?? 9;
      return rank(a) - rank(b);
    });
    for (const file of ordered) await loadFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resultKicker.textContent = 'Não foi possível abrir';
    resultTitle.textContent = message;
    showToast(message, true);
    setControlsEnabled(Boolean(dbfHeader));
  } finally {
    fileInput.value = '';
  }
}

function buildPlan(): QueryPlan {
  const conversionName = rowConversion.value;
  const columnConversionName = columnConversion.value;
  const row = {
    field: rowField.value,
    ...(conversionName ? { conversionId: conversionName, startPosition: Number(startPosition.value) } : {}),
    ...(discriminateUnclassified.checked ? { unclassifiedPolicy: 'discriminate' as const } : {}),
  };
  const measure = measureKind.value === 'sum'
    ? { kind: 'sum' as const, field: measureField.value }
    : { kind: 'count' as const };
  const spec = {
    compatibilityProfile: currentCompatibilityProfile,
    rows: row,
    ...(columnField.value ? { columns: {
      field: columnField.value,
      ...(columnConversionName
        ? { conversionId: columnConversionName, startPosition: Number(columnStartPosition.value) }
        : {}),
      ...(discriminateColumnUnclassified.checked ? { unclassifiedPolicy: 'discriminate' as const } : {}),
    } } : {}),
    measure,
    filters: configuredFilters.map(cloneFilter),
    suppressZeroRows: suppressZero.checked,
    suppressZeroColumns: suppressZeroColumns.checked,
  };
  return compileQueryPlan(spec);
}

function conversionsForPlan(plan: QueryPlan): Record<string, CnvDefinition> {
  const conversions: Record<string, CnvDefinition> = {};
  for (const id of [plan.spec.rows.conversionId, plan.spec.columns?.conversionId,
    ...plan.spec.filters.map((filter) => filter.conversionId)]) {
    if (id) conversions[id] = cnvByName.get(id)!;
  }
  return conversions;
}

async function runAnalysis(): Promise<void> {
  if (!dbfHeader || !datasetRecordCount || !rowField.value) return;
  setBusy('Montando a tabela…');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  decodeCancelButton.hidden = false;
  try {
    const plan = buildPlan();
    const conversions = conversionsForPlan(plan);
    const { result } = await askDataset<{ result: TabulationResult }>(
      { type: 'tabulate', plan, conversions },
      { label: 'Tabulação', progress: datasetProgress('Tabulando') },
    );
    currentPlan = plan;
    baseResult = result;
    currentResult = result;
    tableOperations = [];
    currentRowLabel = fieldLabel(rowField.value);
    resultKicker.textContent = measureKind.value === 'sum'
      ? `${datasetName} · soma de ${measureField.value}`
      : `${datasetName} · frequência`;
    resultTitle.textContent = fieldLabel(rowField.value).replace(` · ${rowField.value}`, '');
    tableTitle.value = resultTitle.textContent;
    tableSubtitle.value = '';
    tableFooter.value = '';
    renderResult();
    exportCsvButton.disabled = false;
    exportXlsxButton.disabled = false;
    exportXmlButton.disabled = false;
    chartPngButton.disabled = false;
    chartSvgButton.disabled = false;
    saveRecipeButton.disabled = false;
    saveTableButton.disabled = false;
    selectedDbfButton.disabled = false;
    setControlsEnabled(true);
    if (currentView === 'map' || rowField.value.toUpperCase().includes('MUNIC')) await ensureMap();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resultKicker.textContent = 'Análise interrompida';
    resultTitle.textContent = message;
    showToast(message, true);
    setControlsEnabled(true);
  } finally {
    decodeCancelButton.hidden = true;
  }
}

function cellValue(result: TabulationResult, rowIndex: number): number {
  return result.cells[rowIndex]?.reduce((sum, value) => sum + value, 0) ?? 0;
}

function renderResult(): void {
  if (!currentResult || !currentPlan) return;
  emptyState.hidden = true;
  tableWrap.hidden = false;
  tableOperationsPanel.hidden = false;
  tablePresentation.hidden = false;
  tableEditing.hidden = false;
  includeTableButton.disabled = false;
  updateTablePresentationControls();
  renderTable(currentResult);
  updateTableOperationControls();
  renderChart(currentResult);
  populateStatisticsColumns(currentResult);
  renderStatistics();
  renderAudit();
  if (activeMap) renderMap();
}

function operationLabel(operation: TableOperation): string {
  const names: Record<string, string> = {
    add: 'soma', subtract: 'subtração', multiply: 'produto', divide: 'divisão',
    minimum: 'mínimo', maximum: 'máximo', percentage: 'percentual', factor: 'fator',
    cumulative: 'acumulado', absolute: 'absoluto', integer: 'inteiro', sequence: 'sequência', constant: 'constante',
    expression: 'expressão',
  };
  if (operation.kind === 'rename-column') return `${operation.label} · renomear coluna`;
  if (operation.kind === 'move-column') return `${operation.columnKey} · mover ${operation.direction === 'left' ? 'à esquerda' : 'à direita'}`;
  if (operation.kind === 'delete-column') return `${operation.columnKey} · remover coluna`;
  if (operation.kind === 'transpose') return 'Transpor linhas/colunas';
  if (operation.kind === 'include-table') return `${operation.sourceLabel} · incluir tabela por chave`;
  if (operation.kind === 'suppress-rows') return `${operation.rowKeys.length} linha(s) · suprimir`;
  if (operation.kind === 'aggregate-rows') return `${operation.outputRow.label} · agregar ${operation.rowKeys.length} linha(s)`;
  return `${operation.output.label} · ${names[operation.kind === 'binary' ? operation.operator : operation.kind] ?? operation.kind}`;
}

function updateTableOperationControls(): void {
  const previousLeft = tableOperationLeft.value;
  const previousRight = tableOperationRight.value;
  tableOperationLeft.replaceChildren();
  tableOperationRight.replaceChildren();
  for (const column of currentResult?.columns ?? []) {
    const option = document.createElement('option');
    option.value = column.key;
    option.textContent = column.label;
    tableOperationLeft.append(option);
    tableOperationRight.append(option.cloneNode(true));
  }
  if ([...tableOperationLeft.options].some((option) => option.value === previousLeft)) tableOperationLeft.value = previousLeft;
  if ([...tableOperationRight.options].some((option) => option.value === previousRight)) tableOperationRight.value = previousRight;
  else if (tableOperationRight.options.length > 1) tableOperationRight.selectedIndex = 1;

  const kind = tableOperationKind.value;
  const binary = ['add', 'subtract', 'multiply', 'divide', 'minimum', 'maximum', 'percentage'].includes(kind);
  const sourceFree = kind === 'sequence' || kind === 'constant' || kind === 'expression';
  tableOperationLeftLabel.hidden = sourceFree;
  tableOperationRightLabel.hidden = !binary;
  tableOperationNumberLabel.hidden = kind !== 'factor' && kind !== 'sequence' && kind !== 'constant';
  tableOperationExpressionLabel.hidden = kind !== 'expression';
  tableOperationZeroLabel.hidden = kind !== 'divide' && kind !== 'percentage' && kind !== 'expression';
  tableOperationUndo.disabled = tableOperations.length === 0;
  tableOperationReset.disabled = tableOperations.length === 0;
  tableOperationApply.disabled = !currentResult?.columns.length && !sourceFree;
  tableOperationHistory.hidden = tableOperations.length === 0;
  tableOperationHistory.replaceChildren(...tableOperations.map((operation) => {
    const item = document.createElement('li');
    item.textContent = operationLabel(operation);
    return item;
  }));
}

function suggestedOperationLabel(kind: string): string {
  const left = currentResult?.columns.find((column) => column.key === tableOperationLeft.value)?.label ?? 'A';
  const right = currentResult?.columns.find((column) => column.key === tableOperationRight.value)?.label ?? 'B';
  const labels: Record<string, string> = {
    add: `${left} + ${right}`, subtract: `${left} − ${right}`, multiply: `${left} × ${right}`,
    divide: `${left} ÷ ${right}`, minimum: `Mínimo (${left}, ${right})`, maximum: `Máximo (${left}, ${right})`,
    percentage: `% ${left} / ${right}`, factor: `${left} × ${tableOperationNumber.value || '1'}`,
    cumulative: `Acumulado: ${left}`, absolute: `Absoluto: ${left}`, integer: `Inteiro: ${left}`,
    sequence: 'Sequência', constant: 'Nova coluna', expression: 'Coluna calculada',
  };
  return labels[kind] ?? 'Nova coluna';
}

function applySelectedTableOperation(): void {
  if (!currentResult) return;
  const kind = tableOperationKind.value;
  const numeric = Number(tableOperationNumber.value);
  if (['factor', 'sequence', 'constant'].includes(kind) && !Number.isFinite(numeric)) {
    throw new Error('Informe um fator ou valor numérico válido');
  }
  const output = {
    key: `__derived_${tableOperations.length + 1}`,
    label: tableOperationLabel.value.trim() || suggestedOperationLabel(kind),
    totalPolicy: tableOperationTotal.value as Exclude<TotalPolicy, 'precalculated'>,
  };
  let operation: TableOperation;
  if (['add', 'subtract', 'multiply', 'divide', 'minimum', 'maximum', 'percentage'].includes(kind)) {
    operation = {
      kind: 'binary', operator: kind as 'add' | 'subtract' | 'multiply' | 'divide' | 'minimum' | 'maximum' | 'percentage',
      leftColumnKey: tableOperationLeft.value, rightColumnKey: tableOperationRight.value,
      divisionByZero: tableOperationZero.value as 'error' | 'zero', output,
    };
  } else if (kind === 'factor') {
    operation = { kind, sourceColumnKey: tableOperationLeft.value, factor: numeric, output };
  } else if (kind === 'cumulative' || kind === 'absolute') {
    operation = { kind, sourceColumnKey: tableOperationLeft.value, output };
  } else if (kind === 'integer') {
    operation = { kind, sourceColumnKey: tableOperationLeft.value, rounding: 'truncate', output };
  } else if (kind === 'sequence') {
    operation = { kind, start: numeric, step: 1, output };
  } else if (kind === 'expression') {
    operation = {
      kind, expression: tableOperationExpression.value,
      divisionByZero: tableOperationZero.value as 'error' | 'zero', output,
    };
  } else {
    operation = { kind: 'constant', value: numeric, output };
  }
  commitTableOperation(operation);
  tableOperationLabel.value = '';
  if (operation.kind === 'expression') tableOperationExpression.value = '';
}

function commitTableOperation(operation: TableOperation): void {
  if (!currentResult) return;
  currentResult = applyTableOperation(currentResult, operation).result;
  tableOperations.push(operation);
  renderResult();
  showToast(operationLabel(operation));
}

function restoreTableOperations(count: number): void {
  if (!baseResult) return;
  tableOperations = tableOperations.slice(0, Math.max(0, count));
  currentResult = replayTableOperations(baseResult, tableOperations);
  renderResult();
}

function updateTablePresentationControls(): void {
  const previous = tableSortColumn.value;
  const previousEdit = tableEditColumn.value;
  tableSortColumn.replaceChildren();
  tableEditColumn.replaceChildren();
  const rowOption = document.createElement('option');
  rowOption.value = '__row_key__';
  rowOption.textContent = 'Chave/linha';
  tableSortColumn.append(rowOption);
  for (const column of currentResult?.columns ?? []) {
    const option = document.createElement('option');
    option.value = column.key;
    option.textContent = column.label;
    tableSortColumn.append(option);
    const editOption = document.createElement('option');
    editOption.value = column.key;
    editOption.textContent = column.label;
    tableEditColumn.append(editOption);
  }
  if ([...tableSortColumn.options].some((option) => option.value === previous)) tableSortColumn.value = previous;
  if ([...tableEditColumn.options].some((option) => option.value === previousEdit)) tableEditColumn.value = previousEdit;
  updateColumnEditButtons();
  updateRowEditButtons();
}

function updateColumnEditButtons(): void {
  const index = currentResult?.columns.findIndex((column) => column.key === tableEditColumn.value) ?? -1;
  tableColumnRename.disabled = index < 0;
  tableColumnLeft.disabled = index <= 0;
  tableColumnRight.disabled = index < 0 || index >= (currentResult?.columns.length ?? 0) - 1;
  tableColumnDelete.disabled = (currentResult?.columns.length ?? 0) <= 1;
}

function updateRowEditButtons(): void {
  const ready = Boolean(currentResult && tableLocate.value.trim() && currentTableRowIndexes().length);
  tableRowAggregate.disabled = !ready;
  tableRowSuppress.disabled = !ready;
}

function locatedRowKeys(): string[] {
  if (!currentResult || !tableLocate.value.trim()) throw new Error('Use Localizar para escolher uma ou mais linhas');
  const keys = currentTableRowIndexes().map((index) => currentResult!.rows[index]!.key);
  if (!keys.length) throw new Error('Nenhuma linha localizada');
  return keys;
}

function currentTableRowIndexes(): number[] {
  if (!currentResult) return [];
  const searchableResult = mapNameByGeocode.size ? {
    ...currentResult,
    rows: currentResult.rows.map((row) => ({ ...row, label: displayRowLabel(row) })),
  } : currentResult;
  return tableRowIndexes(searchableResult, {
    columnKey: tableSortColumn.value,
    direction: tableSortDirection.value as 'original' | 'ascending' | 'descending',
  }, tableLocate.value);
}

function tableNumber(value: number): string {
  const decimals = Number(tableDecimals.value);
  if (decimals < 0) return numberFormat.format(value);
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function indexActiveMapNames(): void {
  mapNameByGeocode = new Map(
    (activeMap?.objects ?? [])
      .filter((object) => object.geocode.trim() && object.name.trim())
      .map((object) => [object.geocode.trim().toLowerCase(), object.name.trim()]),
  );
}

function displayRowLabel(row: TabulationResult['rows'][number]): string {
  if (!currentPlan?.spec.rows.field.toUpperCase().includes('MUNIC')) return row.label;
  const key = row.key.trim();
  const name = mapNameByGeocode.get(key.toLowerCase());
  if (!name || (row.label.trim() && normalizeLabel(row.label) !== normalizeLabel(key))) return row.label;
  return `${name} (${key})`;
}

function renderTable(result: TabulationResult): void {
  const caption = resultTable.caption ?? resultTable.createCaption();
  caption.replaceChildren();
  const captionTitle = document.createElement('strong');
  captionTitle.textContent = tableTitle.value.trim() || resultTitle.textContent || activeRowLabel();
  caption.append(captionTitle);
  if (tableSubtitle.value.trim()) {
    const subtitle = document.createElement('span');
    subtitle.textContent = tableSubtitle.value.trim();
    caption.append(subtitle);
  }
  const head = resultTable.tHead ?? resultTable.createTHead();
  const body = resultTable.tBodies[0] ?? resultTable.createTBody();
  const foot = resultTable.tFoot ?? resultTable.createTFoot();
  head.replaceChildren();
  body.replaceChildren();
  foot.replaceChildren();

  const headerRow = document.createElement('tr');
  if (tableKeyVisible.checked) {
    const dimension = document.createElement('th');
    dimension.scope = 'col';
    dimension.textContent = activeRowLabel();
    headerRow.append(dimension);
  }
  for (const column of result.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column.label;
    headerRow.append(th);
  }
  head.append(headerRow);

  const indexes = currentTableRowIndexes();
  const limit = 500;
  for (const rowIndex of indexes.slice(0, limit)) {
    const row = result.rows[rowIndex]!;
    const tr = document.createElement('tr');
    if (tableKeyVisible.checked) {
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = displayRowLabel(row);
      tr.append(label);
    }
    for (const value of result.cells[rowIndex] ?? []) {
      const td = document.createElement('td');
      td.textContent = tableNumber(value);
      tr.append(td);
    }
    body.append(tr);
  }
  if (!indexes.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = result.columns.length + (tableKeyVisible.checked ? 1 : 0);
    td.textContent = 'Nenhuma categoria corresponde à busca.';
    tr.append(td);
    body.append(tr);
  } else if (indexes.length > limit) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = result.columns.length + (tableKeyVisible.checked ? 1 : 0);
    td.textContent = `Exibindo 500 de ${integerFormat.format(indexes.length)} linhas localizadas. O CSV contém o resultado completo.`;
    tr.append(td);
    body.append(tr);
  }
  const totalRow = document.createElement('tr');
  if (tableKeyVisible.checked) {
    const totalLabel = document.createElement('th');
    totalLabel.scope = 'row';
    totalLabel.textContent = 'Total';
    totalRow.append(totalLabel);
  }
  for (const column of result.columns) {
    const cell = document.createElement('td');
    const policy = column.totalPolicy ?? 'sum';
    const total = policy === 'precalculated' ? undefined : calculateColumnTotal(result, column.key, policy);
    cell.textContent = total === undefined ? '—' : tableNumber(total);
    totalRow.append(cell);
  }
  foot.append(totalRow);
  if (tableFooter.value.trim()) {
    const footerRow = document.createElement('tr');
    footerRow.className = 'table-custom-footer';
    const footerCell = document.createElement('td');
    footerCell.colSpan = result.columns.length + (tableKeyVisible.checked ? 1 : 0);
    footerCell.textContent = tableFooter.value.trim();
    footerRow.append(footerCell);
    foot.append(footerRow);
  }
}

function renderChart(result: TabulationResult): void {
  chart.replaceChildren();
  chart.append(renderChartSvg(result, chartType.value as ChartType, resultTitle.textContent ?? rowField.value));
}

function populateStatisticsColumns(result: TabulationResult): void {
  const previousX = statisticsX.value;
  const previousY = statisticsY.value;
  statisticsX.replaceChildren();
  statisticsY.replaceChildren();
  result.columns.forEach((column, index) => {
    const optionX = document.createElement('option');
    optionX.value = String(index);
    optionX.textContent = column.label;
    const optionY = optionX.cloneNode(true) as HTMLOptionElement;
    statisticsX.append(optionX);
    statisticsY.append(optionY);
  });
  statisticsX.disabled = result.columns.length === 0;
  statisticsY.disabled = result.columns.length < 2;
  if ([...statisticsX.options].some((option) => option.value === previousX)) statisticsX.value = previousX;
  if ([...statisticsY.options].some((option) => option.value === previousY)) statisticsY.value = previousY;
  else if (result.columns.length > 1) statisticsY.value = '1';
}

function statisticsColumn(index: number): number[] {
  if (!currentResult) return [];
  return currentResult.cells.map((row) => row[index] ?? 0);
}

function statisticCard(label: string, value: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'stat-card';
  const caption = document.createElement('span');
  caption.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  card.append(caption, strong);
  return card;
}

function renderStatistics(): void {
  const operation = statisticsOperation.value;
  const pairedOperation = operation === 'correlation' || operation === 'regression';
  statisticsYLabel.hidden = !pairedOperation;
  histogramBinsLabel.hidden = operation !== 'histogram';
  statisticsResult.replaceChildren();
  if (!currentResult?.columns.length) {
    const message = document.createElement('p');
    message.textContent = 'Execute uma análise para calcular estatísticas sobre as colunas do resultado.';
    statisticsResult.append(message);
    return;
  }
  if (pairedOperation && currentResult.columns.length < 2) {
    const message = document.createElement('p');
    message.textContent = 'Correlação e regressão precisam de pelo menos duas colunas no resultado.';
    statisticsResult.append(message);
    return;
  }
  const x = statisticsColumn(Number(statisticsX.value));
  try {
    if (operation === 'descriptive') {
      const result = descriptiveStatistics(x);
      const grid = document.createElement('div');
      grid.className = 'statistics-grid';
      const values: Array<[string, number]> = [
        ['Observações', result.count], ['Soma', result.sum], ['Média', result.mean],
        ['Mediana', result.median], ['Mínimo', result.minimum], ['Máximo', result.maximum],
        ['Variância amostral', result.sampleVariance], ['Desvio-padrão amostral', result.sampleStandardDeviation],
      ];
      for (const [label, value] of values) grid.append(statisticCard(label, numberFormat.format(value)));
      statisticsResult.append(grid);
    } else if (operation === 'correlation') {
      const correlation = pearsonCorrelation(x, statisticsColumn(Number(statisticsY.value)));
      statisticsResult.append(statisticCard('Coeficiente de Pearson (r)', numberFormat.format(correlation)));
    } else if (operation === 'regression') {
      const result = simpleLinearRegression(x, statisticsColumn(Number(statisticsY.value)));
      const grid = document.createElement('div');
      grid.className = 'statistics-grid';
      grid.append(
        statisticCard('Observações', integerFormat.format(result.count)),
        statisticCard('Inclinação', numberFormat.format(result.slope)),
        statisticCard('Intercepto', numberFormat.format(result.intercept)),
        statisticCard('R²', numberFormat.format(result.rSquared)),
      );
      statisticsResult.append(grid);
    } else {
      const requestedBins = Math.min(50, Math.max(1, Math.round(Number(histogramBins.value) || 8)));
      histogramBins.value = String(requestedBins);
      const bins = histogram(x, requestedBins);
      const max = Math.max(...bins.map((item) => item.count), 1);
      const rows = document.createElement('div');
      rows.className = 'histogram-bars';
      for (const item of bins) {
        const row = document.createElement('div');
        row.className = 'histogram-row';
        const label = document.createElement('span');
        label.textContent = `${numberFormat.format(item.lower)} – ${numberFormat.format(item.upper)}`;
        const track = document.createElement('div');
        track.className = 'histogram-track';
        const fill = document.createElement('div');
        fill.className = 'histogram-fill';
        fill.style.width = `${item.count / max * 100}%`;
        track.append(fill);
        const count = document.createElement('strong');
        count.textContent = integerFormat.format(item.count);
        row.append(label, track, count);
        rows.append(row);
      }
      statisticsResult.append(rows);
    }
  } catch (error) {
    const message = document.createElement('p');
    message.textContent = error instanceof Error ? error.message : String(error);
    statisticsResult.append(message);
  }
}

function renderAudit(): void {
  const audit = {
    application: { name: 'TabWin Web', version: '0.8.0-dev', compatibilityProfile: currentCompatibilityProfile },
    source: datasetFingerprint,
    datasetSources: activeDatasetSources,
    relatedFiles: loadedSources.filter((source) => !activeDatasetSources.some((datasetSource) =>
      datasetSource.name.toLowerCase() === source.name.toLowerCase() && datasetSource.sha256 === source.sha256)),
    definition: activeDef ? {
      description: activeDef.description,
      options: activeDef.options.length,
      warnings: activeDef.warnings,
      unresolvedLines: activeDef.unknownLines.length,
    } : null,
    map: activeMap ? {
      source: activeMapSource,
      objects: activeMap.objects.length,
      version: activeMap.version,
      classification: mapClassification.value,
      classCount: Number(mapClassCount.value),
      palette: mapPalette.value,
    } : null,
    queryPlan: currentPlan,
    resultOperations: tableOperations,
    tablePresentation: currentResult ? {
      sortColumnKey: tableSortColumn.value,
      sortDirection: tableSortDirection.value,
      decimalPlaces: Number(tableDecimals.value),
      keyVisible: tableKeyVisible.checked,
      title: tableTitle.value.trim() || null,
      subtitle: tableSubtitle.value.trim() || null,
      footer: tableFooter.value.trim() || null,
      locateQuery: tableLocate.value || null,
    } : null,
    result: currentResult ? {
      recordsSeen: currentResult.recordsSeen,
      recordsAccepted: currentResult.recordsAccepted,
      rows: currentResult.rows.length,
      columns: currentResult.columns.length,
      warnings: currentResult.warnings,
    } : null,
  };
  auditOutput.textContent = JSON.stringify(audit, null, 2);
}

function normalizeLabel(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function valueForMapObject(object: TabwinMapObject, values: Map<string, number>): number | undefined {
  return values.get(object.geocode.trim().toLowerCase()) ?? values.get(normalizeLabel(object.name));
}

function pointInRing(point: MapCoordinate, ring: MapCoordinate[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const intersects = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function objectAtCanvasPoint(canvasX: number, canvasY: number): TabwinMapObject | undefined {
  if (!activeMap || !mapProjection) return undefined;
  const point = {
    x: (canvasX - mapProjection.offsetX) / mapProjection.fit + mapProjection.west,
    y: mapProjection.north - (canvasY - mapProjection.offsetY) / mapProjection.fit,
  };
  for (let index = activeMap.objects.length - 1; index >= 0; index--) {
    const object = activeMap.objects[index];
    if (!object || (object.type !== 'polygon' && object.type !== 'polygon-with-seat')) continue;
    let inside = false;
    for (const part of object.parts) if (pointInRing(point, part)) inside = !inside;
    if (inside) return object;
  }
  return undefined;
}

function renderMap(): void {
  if (!activeMap || !currentResult) return;
  const parent = mapCanvas.parentElement;
  if (!parent) return;
  const cssWidth = Math.max(parent.clientWidth, 320);
  const cssHeight = Math.max(mapCanvas.clientHeight, 390);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  mapCanvas.width = Math.floor(cssWidth * scale);
  mapCanvas.height = Math.floor(cssHeight * scale);
  const context = mapCanvas.getContext('2d');
  if (!context) return;
  context.scale(scale, scale);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const { west, east, south, north } = activeMap.bounds;
  const sourceWidth = east - west;
  const sourceHeight = north - south;
  const padding = 18;
  const baseFit = Math.min((cssWidth - padding * 2) / sourceWidth, (cssHeight - padding * 2) / sourceHeight);
  const fit = baseFit * mapZoom;
  const drawnWidth = sourceWidth * fit;
  const drawnHeight = sourceHeight * fit;
  const offsetX = (cssWidth - drawnWidth) / 2 + mapPanX;
  const offsetY = (cssHeight - drawnHeight) / 2 + mapPanY;
  mapProjection = { west, north, fit, offsetX, offsetY };
  const project = (x: number, y: number) => ({
    x: offsetX + (x - west) * fit,
    y: offsetY + (north - y) * fit,
  });

  const values = new Map<string, number>();
  currentResult.rows.forEach((row, index) => {
    const value = cellValue(currentResult!, index);
    values.set(row.key.trim().toLowerCase(), value);
    values.set(normalizeLabel(row.label), value);
  });
  const scaleModel = createMapScale(
    values.values(),
    mapClassification.value as MapClassification,
    Number(mapClassCount.value),
    mapPalette.value as MapPalette,
  );
  let matched = 0;
  lastMapValues = new Map();

  context.lineJoin = 'round';
  context.lineWidth = Math.max(.28, .45 / scale);
  context.strokeStyle = 'rgba(49, 91, 86, .48)';
  for (const object of activeMap.objects) {
    const value = valueForMapObject(object, values);
    lastMapValues.set(object, value);
    if (value !== undefined) matched++;
    context.beginPath();
    for (const part of object.parts) {
      const first = part[0];
      if (!first) continue;
      const start = project(first.x, first.y);
      context.moveTo(start.x, start.y);
      for (let index = 1; index < part.length; index++) {
        const point = part[index]!;
        const next = project(point.x, point.y);
        context.lineTo(next.x, next.y);
      }
      if (object.type === 'polygon' || object.type === 'polygon-with-seat') context.closePath();
    }
    if (object.type === 'polygon' || object.type === 'polygon-with-seat') {
      context.fillStyle = scaleModel.colorFor(value);
      context.fill('evenodd');
      context.stroke();
    } else if (object.type === 'line') {
      context.strokeStyle = scaleModel.colorFor(value);
      context.lineWidth = 1.4;
      context.stroke();
      context.strokeStyle = 'rgba(49, 91, 86, .48)';
    } else {
      const point = project(object.labelPoint.x, object.labelPoint.y);
      context.fillStyle = scaleModel.colorFor(value);
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  mapMessage.hidden = matched > 0;
  mapMessage.textContent = matched > 0
    ? ''
    : `O mapa foi aberto, mas nenhum código ou nome coincide com as ${integerFormat.format(currentResult.rows.length)} linhas atuais.`;
  mapLegend.hidden = false;
  mapLegend.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = `${integerFormat.format(matched)} áreas associadas`;
  const gradient = document.createElement('div');
  gradient.className = 'legend-gradient';
  gradient.style.background = `linear-gradient(90deg, ${scaleModel.classes[0]?.color ?? '#dfe8e5'}, ${scaleModel.classes.at(-1)?.color ?? '#08634f'})`;
  const range = document.createElement('div');
  range.className = 'legend-range';
  const low = document.createElement('span');
  const high = document.createElement('span');
  low.textContent = numberFormat.format(scaleModel.min);
  high.textContent = numberFormat.format(scaleModel.max);
  range.append(low, high);
  mapLegend.append(title, gradient, range);
  if (mapClassification.value !== 'continuous') {
    const classList = document.createElement('div');
    classList.className = 'legend-classes';
    for (const item of scaleModel.classes) {
      const row = document.createElement('div');
      row.className = 'legend-class';
      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = item.color;
      const label = document.createElement('span');
      label.textContent = `${numberFormat.format(item.lower)} – ${numberFormat.format(item.upper)}`;
      row.append(swatch, label);
      classList.append(row);
    }
    mapLegend.append(classList);
  }
  mapPngButton.disabled = matched === 0;
  renderAudit();
}

async function ensureMap(): Promise<void> {
  if (!currentResult) return;
  if (activeMap) {
    renderTable(currentResult);
    if (currentView === 'map') renderMap();
    return;
  }
  const field = rowField.value.toUpperCase();
  const bundled = field.includes('MUNIC')
    ? 'br_municip.MAP'
    : /(^|_)UF($|_)|ESTADO/.test(field) ? 'br_ufsigla.MAP' : '';
  if (!bundled) {
    mapMessage.hidden = false;
    mapMessage.textContent = 'Escolha uma variável de município ou UF, ou abra um arquivo MAP do TabWin.';
    mapLegend.hidden = true;
    mapPngButton.disabled = true;
    return;
  }

  mapMessage.hidden = false;
  mapMessage.textContent = 'Preparando o mapa do Brasil neste aparelho…';
  try {
    const response = await fetch(new URL(`maps/${bundled}`, document.baseURI));
    if (!response.ok) throw new Error(`mapa retornou HTTP ${response.status}`);
    activeMap = parseTabwinMap(new Uint8Array(await response.arrayBuffer()));
    indexActiveMapNames();
    activeMapSource = `incluído: ${bundled}`;
    renderTable(currentResult);
    if (currentView === 'map') renderMap();
  } catch (error) {
    mapMessage.textContent = `Não foi possível abrir o mapa incluído: ${error instanceof Error ? error.message : String(error)}`;
    mapLegend.hidden = true;
    mapPngButton.disabled = true;
  }
}

function displayBaseName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path;
}

function archiveFile(entry: ExtractedArchiveFile): File {
  const bytes = entry.bytes.buffer.slice(
    entry.bytes.byteOffset,
    entry.bytes.byteOffset + entry.bytes.byteLength,
  ) as ArrayBuffer;
  return new File([bytes], displayBaseName(entry.name), { type: 'application/octet-stream' });
}

function setCatalogStatus(message: string, isError = false): void {
  catalogStatus.textContent = message;
  catalogStatus.classList.toggle('error', isError);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function setCatalogBusy(busy: boolean): void {
  catalogSearchButton.disabled = busy;
  for (const button of catalogResults.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy;
  for (const button of catalogAuxiliaryResults.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy;
  catalogCancelButton.hidden = !busy || activeCatalogController === null;
  if (!busy) catalogCancelButton.disabled = false;
}

function populateCatalogFileTypes(): void {
  const previous = catalogFileType.value;
  const types = fileTypesForSystem(catalogSystem.value);
  catalogFileType.replaceChildren();
  for (const item of types) catalogFileType.add(new Option(`${item.code} · ${item.label}`, item.code));
  if (types.some((item) => item.code === previous)) catalogFileType.value = previous;
  updateCatalogGeography();
}

function updateCatalogGeography(): void {
  const type = fileTypesForSystem(catalogSystem.value).find((item) => item.code === catalogFileType.value);
  const capabilities = catalogCapabilities(catalogSystem.value, catalogFileType.value);
  const annual = capabilities.periodicity === 'annual';
  catalogMonthLabel.hidden = annual;
  catalogUf.replaceChildren();
  const ufs = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
  if (type?.coverage !== 'UF') catalogUf.add(new Option('Brasil', 'BR'));
  if (type?.coverage !== 'BR') for (const uf of ufs) catalogUf.add(new Option(uf, uf));
  if (catalogUf.options[0]) catalogUf.options[0].selected = true;
  catalogUfLabel.hidden = type?.coverage === 'BR';
  renderCatalogCapabilities();
}

function renderCatalogCapabilities(): void {
  const capabilities = catalogCapabilities(catalogSystem.value, catalogFileType.value);
  const annual = capabilities.periodicity === 'annual';
  const geography = capabilities.geographies.length === 2 ? 'Brasil ou UFs'
    : capabilities.geographies[0] === 'BR' ? 'Brasil' : 'por UF';
  const auxiliary = capabilities.auxiliaryResolution === 'verified-automatic'
    ? 'auxiliares automáticos verificados' : 'auxiliares por escolha manual';
  let requestCount = '';
  try {
    const queries = expandDatasusSearchSelection({
      system: catalogSystem.value,
      fileType: catalogFileType.value,
      years: selectedCatalogValues(catalogYear),
      months: selectedCatalogValues(catalogMonth),
      ufs: selectedCatalogValues(catalogUf),
      annual,
    });
    requestCount = ` · ${integerFormat.format(queries.length)} combinação(ões) a consultar`;
  } catch {
    requestCount = ' · selecione ao menos um período';
  }
  catalogCapabilitiesOutput.textContent = `${annual ? 'Anual' : 'Mensal'} · ${geography} · múltiplos períodos${capabilities.multipleUfs ? ' e UFs' : ''} · ${auxiliary}${requestCount}. A existência de cada arquivo é confirmada somente ao consultar o catálogo oficial.`;
}

function selectedCatalogValues(select: HTMLSelectElement): string[] {
  return [...select.selectedOptions].map((option) => option.value).filter(Boolean);
}

function catalogQueryLabel(query: DatasusSearchQuery): string {
  const coverage = !query.uf || query.uf === 'BR' ? 'Brasil' : query.uf;
  return [query.year, query.month, coverage].filter(Boolean).join(' · ');
}

function renderAvailabilityManifest(manifest: DatasusAvailabilityManifest): void {
  const item = document.createElement('div');
  item.className = 'catalog-availability';
  const summary = document.createElement('b');
  summary.textContent = `${integerFormat.format(manifest.availableQueries)} de ${integerFormat.format(manifest.requestedQueries)} combinação(ões) retornaram arquivo`;
  item.append(summary);
  if (manifest.missingQueries.length) {
    const missing = document.createElement('small');
    const visible = manifest.missingQueries.slice(0, 12).map(catalogQueryLabel);
    const remainder = manifest.missingQueries.length - visible.length;
    missing.textContent = `Sem resultado oficial: ${visible.join('; ')}${remainder ? `; +${integerFormat.format(remainder)}` : ''}. Isso indica ausência na resposta atual, não prova que o dado nunca existiu.`;
    item.append(missing);
  }
  catalogResults.append(item);
}

function renderSourceManifestDownload(
  manifest: DatasusAvailabilityManifest,
  system: string,
  fileType: string,
  currentFiles: readonly DatasusRemoteFile[],
  fallbackQuery: DatasusSearchQuery,
): void {
  const sourceManifest = createSourceManifest(system, fileType, manifest);
  const button = document.createElement('button');
  button.className = 'secondary-button';
  button.type = 'button';
  button.textContent = 'Salvar manifesto da consulta';
  button.title = 'Registra fontes encontradas e ausentes, sem incluir os microdados';
  button.addEventListener('click', () => downloadBlob(
    new Blob([serializeSourceManifest(sourceManifest)], { type: 'application/json;charset=utf-8' }),
    `${system}-${fileType}-${sourceManifest.createdAt.slice(0, 10)}.twmanifest`,
  ));
  catalogResults.append(button);

  const compare = document.createElement('button');
  compare.className = 'secondary-button';
  compare.type = 'button';
  compare.textContent = 'Comparar manifesto anterior';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.twmanifest,application/json';
  input.hidden = true;
  compare.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const output = document.createElement('div');
    output.className = 'catalog-availability';
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Manifesto maior que 5 MB recusado');
      const diff = compareSourceManifests(parseSourceManifest(await file.text()), sourceManifest);
      const summary = document.createElement('b');
      summary.textContent = `${integerFormat.format(diff.addedFiles.length)} arquivo(s) novo(s) · ${integerFormat.format(diff.removedFiles.length)} removido(s) · ${integerFormat.format(diff.unchangedFiles.length)} inalterado(s)`;
      const details = document.createElement('small');
      details.textContent = `${integerFormat.format(diff.newlyAvailableQueries.length)} combinação(ões) passaram a retornar arquivo; ${integerFormat.format(diff.newlyMissingQueries.length)} deixaram de retornar na consulta atual. A comparação não presume a causa.`;
      output.append(summary, details);
      const addedKeys = new Set(diff.addedFiles.map((item) => `${item.address}\n${item.name}`));
      const addedRemotes = currentFiles.filter((item) => addedKeys.has(`${item.address}\n${item.name}`));
      if (addedRemotes.length) {
        const choices = document.createElement('div');
        choices.className = 'catalog-incremental-choices';
        const visible = addedRemotes.slice(0, 500);
        for (const remote of visible) {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = true;
          checkbox.dataset.address = remote.address;
          label.append(checkbox, document.createTextNode(remote.name));
          choices.append(label);
        }
        const download = document.createElement('button');
        download.className = 'secondary-button';
        download.type = 'button';
        download.textContent = 'Baixar novos selecionados';
        download.title = 'Inicia um conjunto novo e só combina fontes com esquema compatível';
        download.addEventListener('click', async () => {
          const selectedAddresses = new Set([...choices.querySelectorAll<HTMLInputElement>('input:checked')].map((item) => item.dataset.address));
          const selected = visible.filter((item) => selectedAddresses.has(item.address));
          if (!selected.length) {
            setCatalogStatus('Selecione ao menos um arquivo novo para baixar.', true);
            return;
          }
          download.disabled = true;
          try {
            await openOfficialFileBatch(selected, fallbackQuery);
          } finally {
            download.disabled = false;
          }
        });
        output.append(choices, download);
        if (addedRemotes.length > visible.length) {
          const limit = document.createElement('small');
          limit.textContent = `A revisão visual foi limitada aos primeiros ${integerFormat.format(visible.length)} arquivos.`;
          output.append(limit);
        }
      }
    } catch (error) {
      output.textContent = error instanceof Error ? error.message : String(error);
    }
    catalogResults.append(output);
  });
  catalogResults.append(compare, input);
}

function initializeCatalog(): void {
  for (const system of DATASUS_SYSTEMS) catalogSystem.add(new Option(system.label, system.code));
  for (let year = new Date().getFullYear(); year >= 1979; year--) catalogYear.add(new Option(String(year), String(year)));
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  monthNames.forEach((name, index) => catalogMonth.add(new Option(name, String(index + 1).padStart(2, '0'))));
  if (catalogYear.options[0]) catalogYear.options[0].selected = true;
  if (catalogMonth.options[0]) catalogMonth.options[0].selected = true;
  populateCatalogFileTypes();
}

async function downloadCatalogEntries(
  files: readonly DatasusRemoteFile[],
  signal?: AbortSignal,
  maxCacheAgeMs = 24 * 60 * 60 * 1000,
  role: CachedArchiveRole = 'data',
): Promise<DownloadedArchive> {
  const cacheKey = `official-v1:${files.map((file) => file.address).sort().join('|')}`;
  let archive: Uint8Array | null = null;
  let summary: CachedArchiveSummary | null = null;
  let cacheHit = false;
  try {
    const cached = await readCachedArchive(cacheKey, maxCacheAgeMs);
    if (cached) {
      archive = cached.bytes;
      summary = cached.summary;
      cacheHit = true;
    }
  } catch {
    // Private browsing or storage policies may disable IndexedDB; acquisition remains usable.
  }
  if (!archive) {
    const preparedUrl = await prepareOfficialDownload(files, signal);
    archive = await fetchOfficialArchive(preparedUrl, signal, ({ receivedBytes, totalBytes }) => {
      const progress = totalBytes
        ? `${Math.min(100, Math.round(receivedBytes / totalBytes * 100))}% · ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`
        : formatBytes(receivedBytes);
      setCatalogStatus(`Baixando ${files.map((file) => file.name).join(', ')}… ${progress}`);
    });
    const archiveSha256 = await sha256(archive);
    try {
      summary = await writeCachedArchive(cacheKey, archive, {
        sha256: archiveSha256,
        role,
        sources: files.map(({ name, address, source, modality, catalogQuery }) => ({
          name, address, source, modality, ...(catalogQuery ? { catalogQuery: { ...catalogQuery } } : {}),
        })),
      });
    } catch {
      // Cache failure is non-fatal and must never block opening public data.
    }
    summary ??= {
      key: cacheKey,
      savedAt: Date.now(),
      size: archive.byteLength,
      sha256: archiveSha256,
      role,
      sources: files.map(({ name, address, source, modality, catalogQuery }) => ({
          name, address, source, modality, ...(catalogQuery ? { catalogQuery: { ...catalogQuery } } : {}),
        })),
    };
  }
  const archiveSha256 = summary?.sha256 || await sha256(archive);
  return {
    files: extractSupportedArchiveFiles(archive),
    provenance: {
      cacheKey,
      cacheHit,
      retrievedAt: new Date(summary?.savedAt ?? Date.now()).toISOString(),
      archiveSha256,
    },
  };
}

async function loadVerifiedAuxiliaries(query: DatasusSearchQuery, signal?: AbortSignal): Promise<number> {
  const definitionName = suggestedDefinitionName(query.system, query.fileType);
  if (!definitionName) return 0;
  setCatalogStatus('Procurando arquivos DEF e CNV oficiais…');
  const remoteAuxiliaries = await searchOfficialAuxiliaries(query.system, signal);
  const bundle = chooseVerifiedAuxiliaryBundle(remoteAuxiliaries, query.system, query.fileType);
  if (!bundle) {
    throw new Error('Nenhum pacote auxiliar com associação verificada foi listado para esta seleção');
  }
  const downloaded = await downloadCatalogEntries([bundle], signal, 7 * 24 * 60 * 60 * 1000, 'auxiliary');
  const definitionEntry = downloaded.files.find(
    (entry) => displayBaseName(entry.name).toUpperCase() === definitionName.toUpperCase(),
  );
  if (!definitionEntry) throw new Error(`${definitionName} não foi encontrado no pacote auxiliar oficial`);

  const definition = parseDef(textDecoder.decode(definitionEntry.bytes));
  const wanted = new Set([definitionName.toUpperCase()]);
  for (const option of definition.options) {
    const resource = option.kind === 'conversion'
      ? option.conversionFile
      : option.kind === 'external-lookup' ? option.resourceFile : '';
    if (extensionOf(resource) === 'CNV') wanted.add(displayBaseName(resource).toUpperCase());
  }
  const selected = downloaded.files.filter((entry) => wanted.has(displayBaseName(entry.name).toUpperCase()));
  for (const entry of selected) await loadFile(archiveFile(entry));
  for (const entry of selected) {
    const source = loadedSources.find((item) => item.name.toLowerCase() === displayBaseName(entry.name).toLowerCase());
    if (source) {
      source.origin = bundle.address;
      source.retrievedAt = downloaded.provenance.retrievedAt;
      source.archiveSha256 = downloaded.provenance.archiveSha256;
      source.cacheKey = downloaded.provenance.cacheKey;
      source.catalogQuery = query;
    }
  }
  return selected.length;
}

function clearManualAuxiliaryPicker(): void {
  catalogAuxiliaryPicker.hidden = true;
  catalogAuxiliaryResults.replaceChildren();
}

function markAuxiliarySource(
  entry: ExtractedArchiveFile,
  bundle: DatasusRemoteFile,
  downloaded: DownloadedArchive,
  catalogQuery?: DatasusSearchQuery,
): void {
  const source = loadedSources.find((item) => item.name.toLowerCase() === displayBaseName(entry.name).toLowerCase());
  if (!source) return;
  source.origin = bundle.address;
  source.retrievedAt = downloaded.provenance.retrievedAt;
  source.archiveSha256 = downloaded.provenance.archiveSha256;
  source.cacheKey = downloaded.provenance.cacheKey;
  source.catalogQuery = catalogQuery;
}

async function inspectManualAuxiliaryBundle(bundle: DatasusRemoteFile, catalogQuery?: DatasusSearchQuery): Promise<void> {
  const controller = new AbortController();
  activeCatalogController = controller;
  setCatalogBusy(true);
  try {
    setCatalogStatus(`Baixando ${bundle.name} para inspecionar os auxiliares…`);
    const downloaded = await downloadCatalogEntries([bundle], controller.signal, 7 * 24 * 60 * 60 * 1000, 'auxiliary');
    const candidates = downloaded.files.filter((entry) => ['DEF', 'CNV'].includes(extensionOf(entry.name)));
    catalogAuxiliaryResults.replaceChildren();
    if (!candidates.length) {
      setCatalogStatus(`${bundle.name} não contém arquivos DEF ou CNV reconhecidos.`, true);
      return;
    }
    for (const entry of candidates) {
      const item = document.createElement('div');
      item.className = 'catalog-result';
      const details = document.createElement('div');
      const name = document.createElement('b');
      const meta = document.createElement('small');
      name.textContent = displayBaseName(entry.name);
      meta.textContent = `${extensionOf(entry.name)} · ${bundle.name}`;
      details.append(name, meta);
      const open = document.createElement('button');
      open.className = 'secondary-button';
      open.type = 'button';
      open.textContent = 'Abrir auxiliar';
      open.addEventListener('click', () => {
        void loadFile(archiveFile(entry))
          .then(() => {
            markAuxiliarySource(entry, bundle, downloaded, catalogQuery);
            renderAudit();
            setCatalogStatus(`${displayBaseName(entry.name)} aberto; escolha outros arquivos se necessário.`);
          })
          .catch((error: unknown) => setCatalogStatus(error instanceof Error ? error.message : String(error), true));
      });
      item.append(details, open);
      catalogAuxiliaryResults.append(item);
    }
    setCatalogStatus(`${integerFormat.format(candidates.length)} auxiliar(es) em ${bundle.name}. Escolha manualmente os arquivos a abrir.`);
  } catch (error) {
    setCatalogStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    if (activeCatalogController === controller) activeCatalogController = null;
    setCatalogBusy(false);
  }
}

function showManualAuxiliaryBundles(bundles: readonly DatasusRemoteFile[], catalogQuery?: DatasusSearchQuery): void {
  catalogAuxiliaryPicker.hidden = false;
  catalogAuxiliaryResults.replaceChildren();
  if (!bundles.length) {
    catalogAuxiliaryResults.textContent = 'O catálogo oficial não listou pacotes auxiliares para este sistema.';
    return;
  }
  for (const bundle of bundles) {
    const item = document.createElement('div');
    item.className = 'catalog-result';
    const details = document.createElement('div');
    const name = document.createElement('b');
    const meta = document.createElement('small');
    name.textContent = bundle.name;
    meta.textContent = `${bundle.source} · ${bundle.modality}`;
    details.append(name, meta);
    const inspect = document.createElement('button');
    inspect.className = 'secondary-button';
    inspect.type = 'button';
    inspect.textContent = 'Inspecionar pacote';
    inspect.addEventListener('click', () => void inspectManualAuxiliaryBundle(bundle, catalogQuery));
    item.append(details, inspect);
    catalogAuxiliaryResults.append(item);
  }
}

async function openOfficialFile(
  remote: DatasusRemoteFile,
  query: DatasusSearchQuery,
  keepDialogOpen = false,
): Promise<OpenOfficialFileResult> {
  const controller = new AbortController();
  activeCatalogController = controller;
  setCatalogBusy(true);
  let timedOut = false;
  let manualAuxiliariesOffered = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 120_000);
  try {
    let auxiliaryCount = 0;
    if (catalogAuxiliary.checked) {
      if (verifiedAuxiliaryBundleName(query.system, query.fileType)) {
        try {
          auxiliaryCount = await loadVerifiedAuxiliaries(query, controller.signal);
        } catch (error) {
          if (isAbortError(error)) throw error;
          showToast(`Auxiliares verificados não carregados: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      } else {
        const bundles = await searchOfficialAuxiliaries(query.system, controller.signal);
        showManualAuxiliaryBundles(bundles, query);
        manualAuxiliariesOffered = true;
        showToast('Não há associação auxiliar comprovada; escolha um pacote oficial manualmente.');
      }
    }
    setCatalogStatus(`Baixando ${remote.name} do DATASUS…`);
    const downloaded = await downloadCatalogEntries([remote], controller.signal);
    const wanted = downloaded.files.find((entry) => displayBaseName(entry.name).toLowerCase() === remote.name.toLowerCase())
      ?? downloaded.files.find((entry) => ['DBC', 'DBF'].includes(extensionOf(entry.name)));
    if (!wanted) throw new Error('O pacote oficial não contém um DBC ou DBF reconhecido');
    await loadFile(archiveFile(wanted));
    const source = loadedSources.find((item) => item.name.toLowerCase() === displayBaseName(wanted.name).toLowerCase());
    if (source) {
      source.origin = remote.address;
      source.retrievedAt = downloaded.provenance.retrievedAt;
      source.archiveSha256 = downloaded.provenance.archiveSha256;
      source.cacheKey = downloaded.provenance.cacheKey;
      source.catalogQuery = remote.catalogQuery ?? query;
    }
    renderAudit();
    setCatalogStatus(manualAuxiliariesOffered
      ? `${remote.name} aberto. Escolha auxiliares manualmente, se precisar.`
      : `${remote.name} aberto${auxiliaryCount ? ` com ${integerFormat.format(auxiliaryCount)} auxiliares` : ''}.`);
    if (!manualAuxiliariesOffered && !keepDialogOpen) catalogDialog.close();
    showToast(downloaded.provenance.cacheHit
      ? `${remote.name} reaberto do cache local`
      : `${remote.name} carregado diretamente do DATASUS`);
    void renderRecentArchives();
    return { ok: true };
  } catch (error) {
    const message = isAbortError(error)
      ? timedOut ? 'O DATASUS demorou mais de 2 minutos para responder. Tente novamente.' : 'Operação cancelada.'
      : error instanceof Error ? error.message : String(error);
    setCatalogStatus(message, !isAbortError(error) || timedOut);
    return { ok: false, error: message };
  } finally {
    window.clearTimeout(timer);
    if (activeCatalogController === controller) activeCatalogController = null;
    setCatalogBusy(false);
  }
}

async function openOfficialFileBatch(files: readonly DatasusRemoteFile[], fallbackQuery: DatasusSearchQuery): Promise<void> {
  const previousCombine = combineCompatibleFiles.checked;
  let opened = 0;
  let failure = '';
  try {
    for (const [index, remote] of files.entries()) {
      combineCompatibleFiles.checked = index > 0;
      const outcome = await openOfficialFile(remote, remote.catalogQuery ?? fallbackQuery, true);
      if (!outcome.ok) {
        failure = outcome.error;
        break;
      }
      opened += 1;
    }
    if (opened === files.length) setCatalogStatus(`${integerFormat.format(opened)} arquivo(s) combinados com esquema compatível.`);
    else if (opened > 0) setCatalogStatus(`Lote interrompido após ${integerFormat.format(opened)} arquivo(s); o conjunto parcial foi preservado. Motivo: ${failure}`, true);
    else if (failure) setCatalogStatus(`Nenhum arquivo foi combinado. Motivo: ${failure}`, true);
  } finally {
    combineCompatibleFiles.checked = previousCombine;
  }
}

async function openRecentArchive(summary: CachedArchiveSummary): Promise<void> {
  setCatalogBusy(true);
  setCatalogStatus('Abrindo o arquivo salvo neste aparelho…');
  try {
    const cached = await readCachedArchive(summary.key, Number.POSITIVE_INFINITY);
    if (!cached) throw new Error('O arquivo não está mais disponível no cache local');
    const extracted = extractSupportedArchiveFiles(cached.bytes);
    const expectedNames = new Set(summary.sources.map((source) => source.name.toLowerCase()));
    const wanted = extracted.find((entry) => expectedNames.has(displayBaseName(entry.name).toLowerCase()))
      ?? extracted.find((entry) => ['DBC', 'DBF'].includes(extensionOf(entry.name)));
    if (!wanted) throw new Error('O pacote salvo não contém um DBC ou DBF reconhecido');
    // Propagate decode/schema failures. The UI-oriented multi-file wrapper
    // intentionally catches errors and would otherwise report a false success.
    await loadFile(archiveFile(wanted));
    const source = loadedSources.find((item) => item.name.toLowerCase() === displayBaseName(wanted.name).toLowerCase());
    if (source) {
      const cachedSource = summary.sources.find((item) => item.name.toLowerCase() === source.name.toLowerCase())
        ?? summary.sources[0];
      if (cachedSource?.address) source.origin = cachedSource.address;
      if (cachedSource?.catalogQuery) source.catalogQuery = { ...cachedSource.catalogQuery };
      source.retrievedAt = new Date(summary.savedAt).toISOString();
      source.archiveSha256 = summary.sha256 || await sha256(cached.bytes);
      source.cacheKey = summary.key;
    }
    renderAudit();
    setCatalogStatus(`${displayBaseName(wanted.name)} aberto sem usar a internet.`);
    catalogDialog.close();
    showToast(`${displayBaseName(wanted.name)} reaberto do cache local`);
  } catch (error) {
    setCatalogStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setCatalogBusy(false);
  }
}

async function renderRecentArchives(): Promise<void> {
  catalogRecentList.replaceChildren();
  catalogRecentSummary.textContent = 'Verificando o armazenamento local…';
  try {
    const archives = await listCachedArchives();
    const totalBytes = archives.reduce((sum, archive) => sum + archive.size, 0);
    const dataCount = archives.filter((archive) => archive.role === 'data').length;
    catalogRecentSummary.textContent = archives.length
      ? `${integerFormat.format(dataCount)} arquivo(s) de dados · ${formatBytes(totalBytes)} em ${integerFormat.format(archives.length)} pacote(s)`
      : 'Nenhum download oficial salvo neste aparelho.';
    catalogCacheClear.disabled = archives.length === 0;

    for (const archive of archives) {
      const item = document.createElement('div');
      item.className = 'catalog-result catalog-recent-item';
      const details = document.createElement('div');
      const name = document.createElement('b');
      const meta = document.createElement('small');
      const sourceNames = archive.sources.map((source) => source.name).join(', ');
      name.textContent = sourceNames || (archive.role === 'auxiliary' ? 'Pacote auxiliar oficial' : 'Arquivo oficial salvo');
      meta.textContent = `${archive.role === 'auxiliary' ? 'Auxiliares' : 'Dados'} · ${formatBytes(archive.size)} · ${new Date(archive.savedAt).toLocaleString('pt-BR')}`;
      details.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'catalog-recent-actions';
      if (archive.role === 'data') {
        const open = document.createElement('button');
        open.className = 'secondary-button';
        open.type = 'button';
        open.textContent = 'Abrir offline';
        open.addEventListener('click', () => void openRecentArchive(archive));
        actions.append(open);
      }
      const remove = document.createElement('button');
      remove.className = 'text-button danger-text-button';
      remove.type = 'button';
      remove.textContent = 'Remover';
      remove.addEventListener('click', () => {
        remove.disabled = true;
        void deleteCachedArchive(archive.key)
          .then(() => renderRecentArchives())
          .catch((error: unknown) => setCatalogStatus(error instanceof Error ? error.message : String(error), true));
      });
      actions.append(remove);
      item.append(details, actions);
      catalogRecentList.append(item);
    }
  } catch (error) {
    catalogRecentSummary.textContent = 'O armazenamento local não está disponível neste navegador.';
    catalogCacheClear.disabled = true;
    setCatalogStatus(error instanceof Error ? error.message : String(error), true);
  }
}

async function searchCatalog(): Promise<void> {
  const type = fileTypesForSystem(catalogSystem.value).find((item) => item.code === catalogFileType.value);
  if (!type) return;
  const selection = {
    system: catalogSystem.value,
    fileType: catalogFileType.value,
    years: selectedCatalogValues(catalogYear),
    ...(!systemIsAnnual(catalogSystem.value)
      ? { months: selectedCatalogValues(catalogMonth) }
      : { annual: true }),
    ...(selectedCatalogValues(catalogUf).length ? { ufs: selectedCatalogValues(catalogUf) } : {}),
  };
  catalogResults.replaceChildren();
  clearManualAuxiliaryPicker();
  setCatalogStatus('Consultando o catálogo oficial…');
  const controller = new AbortController();
  activeCatalogController = controller;
  setCatalogBusy(true);
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60_000);
  try {
    const queries = expandDatasusSearchSelection(selection);
    const batch = await searchOfficialCatalogBatch(queries, controller.signal);
    const files = batch.files;
    renderAvailabilityManifest(batch.availability);
    const auxiliaryQuery = queries[0];
    if (!auxiliaryQuery) throw new Error('Selecione ao menos um período e uma cobertura para consultar o catálogo.');
    renderSourceManifestDownload(batch.availability, selection.system, selection.fileType, files, auxiliaryQuery);
    if (!files.length) {
      setCatalogStatus('Nenhum arquivo encontrado para essa combinação. O período pode ainda não ter sido publicado.');
      return;
    }
    setCatalogStatus(`${integerFormat.format(files.length)} arquivo(s) encontrado(s) em ${integerFormat.format(batch.availability.availableQueries)} de ${integerFormat.format(batch.availability.requestedQueries)} combinação(ões).`);
    if (files.length > 1) {
      const openAll = document.createElement('button');
      openAll.className = 'secondary-button';
      openAll.type = 'button';
      openAll.textContent = 'Baixar e combinar todos';
      openAll.title = 'O primeiro arquivo inicia um conjunto novo; os demais só entram se o esquema for compatível';
      openAll.addEventListener('click', async () => {
        openAll.disabled = true;
        try {
          await openOfficialFileBatch(files, auxiliaryQuery);
        } finally {
          openAll.disabled = false;
        }
      });
      catalogResults.append(openAll);
    }
    for (const remote of files) {
      const item = document.createElement('div');
      item.className = 'catalog-result';
      const details = document.createElement('div');
      const name = document.createElement('b');
      const meta = document.createElement('small');
      name.textContent = remote.name;
      meta.textContent = `${remote.source} · ${remote.modality}`;
      details.append(name, meta);
      const button = document.createElement('button');
      button.className = 'secondary-button';
      button.type = 'button';
      button.textContent = 'Baixar e abrir';
      button.addEventListener('click', () => void openOfficialFile(remote, remote.catalogQuery ?? auxiliaryQuery));
      item.append(details, button);
      catalogResults.append(item);
    }
  } catch (error) {
    const message = isAbortError(error)
      ? timedOut ? 'O catálogo DATASUS demorou para responder. Tente novamente.' : 'Consulta cancelada.'
      : error instanceof Error ? error.message : String(error);
    setCatalogStatus(message, !isAbortError(error) || timedOut);
  } finally {
    window.clearTimeout(timer);
    if (activeCatalogController === controller) activeCatalogController = null;
    setCatalogBusy(false);
  }
}

function showView(view: ViewName): void {
  currentView = view;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.classList.toggle('active', button.dataset.view === view);
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    const active = panel.dataset.panel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  }
  if (view === 'map') void ensureMap();
}

function exportBaseName(): string {
  const field = currentPlan?.spec.rows.field || 'tabela';
  return `${datasetName.replace(/\.[^.]+$/, '')}-${field.toLowerCase()}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function conversionNameInRegistry(id: string): string | null {
  return [...cnvByName.keys()].find((name) => baseName(name) === baseName(id)) ?? null;
}

function saveRecipe(): void {
  if (!currentPlan || !activeDatasetSources.length) return;
  const conversionIds = new Set<string>();
  if (currentPlan.spec.rows.conversionId) conversionIds.add(currentPlan.spec.rows.conversionId);
  if (currentPlan.spec.columns?.conversionId) conversionIds.add(currentPlan.spec.columns.conversionId);
  for (const filter of currentPlan.spec.filters) if (filter.conversionId) conversionIds.add(filter.conversionId);
  const conversions = [...conversionIds].map((id) => {
    const source = loadedSources.find((item) => baseName(item.name) === baseName(id));
    if (!source) throw new Error(`Não foi possível localizar a impressão digital de ${id}`);
    return { id, name: source.name, sha256: source.sha256, size: source.size };
  });
  const recipe: AnalysisRecipeV1 = {
    schema: 'tabwin-web.recipe',
    version: 1,
    name: resultTitle.textContent ?? `Análise ${rowField.value}`,
    spec: currentPlan.spec,
    conversions,
    sourceHints: activeDatasetSources.map((source) => ({
      name: source.name,
      sha256: source.sha256,
      size: source.size,
      ...(source.origin ? { sourceUrl: source.origin } : {}),
      ...(source.retrievedAt ? { retrievedAt: source.retrievedAt } : {}),
      ...(source.archiveSha256 ? { archiveSha256: source.archiveSha256 } : {}),
    })),
    ...(tableOperations.length ? { resultOperations: tableOperations } : {}),
    view: {
      chartType: chartType.value as ChartType,
      mapClassification: mapClassification.value as MapClassification,
      mapClassCount: Number(mapClassCount.value),
      mapPalette: mapPalette.value as MapPalette,
      statisticsOperation: statisticsOperation.value as 'descriptive' | 'correlation' | 'regression' | 'histogram',
      ...(currentResult?.columns[Number(statisticsX.value)]?.key
        ? { statisticsXColumnKey: currentResult.columns[Number(statisticsX.value)]!.key }
        : {}),
      ...(currentResult?.columns[Number(statisticsY.value)]?.key
        ? { statisticsYColumnKey: currentResult.columns[Number(statisticsY.value)]!.key }
        : {}),
      histogramBins: Math.min(50, Math.max(1, Math.round(Number(histogramBins.value) || 8))),
      tableSortColumnKey: tableSortColumn.value,
      tableSortDirection: tableSortDirection.value as 'original' | 'ascending' | 'descending',
      tableDecimalPlaces: Number(tableDecimals.value),
      tableKeyVisible: tableKeyVisible.checked,
      tableTitle: tableTitle.value.trim(),
      tableSubtitle: tableSubtitle.value.trim(),
      tableFooter: tableFooter.value.trim(),
    },
  };
  downloadBlob(
    new Blob([serializeRecipe(recipe)], { type: 'application/json;charset=utf-8' }),
    `${exportBaseName()}.twrecipe`,
  );
}

function savePortableTable(): void {
  if (!currentPlan || !baseResult || !currentResult) return;
  const table: PortableTableV1 = {
    schema: 'tabwin-web.table',
    version: 1,
    title: tableTitle.value.trim() || resultTitle.textContent?.trim() || `Tabela ${currentPlan.spec.rows.field}`,
    rowLabel: activeRowLabel(),
    createdAt: new Date().toISOString(),
    ...(datasetFingerprint ? { source: {
      name: datasetFingerprint.name,
      sha256: datasetFingerprint.sha256,
      size: datasetFingerprint.size,
    } } : {}),
    plan: currentPlan,
    baseResult,
    operations: tableOperations,
    presentation: {
      sortColumnKey: tableSortColumn.value,
      sortDirection: tableSortDirection.value as 'original' | 'ascending' | 'descending',
      decimalPlaces: Number(tableDecimals.value),
      keyVisible: tableKeyVisible.checked,
      subtitle: tableSubtitle.value.trim(),
      footer: tableFooter.value.trim(),
    },
  };
  downloadBlob(
    new Blob([serializePortableTable(table)], { type: 'application/json;charset=utf-8' }),
    `${exportBaseName()}.twtable`,
  );
}

function renderPortableTableStats(table: PortableTableV1): void {
  const values: Array<readonly [string, string]> = [
    [integerFormat.format(table.baseResult.recordsAccepted), 'registros aceitos'],
    [integerFormat.format(table.baseResult.rows.length), 'linhas salvas'],
    [integerFormat.format(table.baseResult.columns.length), 'colunas base'],
    [integerFormat.format(table.operations.length), 'operações reproduzidas'],
  ];
  datasetStats.replaceChildren();
  for (const [value, label] of values) {
    const item = document.createElement('div');
    const strong = document.createElement('b');
    const caption = document.createElement('span');
    strong.textContent = value;
    caption.textContent = label;
    item.append(strong, caption);
    datasetStats.append(item);
  }
  datasetStats.style.display = 'grid';
  datasetStats.hidden = false;
}

async function openPortableTable(file: File): Promise<void> {
  const table = parsePortableTable(await file.text());
  disposeDatasetWorker();
  datasetRecordCount = 0;
  dbfHeader = null;
  currentDatasetFile = null;
  currentCompatibilityProfile = table.plan.spec.compatibilityProfile;
  sourceDbfButton.disabled = true;
  selectedDbfButton.disabled = true;
  configuredFilters = [];
  activeDef = null;
  activeMap = null;
  mapNameByGeocode.clear();
  activeMapSource = '';
  cnvByName.clear();
  loadedSources.splice(0, loadedSources.length);
  activeDatasetSources.splice(0, activeDatasetSources.length);
  datasetName = table.source?.name ?? file.name;
  datasetFingerprint = table.source ? {
    ...table.source,
    extension: extensionOf(table.source.name) || 'SOURCE',
    origin: `Tabela portátil ${file.name}`,
  } : null;
  if (datasetFingerprint) {
    rememberSource(datasetFingerprint);
    activeDatasetSources.push(datasetFingerprint);
  }
  else renderFileList();
  currentPlan = table.plan;
  baseResult = structuredClone(table.baseResult);
  tableOperations = table.operations.map((operation) => structuredClone(operation));
  currentResult = replayTableOperations(baseResult, tableOperations);
  currentRowLabel = table.rowLabel;
  rowField.replaceChildren(new Option(table.rowLabel, table.plan.spec.rows.field));
  rowField.value = table.plan.spec.rows.field;
  columnField.replaceChildren(new Option('Resultado salvo', ''));
  resultKicker.textContent = `${file.name} · tabela portátil`;
  resultTitle.textContent = table.title;
  tableTitle.value = table.title;
  tableSubtitle.value = table.presentation?.subtitle ?? '';
  tableFooter.value = table.presentation?.footer ?? '';
  if (table.presentation) {
    tableSortDirection.value = table.presentation.sortDirection;
    tableDecimals.value = String(table.presentation.decimalPlaces);
    tableKeyVisible.checked = table.presentation.keyVisible;
  }
  renderResult();
  if (table.presentation?.sortColumnKey
    && [...tableSortColumn.options].some((option) => option.value === table.presentation?.sortColumnKey)) {
    tableSortColumn.value = table.presentation.sortColumnKey;
    renderTable(currentResult);
  }
  renderPortableTableStats(table);
  setControlsEnabled(false);
  saveRecipeButton.disabled = true;
  saveTableButton.disabled = false;
  exportCsvButton.disabled = false;
  exportXlsxButton.disabled = false;
  exportXmlButton.disabled = false;
  chartPngButton.disabled = false;
  chartSvgButton.disabled = false;
  if (table.plan.spec.rows.field.toUpperCase().includes('MUNIC')) await ensureMap();
  showToast(`${file.name}: tabela aberta sem precisar do DBC original`);
}

async function includePortableTable(file: File): Promise<void> {
  if (!currentResult) throw new Error('Gere ou abra uma tabela antes de incluir outra');
  const table = parsePortableTable(await file.text());
  const included = replayTableOperations(table.baseResult, table.operations);
  const operation = createIncludeTableOperation(currentResult, included, table.title || file.name);
  commitTableOperation(operation);
}

async function openRecipe(file: File): Promise<void> {
  if (!dbfHeader || !activeDatasetSources.length) throw new Error('Abra um DBC ou DBF antes de aplicar a análise');
  const recipe = parseRecipe(await file.text());
  const fields = new Set(dbfHeader.fields.map((field) => field.name));
  const requiredFields = [
    recipe.spec.rows.field,
    recipe.spec.columns?.field,
    recipe.spec.measure.field,
    ...recipe.spec.filters.map((filter) => filter.field),
  ].filter((field): field is string => Boolean(field));
  const missing = requiredFields.filter((field) => !fields.has(field));
  if (missing.length) throw new Error(`O arquivo atual não possui: ${[...new Set(missing)].join(', ')}`);

  rowField.value = recipe.spec.rows.field;
  columnField.value = recipe.spec.columns?.field ?? '';
  measureKind.value = recipe.spec.measure.kind;
  if (recipe.spec.measure.field) measureField.value = recipe.spec.measure.field;
  suppressZero.checked = recipe.spec.suppressZeroRows ?? false;
  suppressZeroColumns.checked = recipe.spec.suppressZeroColumns ?? false;
  discriminateUnclassified.checked = recipe.spec.rows.unclassifiedPolicy === 'discriminate';
  discriminateColumnUnclassified.checked = recipe.spec.columns?.unclassifiedPolicy === 'discriminate';
  if (recipe.view?.chartType) chartType.value = recipe.view.chartType;
  if (recipe.view?.mapClassification) mapClassification.value = recipe.view.mapClassification;
  if (recipe.view?.mapClassCount) mapClassCount.value = String(recipe.view.mapClassCount);
  if (recipe.view?.mapPalette) mapPalette.value = recipe.view.mapPalette;
  if (recipe.view?.statisticsOperation) statisticsOperation.value = recipe.view.statisticsOperation;
  if (recipe.view?.histogramBins) histogramBins.value = String(recipe.view.histogramBins);
  if (recipe.view?.tableSortDirection) tableSortDirection.value = recipe.view.tableSortDirection;
  if (recipe.view?.tableDecimalPlaces !== undefined) tableDecimals.value = String(recipe.view.tableDecimalPlaces);
  if (recipe.view?.tableKeyVisible !== undefined) tableKeyVisible.checked = recipe.view.tableKeyVisible;
  mapClassCount.disabled = mapClassification.value === 'continuous';
  rowConversion.value = '';
  if (recipe.spec.rows.conversionId) {
    const loaded = conversionNameInRegistry(recipe.spec.rows.conversionId);
    if (!loaded) throw new Error(`Carregue a conversão ${displayBaseName(recipe.spec.rows.conversionId)} antes de abrir esta análise`);
    rowConversion.value = loaded;
    startPosition.value = String(recipe.spec.rows.startPosition ?? 1);
  }
  columnConversion.value = '';
  if (recipe.spec.columns?.conversionId) {
    const loaded = conversionNameInRegistry(recipe.spec.columns.conversionId);
    if (!loaded) throw new Error(`Carregue a conversão ${displayBaseName(recipe.spec.columns.conversionId)} antes de abrir esta análise`);
    columnConversion.value = loaded;
    columnStartPosition.value = String(recipe.spec.columns.startPosition ?? 1);
  }
  configuredFilters = recipe.spec.filters.map((filter) => {
    if (filter.kind === 'numeric-range') return { ...filter };
    if (!filter.conversionId) return cloneFilter(filter);
    const loaded = conversionNameInRegistry(filter.conversionId);
    if (!loaded) throw new Error(`Carregue a conversão ${displayBaseName(filter.conversionId)} antes de abrir esta análise`);
    return { ...filter, conversionId: loaded, acceptedCategories: [...filter.acceptedCategories] };
  });
  renderConfiguredFilters();
  updateMeasureControls();
  updateColumnControls();
  await runAnalysis();
  if (recipe.view?.tableTitle !== undefined) {
    tableTitle.value = recipe.view.tableTitle;
    resultTitle.textContent = recipe.view.tableTitle || activeRowLabel();
  }
  if (recipe.view?.tableSubtitle !== undefined) tableSubtitle.value = recipe.view.tableSubtitle;
  if (recipe.view?.tableFooter !== undefined) tableFooter.value = recipe.view.tableFooter;
  if (recipe.resultOperations?.length && baseResult) {
    tableOperations = recipe.resultOperations.map((operation) => structuredClone(operation));
    currentResult = replayTableOperations(baseResult, tableOperations);
    renderResult();
  }
  else if (currentResult) renderResult();
  if (recipe.view?.tableSortColumnKey
    && [...tableSortColumn.options].some((option) => option.value === recipe.view?.tableSortColumnKey)) {
    tableSortColumn.value = recipe.view.tableSortColumnKey;
    if (currentResult) renderTable(currentResult);
  }
  if (currentResult) {
    const xIndex = currentResult.columns.findIndex((column) => column.key === recipe.view?.statisticsXColumnKey);
    const yIndex = currentResult.columns.findIndex((column) => column.key === recipe.view?.statisticsYColumnKey);
    if (xIndex >= 0) statisticsX.value = String(xIndex);
    if (yIndex >= 0) statisticsY.value = String(yIndex);
    renderStatistics();
  }
  const expectedSources = recipe.sourceHints
    .map((hint) => `${hint.sha256}:${hint.size}`)
    .sort();
  const actualSources = activeDatasetSources
    .map((source) => `${source.sha256}:${source.size}`)
    .sort();
  const sameSource = expectedSources.length === actualSources.length
    && expectedSources.every((fingerprint, index) => fingerprint === actualSources[index]);
  showToast(sameSource
    ? `${file.name}: análise reproduzida`
    : `${file.name}: análise aplicada a uma fonte diferente da original`);
}

function exportCsv(): void {
  if (!currentResult) return;
  const csv = tabulationToCsv(currentResult, {
    sourceName: datasetName,
    rowLabel: activeRowLabel(),
  });
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${exportBaseName()}.csv`);
}

function exportXml(): void {
  if (!currentResult) return;
  const xml = tabulationToXml(currentResult, {
    sourceName: datasetName,
    rowLabel: activeRowLabel(),
  });
  downloadBlob(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `${exportBaseName()}.xml`);
}

function exportXlsx(): void {
  if (!currentResult) return;
  const bytes = tabulationToXlsx(currentResult, {
    sourceName: datasetName,
    rowLabel: activeRowLabel(),
  });
  downloadBlob(new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), `${exportBaseName()}.xlsx`);
}

async function copyPresentedTable(): Promise<void> {
  if (!currentResult) return;
  const tsv = tableRowsToTsv(currentResult, currentTableRowIndexes(), {
    rowLabel: activeRowLabel(),
    includeKey: tableKeyVisible.checked,
  });
  await navigator.clipboard.writeText(tsv);
  showToast(`${integerFormat.format(currentTableRowIndexes().length)} linhas copiadas`);
}

function exportMapPng(): void {
  if (!activeMap || !currentResult) return;
  mapCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${exportBaseName()}-mapa.png`);
  }, 'image/png');
}

function updateMapZoom(next: number): void {
  mapZoom = Math.min(8, Math.max(1, next));
  if (mapZoom === 1) {
    mapPanX = 0;
    mapPanY = 0;
  }
  if (activeMap && currentResult) renderMap();
}

function canvasPointer(event: PointerEvent | WheelEvent): { x: number; y: number } {
  const bounds = mapCanvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function showMapTooltip(event: PointerEvent): void {
  if (mapDrag) return;
  const point = canvasPointer(event);
  const object = objectAtCanvasPoint(point.x, point.y);
  if (!object) {
    mapTooltip.hidden = true;
    return;
  }
  const value = lastMapValues.get(object);
  mapTooltip.textContent = `${object.name || object.geocode} · ${value === undefined ? 'sem valor associado' : numberFormat.format(value)}`;
  mapTooltip.style.left = `${Math.min(point.x + 12, mapCanvas.clientWidth - 240)}px`;
  mapTooltip.style.top = `${Math.max(8, point.y - 34)}px`;
  mapTooltip.hidden = false;
}

function serializedChartSvg(): string | null {
  const svg = chart.querySelector<SVGSVGElement>('svg');
  if (!svg) return null;
  return new XMLSerializer().serializeToString(svg);
}

function exportChartSvg(): void {
  const svg = serializedChartSvg();
  if (!svg) return;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${exportBaseName()}-${chartType.value}.svg`);
}

async function exportChartPng(): Promise<void> {
  const svg = serializedChartSvg();
  if (!svg) return;
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(source);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Não foi possível rasterizar o gráfico'));
    image.src = sourceUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 2000;
  canvas.height = 1000;
  const context = canvas.getContext('2d');
  if (!context) {
    URL.revokeObjectURL(sourceUrl);
    return;
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(sourceUrl);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${exportBaseName()}-${chartType.value}.png`);
  }, 'image/png');
}

fileInput.addEventListener('change', () => void loadFiles([...fileInput.files ?? []]));
sourceDbfButton.addEventListener('click', () => void downloadSourceDbf().catch((error) =>
  showToast(error instanceof Error ? error.message : String(error), true)));
selectedDbfButton.addEventListener('click', () => void downloadSelectedDbf().catch((error) =>
  showToast(error instanceof Error ? error.message : String(error), true)));
decodeCancelButton.addEventListener('click', () => activeDecode?.cancel());
for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
dropZone.addEventListener('drop', (event) => {
  const files = event.dataTransfer?.files;
  if (files) void loadFiles([...files]);
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void runAnalysis();
});
rowField.addEventListener('change', () => {
  applyDefDefaults();
  void runAnalysis();
});
fieldSearch.addEventListener('input', searchDimensionFields);
columnField.addEventListener('change', () => {
  applyDefDefaults();
  updateColumnControls();
  void runAnalysis();
});
rowConversion.addEventListener('change', () => void runAnalysis());
columnConversion.addEventListener('change', () => void runAnalysis());
startPosition.addEventListener('change', () => void runAnalysis());
columnStartPosition.addEventListener('change', () => void runAnalysis());
measureKind.addEventListener('change', () => {
  updateMeasureControls();
  if (measureKind.value === 'count' || measureField.value) void runAnalysis();
});
measureField.addEventListener('change', () => void runAnalysis());
filterField.addEventListener('change', () => void populateFilterValues());
filterKind.addEventListener('change', () => void populateFilterValues());
filterValueSearch.addEventListener('input', searchFilterValues);
filterMode.addEventListener('change', updateFilterCount);
qualityField.addEventListener('change', () => {
  qualityMinimum.value = '';
  qualityMaximum.value = '';
  updateQualityProfile();
});
for (const control of [qualityMinimum, qualityMaximum]) control.addEventListener('input', updateQualityApplyState);
qualitySuggestButton.addEventListener('click', suggestQualityRange);
qualityApplyButton.addEventListener('click', () => {
  try { applyQualityRange(); }
  catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
for (const control of [filterMinimum, filterMaximum, filterIncludeMinimum, filterIncludeMaximum]) {
  control.addEventListener('input', updateFilterCount);
  control.addEventListener('change', updateFilterCount);
}
addFilterButton.addEventListener('click', addConfiguredFilter);
selectAllFilterButton.addEventListener('click', () => {
  for (const option of filterValues.querySelectorAll<HTMLElement>('.filter-option:not([hidden])')) {
    const input = option.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (input) input.checked = true;
  }
  updateFilterCount();
});
clearFilterButton.addEventListener('click', () => {
  for (const input of filterValues.querySelectorAll<HTMLInputElement>('input:checked')) input.checked = false;
  updateFilterCount();
  void runAnalysis();
});
openRecipeButton.addEventListener('click', () => recipeInput.click());
openTableButton.addEventListener('click', () => tableInput.click());
includeTableButton.addEventListener('click', () => includeTableInput.click());
saveRecipeButton.addEventListener('click', () => {
  try {
    saveRecipe();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
});
recipeInput.addEventListener('change', () => {
  const file = recipeInput.files?.[0];
  if (!file) return;
  void openRecipe(file).catch((error) => showToast(error instanceof Error ? error.message : String(error), true));
  recipeInput.value = '';
});
saveTableButton.addEventListener('click', () => {
  try { savePortableTable(); }
  catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
tableInput.addEventListener('change', () => {
  const file = tableInput.files?.[0];
  if (!file) return;
  void openPortableTable(file).catch((error) => showToast(error instanceof Error ? error.message : String(error), true));
  tableInput.value = '';
});
includeTableInput.addEventListener('change', () => {
  const file = includeTableInput.files?.[0];
  if (!file) return;
  void includePortableTable(file).catch((error) => showToast(error instanceof Error ? error.message : String(error), true));
  includeTableInput.value = '';
});
suppressZero.addEventListener('change', () => void runAnalysis());
suppressZeroColumns.addEventListener('change', () => void runAnalysis());
discriminateUnclassified.addEventListener('change', () => void runAnalysis());
discriminateColumnUnclassified.addEventListener('change', () => void runAnalysis());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => showView(button.dataset.view as ViewName));
}
exportCsvButton.addEventListener('click', exportCsv);
exportXlsxButton.addEventListener('click', exportXlsx);
exportXmlButton.addEventListener('click', exportXml);
tableOperationKind.addEventListener('change', updateTableOperationControls);
tableOperationApply.addEventListener('click', () => {
  try {
    applySelectedTableOperation();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
});
tableOperationUndo.addEventListener('click', () => restoreTableOperations(tableOperations.length - 1));
tableOperationReset.addEventListener('click', () => restoreTableOperations(0));
for (const control of [tableSortColumn, tableSortDirection, tableDecimals, tableKeyVisible]) {
  control.addEventListener('change', () => {
    if (currentResult) renderTable(currentResult);
    renderAudit();
  });
}
for (const control of [tableTitle, tableSubtitle, tableFooter]) {
  control.addEventListener('input', () => {
    if (control === tableTitle) resultTitle.textContent = tableTitle.value.trim() || activeRowLabel();
    if (currentResult) {
      renderTable(currentResult);
      renderChart(currentResult);
      renderAudit();
    }
  });
}
tableLocate.addEventListener('input', () => {
  if (currentResult) renderTable(currentResult);
  updateRowEditButtons();
});
tableCopy.addEventListener('click', () => void copyPresentedTable().catch((error) =>
  showToast(error instanceof Error ? error.message : String(error), true)));
tablePrint.addEventListener('click', () => window.print());
tableEditColumn.addEventListener('change', updateColumnEditButtons);
tableColumnRename.addEventListener('click', () => {
  try {
    commitTableOperation({ kind: 'rename-column', columnKey: tableEditColumn.value, label: tableEditColumnLabel.value });
    tableEditColumnLabel.value = '';
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
tableColumnLeft.addEventListener('click', () => {
  try { commitTableOperation({ kind: 'move-column', columnKey: tableEditColumn.value, direction: 'left' }); }
  catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
tableColumnRight.addEventListener('click', () => {
  try { commitTableOperation({ kind: 'move-column', columnKey: tableEditColumn.value, direction: 'right' }); }
  catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
tableColumnDelete.addEventListener('click', () => {
  try { commitTableOperation({ kind: 'delete-column', columnKey: tableEditColumn.value }); }
  catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
tableTranspose.addEventListener('click', () => {
  try { commitTableOperation({ kind: 'transpose' }); }
  catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
tableRowSuppress.addEventListener('click', () => {
  try {
    commitTableOperation({ kind: 'suppress-rows', rowKeys: locatedRowKeys() });
    tableLocate.value = '';
    if (currentResult) renderTable(currentResult);
    updateRowEditButtons();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
tableRowAggregate.addEventListener('click', () => {
  try {
    const rowKeys = locatedRowKeys();
    const label = tableAggregateLabel.value.trim() || `Agregação de ${rowKeys.length} linhas`;
    const removeSources = tableAggregateRemove.checked;
    commitTableOperation({
      kind: 'aggregate-rows', rowKeys,
      outputRow: { key: `__aggregate_${tableOperations.length + 1}`, label, excludeFromTotal: !removeSources },
      removeSources,
    });
    tableLocate.value = '';
    tableAggregateLabel.value = '';
    if (currentResult) renderTable(currentResult);
    updateRowEditButtons();
  } catch (error) { showToast(error instanceof Error ? error.message : String(error), true); }
});
chartType.addEventListener('change', () => {
  if (currentResult) renderChart(currentResult);
});
for (const control of [statisticsOperation, statisticsX, statisticsY, histogramBins]) {
  control.addEventListener('change', renderStatistics);
}
chartSvgButton.addEventListener('click', exportChartSvg);
chartPngButton.addEventListener('click', () => void exportChartPng().catch((error) =>
  showToast(error instanceof Error ? error.message : String(error), true)));
mapPngButton.addEventListener('click', exportMapPng);
for (const control of [mapClassification, mapClassCount, mapPalette]) {
  control.addEventListener('change', () => {
    mapClassCount.disabled = mapClassification.value === 'continuous';
    if (activeMap && currentResult) renderMap();
  });
}
mapClassCount.disabled = mapClassification.value === 'continuous';
mapZoomOut.addEventListener('click', () => updateMapZoom(mapZoom / 1.5));
mapZoomReset.addEventListener('click', () => updateMapZoom(1));
mapZoomIn.addEventListener('click', () => updateMapZoom(mapZoom * 1.5));
mapCanvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  updateMapZoom(mapZoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
}, { passive: false });
mapCanvas.addEventListener('pointerdown', (event) => {
  const point = canvasPointer(event);
  mapDrag = { pointerId: event.pointerId, x: point.x, y: point.y };
  mapCanvas.setPointerCapture(event.pointerId);
  mapTooltip.hidden = true;
});
mapCanvas.addEventListener('pointermove', (event) => {
  if (!mapDrag || mapDrag.pointerId !== event.pointerId) {
    showMapTooltip(event);
    return;
  }
  const point = canvasPointer(event);
  mapPanX += point.x - mapDrag.x;
  mapPanY += point.y - mapDrag.y;
  mapDrag = { ...mapDrag, x: point.x, y: point.y };
  if (activeMap && currentResult) renderMap();
});
mapCanvas.addEventListener('pointerup', (event) => {
  if (mapDrag?.pointerId === event.pointerId) mapDrag = null;
  mapCanvas.releasePointerCapture(event.pointerId);
  showMapTooltip(event);
});
mapCanvas.addEventListener('pointercancel', () => { mapDrag = null; });
mapCanvas.addEventListener('pointerleave', () => { if (!mapDrag) mapTooltip.hidden = true; });
element<HTMLButtonElement>('#about-button').addEventListener('click', () => aboutDialog.showModal());
element<HTMLButtonElement>('#dialog-close').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});
element<HTMLButtonElement>('#catalog-button').addEventListener('click', () => {
  catalogDialog.showModal();
  void renderRecentArchives();
});
element<HTMLButtonElement>('#catalog-close').addEventListener('click', () => catalogDialog.close());
catalogDialog.addEventListener('click', (event) => {
  if (event.target === catalogDialog) catalogDialog.close();
});
catalogSystem.addEventListener('change', populateCatalogFileTypes);
catalogFileType.addEventListener('change', updateCatalogGeography);
for (const control of [catalogYear, catalogMonth, catalogUf]) control.addEventListener('change', renderCatalogCapabilities);
catalogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void searchCatalog();
});
catalogCancelButton.addEventListener('click', () => {
  if (!activeCatalogController) return;
  catalogCancelButton.disabled = true;
  setCatalogStatus('Cancelando a operação…');
  activeCatalogController.abort();
});
catalogCacheClear.addEventListener('click', () => {
  if (!window.confirm('Remover todos os downloads oficiais salvos neste aparelho?')) return;
  catalogCacheClear.disabled = true;
  void clearCachedArchives()
    .then(() => {
      setCatalogStatus('Cache local removido. Os arquivos poderão ser baixados novamente do DATASUS.');
      return renderRecentArchives();
    })
    .catch((error: unknown) => setCatalogStatus(error instanceof Error ? error.message : String(error), true));
});
window.addEventListener('resize', () => {
  if (currentView === 'map' && activeMap) renderMap();
});
initializeCatalog();
