import {
  dbcToDbf,
  readDbcMetadata,
  readDbfHeader,
  readDbfRecords,
  type DbfHeader,
  type DbfRecord,
} from '@precisa-saude/datasus-dbc';
import {
  compileQueryPlan,
  executeInMemory,
  parseRecipe,
  serializeRecipe,
  type AnalysisRecipeV1,
  type FilterSpec,
  type QueryPlan,
  type TabulationResult,
} from '../../../packages/core/src/index.ts';
import {
  optionsForRole,
  parseCnv,
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
  fileTypesForSystem,
  systemIsAnnual,
  type DatasusRemoteFile,
  type DatasusSearchQuery,
} from '../../../packages/acquisition/src/datasus.ts';
import { tabulationToCsv, tabulationToXml } from '../../../packages/export/src/tabulation.ts';
import {
  chooseCurrentAuxiliaryBundle,
  extractSupportedArchiveFiles,
  fetchOfficialArchive,
  prepareOfficialDownload,
  searchOfficialAuxiliaries,
  searchOfficialFiles,
  suggestedDefinitionName,
  type ExtractedArchiveFile,
} from './datasus-client.ts';
import { readCachedArchive, writeCachedArchive } from './archive-cache.ts';
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
import './styles.css';

type ViewName = 'table' | 'chart' | 'map' | 'statistics' | 'audit';

interface LoadedSource {
  name: string;
  extension: string;
  size: number;
  sha256: string;
  origin?: string;
}

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
const form = element<HTMLFormElement>('#analysis-form');
const rowField = element<HTMLSelectElement>('#row-field');
const columnField = element<HTMLSelectElement>('#column-field');
const rowConversion = element<HTMLSelectElement>('#row-conversion');
const measureKind = element<HTMLSelectElement>('#measure-kind');
const measureField = element<HTMLSelectElement>('#measure-field');
const measureFieldLabel = element<HTMLElement>('#measure-field-label');
const filterField = element<HTMLSelectElement>('#filter-field');
const filterValues = element<HTMLElement>('#filter-values');
const filterInfo = element<HTMLElement>('#filter-info');
const filterCount = element<HTMLElement>('#filter-count');
const clearFilterButton = element<HTMLButtonElement>('#clear-filter-button');
const addFilterButton = element<HTMLButtonElement>('#add-filter-button');
const activeFilterList = element<HTMLElement>('#active-filter-list');
const openRecipeButton = element<HTMLButtonElement>('#open-recipe-button');
const saveRecipeButton = element<HTMLButtonElement>('#save-recipe-button');
const recipeInput = element<HTMLInputElement>('#recipe-input');
const startPosition = element<HTMLInputElement>('#start-position');
const suppressZero = element<HTMLInputElement>('#suppress-zero');
const runButton = element<HTMLButtonElement>('#run-button');
const exportCsvButton = element<HTMLButtonElement>('#export-csv-button');
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
const catalogAuxiliary = element<HTMLInputElement>('#catalog-auxiliary');
const catalogSearchButton = element<HTMLButtonElement>('#catalog-search-button');
const catalogStatus = element<HTMLElement>('#catalog-status');
const catalogResults = element<HTMLElement>('#catalog-results');

let records: DbfRecord[] = [];
let dbfHeader: DbfHeader | null = null;
let datasetName = '';
let datasetFingerprint: LoadedSource | null = null;
let activeDef: DefDefinition | null = null;
let activeMap: TabwinMapDefinition | null = null;
let activeMapSource = '';
let currentPlan: QueryPlan | null = null;
let currentResult: TabulationResult | null = null;
let currentView: ViewName = 'table';
let toastTimer = 0;
const cnvByName = new Map<string, CnvDefinition>();
const loadedSources: LoadedSource[] = [];
let activeFilterConversion = '';
let activeFilterStartPosition: number | undefined;
let configuredFilters: FilterSpec[] = [];
let mapZoom = 1;
let mapPanX = 0;
let mapPanY = 0;
let mapProjection: { west: number; north: number; fit: number; offsetX: number; offsetY: number } | null = null;
let lastMapValues = new Map<TabwinMapObject, number | undefined>();
let mapDrag: { pointerId: number; x: number; y: number } | null = null;

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
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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

function setControlsEnabled(enabled: boolean): void {
  for (const control of [rowField, columnField, rowConversion, measureKind, measureField, filterField, startPosition, suppressZero, runButton]) {
    control.disabled = !enabled;
  }
  if (enabled) updateMeasureControls();
  clearFilterButton.disabled = !enabled || !filterField.value;
  if (!enabled) addFilterButton.disabled = true;
}

function fieldLabel(fieldName: string): string {
  if (!activeDef) return fieldName;
  const match = activeDef.options.find((option) =>
    option.field.toUpperCase() === fieldName.toUpperCase() && option.roles.includes('row'));
  return match ? `${match.label} · ${fieldName}` : fieldName;
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
  const previousRow = preferredField ?? rowField.value;
  const previousColumn = columnField.value;
  rowField.replaceChildren();
  columnField.replaceChildren(new Option('Sem colunas', ''));

  for (const field of dbfHeader.fields) {
    rowField.add(new Option(fieldLabel(field.name), field.name));
    columnField.add(new Option(fieldLabel(field.name), field.name));
  }
  const available = new Set(dbfHeader.fields.map((field) => field.name));
  rowField.value = available.has(previousRow) ? previousRow : chooseDefaultField(dbfHeader.fields);
  columnField.value = available.has(previousColumn) ? previousColumn : '';
  populateMeasureFields();
  populateFilterFields();
  populateConversions();
  setControlsEnabled(true);
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

function populateFilterFields(): void {
  if (!dbfHeader) return;
  const previous = filterField.value;
  filterField.replaceChildren(new Option('Sem filtro', ''));
  for (const field of dbfHeader.fields) filterField.add(new Option(selectionLabel(field.name), field.name));
  filterField.value = dbfHeader.fields.some((field) => field.name === previous) ? previous : '';
  populateFilterValues();
}

function updateMeasureControls(): void {
  const isSum = measureKind.value === 'sum';
  measureFieldLabel.hidden = !isSum;
  measureField.disabled = !dbfHeader || !isSum;
}

function populateFilterValues(): void {
  filterValues.replaceChildren();
  activeFilterConversion = '';
  activeFilterStartPosition = undefined;
  addFilterButton.disabled = true;
  updateFilterCount();
  const field = filterField.value;
  clearFilterButton.disabled = !field;
  if (!field) {
    filterInfo.textContent = 'Escolha um campo para selecionar valores.';
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
      filterInfo.textContent = `${definition.categories.length} categorias de ${loadedName}. Marque os valores que deseja incluir.`;
      return;
    }
  }

  const values = new Set<string>();
  for (const record of records) {
    const raw = record[field];
    if (raw !== null && raw !== undefined) values.add(String(raw));
    if (values.size >= 500) break;
  }
  const sorted = [...values].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  for (const value of sorted) addFilterOption(value, value || '(em branco)');
  filterInfo.textContent = `${sorted.length}${values.size >= 500 ? '+' : ''} valores encontrados. Marque os valores que deseja incluir.`;
}

function addFilterOption(value: string, label: string): void {
  const wrapper = document.createElement('label');
  wrapper.className = 'filter-option';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.filterValue = value;
  input.addEventListener('change', updateFilterCount);
  const caption = document.createElement('span');
  caption.textContent = label;
  wrapper.append(input, caption);
  filterValues.append(wrapper);
}

function updateFilterCount(): void {
  const selectedCount = filterValues.querySelectorAll<HTMLInputElement>('input:checked').length;
  addFilterButton.disabled = !filterField.value || selectedCount === 0;
  filterCount.textContent = configuredFilters.length
    ? `${integerFormat.format(configuredFilters.length)} ativo(s)`
    : 'nenhum';
}

function addConfiguredFilter(): void {
  const acceptedCategories = [...filterValues.querySelectorAll<HTMLInputElement>('input:checked')]
    .map((input) => input.dataset.filterValue ?? '');
  if (!filterField.value || !acceptedCategories.length) return;
  const next: FilterSpec = {
    field: filterField.value,
    acceptedCategories,
    ...(activeFilterConversion ? { conversionId: activeFilterConversion } : {}),
    ...(activeFilterStartPosition !== undefined ? { startPosition: activeFilterStartPosition } : {}),
  };
  configuredFilters.push(next);
  renderConfiguredFilters();
  for (const input of filterValues.querySelectorAll<HTMLInputElement>('input:checked')) input.checked = false;
  updateFilterCount();
  void runAnalysis();
}

function renderConfiguredFilters(): void {
  activeFilterList.replaceChildren();
  configuredFilters.forEach((filter, index) => {
    const item = document.createElement('div');
    item.className = 'active-filter';
    const label = document.createElement('span');
    label.textContent = `${selectionLabel(filter.field)} · ${filter.acceptedCategories.length} valor(es)`;
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

function populateConversions(): void {
  const previous = rowConversion.value;
  rowConversion.replaceChildren(new Option('Valores originais', ''));
  for (const name of [...cnvByName.keys()].sort((a, b) => a.localeCompare(b))) {
    const definition = cnvByName.get(name)!;
    rowConversion.add(new Option(`${name} · ${definition.categories.length} categorias`, name));
  }
  if (cnvByName.has(previous)) rowConversion.value = previous;
  applyDefDefaults();
  if (filterField.value) populateFilterValues();
}

function applyDefDefaults(): void {
  if (!activeDef || !rowField.value) return;
  const option = optionsForRole(activeDef, 'row').find(
    (candidate) => candidate.field.toUpperCase() === rowField.value.toUpperCase(),
  );
  if (option?.kind !== 'conversion') return;
  startPosition.value = String(option.startPosition);
  const wanted = baseName(option.conversionFile);
  const loadedName = [...cnvByName.keys()].find((name) => baseName(name) === wanted);
  if (loadedName) rowConversion.value = loadedName;
}

function updateDatasetStats(): void {
  if (!dbfHeader || !datasetFingerprint) return;
  const values: Array<readonly [string, string]> = [
    [integerFormat.format(records.length), 'registros ativos'],
    [integerFormat.format(dbfHeader.fields.length), 'campos'],
    [formatBytes(datasetFingerprint.size), 'arquivo original'],
    [datasetFingerprint.sha256.slice(0, 10), 'sha-256'],
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

async function decodeDbf(bytes: Uint8Array, file: File, isDbc: boolean): Promise<void> {
  setBusy(isDbc ? `Descompactando ${file.name}…` : `Lendo ${file.name}…`);
  if (isDbc) readDbcMetadata(bytes); // validates the cheap envelope metadata first
  const dbf = isDbc ? dbcToDbf(bytes) : bytes;
  const header = readDbfHeader(dbf);
  const nextRecords: DbfRecord[] = [];
  let index = 0;
  for await (const record of readDbfRecords(dbf)) {
    nextRecords.push(record);
    if (++index % 10_000 === 0) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  records = nextRecords;
  dbfHeader = header;
  configuredFilters = [];
  renderConfiguredFilters();
  datasetName = file.name;
  datasetFingerprint = loadedSources.find((source) => source.name === file.name) ?? null;
  populateControls(chooseDefaultField(header.fields));
  updateDatasetStats();
  await runAnalysis();
}

async function loadFile(file: File): Promise<void> {
  const extension = extensionOf(file.name);
  if (!['DBC', 'DBF', 'DEF', 'CNV', 'MAP'].includes(extension)) {
    throw new Error(`${file.name}: formato ainda não suportado`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source: LoadedSource = {
    name: file.name,
    extension,
    size: file.size,
    sha256: await sha256(bytes),
  };
  rememberSource(source);

  if (extension === 'DBC' || extension === 'DBF') {
    datasetFingerprint = source;
    await decodeDbf(bytes, file, extension === 'DBC');
    return;
  }
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
  activeMapSource = file.name;
  showToast(`${file.name}: ${integerFormat.format(activeMap.objects.length)} áreas carregadas`);
  if (currentView === 'map') renderMap();
}

async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  try {
    // Metadata first lets a DEF/CNV influence the automatic first analysis even
    // when the user selected all files in one gesture.
    const ordered = [...files].sort((a, b) => {
      const rank = (file: File) => ({ DEF: 0, CNV: 1, MAP: 2, DBC: 3, DBF: 3 })[extensionOf(file.name)] ?? 9;
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
  const row = {
    field: rowField.value,
    ...(conversionName ? { conversionId: conversionName, startPosition: Number(startPosition.value) } : {}),
  };
  const measure = measureKind.value === 'sum'
    ? { kind: 'sum' as const, field: measureField.value }
    : { kind: 'count' as const };
  const spec = {
    compatibilityProfile: 'tabwin-4.15' as const,
    rows: row,
    ...(columnField.value ? { columns: { field: columnField.value } } : {}),
    measure,
    filters: configuredFilters.map((filter) => ({ ...filter, acceptedCategories: [...filter.acceptedCategories] })),
    suppressZeroRows: suppressZero.checked,
  };
  return compileQueryPlan(spec);
}

async function runAnalysis(): Promise<void> {
  if (!dbfHeader || !records.length || !rowField.value) return;
  setBusy('Montando a tabela…');
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const plan = buildPlan();
    const conversions: Record<string, CnvDefinition> = {};
    if (rowConversion.value) conversions[rowConversion.value] = cnvByName.get(rowConversion.value)!;
    for (const filter of configuredFilters) {
      if (filter.conversionId) conversions[filter.conversionId] = cnvByName.get(filter.conversionId)!;
    }
    const result = executeInMemory(records, plan, conversions);
    currentPlan = plan;
    currentResult = result;
    resultKicker.textContent = measureKind.value === 'sum'
      ? `${datasetName} · soma de ${measureField.value}`
      : `${datasetName} · frequência`;
    resultTitle.textContent = fieldLabel(rowField.value).replace(` · ${rowField.value}`, '');
    renderResult();
    exportCsvButton.disabled = false;
    exportXmlButton.disabled = false;
    chartPngButton.disabled = false;
    chartSvgButton.disabled = false;
    saveRecipeButton.disabled = false;
    setControlsEnabled(true);
    if (currentView === 'map') await ensureMap();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resultKicker.textContent = 'Análise interrompida';
    resultTitle.textContent = message;
    showToast(message, true);
    setControlsEnabled(true);
  }
}

function cellValue(result: TabulationResult, rowIndex: number): number {
  return result.cells[rowIndex]?.reduce((sum, value) => sum + value, 0) ?? 0;
}

function renderResult(): void {
  if (!currentResult || !currentPlan) return;
  emptyState.hidden = true;
  tableWrap.hidden = false;
  renderTable(currentResult);
  renderChart(currentResult);
  populateStatisticsColumns(currentResult);
  renderStatistics();
  renderAudit();
  if (activeMap) renderMap();
}

function renderTable(result: TabulationResult): void {
  const head = resultTable.tHead ?? resultTable.createTHead();
  const body = resultTable.tBodies[0] ?? resultTable.createTBody();
  const foot = resultTable.tFoot ?? resultTable.createTFoot();
  head.replaceChildren();
  body.replaceChildren();
  foot.replaceChildren();

  const headerRow = document.createElement('tr');
  const dimension = document.createElement('th');
  dimension.scope = 'col';
  dimension.textContent = fieldLabel(rowField.value);
  headerRow.append(dimension);
  for (const column of result.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column.label;
    headerRow.append(th);
  }
  head.append(headerRow);

  const limit = 500;
  for (let rowIndex = 0; rowIndex < Math.min(result.rows.length, limit); rowIndex++) {
    const row = result.rows[rowIndex]!;
    const tr = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = row.label;
    tr.append(label);
    for (const value of result.cells[rowIndex] ?? []) {
      const td = document.createElement('td');
      td.textContent = numberFormat.format(value);
      tr.append(td);
    }
    body.append(tr);
  }
  if (result.rows.length > limit) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = result.columns.length + 1;
    td.textContent = `Exibindo 500 de ${integerFormat.format(result.rows.length)} linhas. O CSV contém o resultado completo.`;
    tr.append(td);
    body.append(tr);
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
    application: { name: 'TabWin Web', version: '0.8.0-dev', compatibilityProfile: 'tabwin-4.15' },
    source: datasetFingerprint,
    relatedFiles: loadedSources.filter((source) => source.name !== datasetFingerprint?.name),
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
    renderMap();
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
    activeMapSource = `incluído: ${bundled}`;
    renderMap();
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

function setCatalogBusy(busy: boolean): void {
  catalogSearchButton.disabled = busy;
  for (const button of catalogResults.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy;
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
  const annual = systemIsAnnual(catalogSystem.value);
  catalogMonthLabel.hidden = annual;
  catalogUf.replaceChildren();
  const ufs = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
  if (type?.coverage !== 'UF') catalogUf.add(new Option('Brasil', 'BR'));
  if (type?.coverage !== 'BR') for (const uf of ufs) catalogUf.add(new Option(uf, uf));
  catalogUfLabel.hidden = type?.coverage === 'BR';
}

function initializeCatalog(): void {
  for (const system of DATASUS_SYSTEMS) catalogSystem.add(new Option(system.label, system.code));
  for (let year = new Date().getFullYear(); year >= 1979; year--) catalogYear.add(new Option(String(year), String(year)));
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  monthNames.forEach((name, index) => catalogMonth.add(new Option(name, String(index + 1).padStart(2, '0'))));
  populateCatalogFileTypes();
}

async function downloadCatalogEntries(
  files: readonly DatasusRemoteFile[],
  signal?: AbortSignal,
  maxCacheAgeMs = 24 * 60 * 60 * 1000,
): Promise<ExtractedArchiveFile[]> {
  const cacheKey = `official-v1:${files.map((file) => file.address).sort().join('|')}`;
  let archive: Uint8Array | null = null;
  try {
    archive = await readCachedArchive(cacheKey, maxCacheAgeMs);
  } catch {
    // Private browsing or storage policies may disable IndexedDB; acquisition remains usable.
  }
  if (!archive) {
    const preparedUrl = await prepareOfficialDownload(files, signal);
    archive = await fetchOfficialArchive(preparedUrl, signal);
    try {
      await writeCachedArchive(cacheKey, archive);
    } catch {
      // Cache failure is non-fatal and must never block opening public data.
    }
  }
  return extractSupportedArchiveFiles(archive);
}

async function loadVerifiedAuxiliaries(query: DatasusSearchQuery, signal?: AbortSignal): Promise<number> {
  const definitionName = suggestedDefinitionName(query.system, query.fileType);
  if (!definitionName) return 0;
  setCatalogStatus('Procurando arquivos DEF e CNV oficiais…');
  const remoteAuxiliaries = await searchOfficialAuxiliaries(query.system, signal);
  const bundle = chooseCurrentAuxiliaryBundle(remoteAuxiliaries, query.system);
  if (!bundle) throw new Error('O DATASUS não listou um pacote auxiliar atual para este sistema');
  const extracted = await downloadCatalogEntries([bundle], signal, 7 * 24 * 60 * 60 * 1000);
  const definitionEntry = extracted.find(
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
  const selected = extracted.filter((entry) => wanted.has(displayBaseName(entry.name).toUpperCase()));
  await loadFiles(selected.map(archiveFile));
  for (const entry of selected) {
    const source = loadedSources.find((item) => item.name.toLowerCase() === displayBaseName(entry.name).toLowerCase());
    if (source) source.origin = bundle.address;
  }
  return selected.length;
}

async function openOfficialFile(remote: DatasusRemoteFile, query: DatasusSearchQuery): Promise<void> {
  setCatalogBusy(true);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120_000);
  try {
    let auxiliaryCount = 0;
    if (catalogAuxiliary.checked) {
      try {
        auxiliaryCount = await loadVerifiedAuxiliaries(query, controller.signal);
      } catch (error) {
        showToast(`Auxiliares não carregados: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    }
    setCatalogStatus(`Baixando ${remote.name} do DATASUS…`);
    const extracted = await downloadCatalogEntries([remote], controller.signal);
    const wanted = extracted.find((entry) => displayBaseName(entry.name).toLowerCase() === remote.name.toLowerCase())
      ?? extracted.find((entry) => ['DBC', 'DBF'].includes(extensionOf(entry.name)));
    if (!wanted) throw new Error('O pacote oficial não contém um DBC ou DBF reconhecido');
    await loadFiles([archiveFile(wanted)]);
    const source = loadedSources.find((item) => item.name.toLowerCase() === displayBaseName(wanted.name).toLowerCase());
    if (source) source.origin = remote.address;
    renderAudit();
    setCatalogStatus(`${remote.name} aberto${auxiliaryCount ? ` com ${integerFormat.format(auxiliaryCount)} auxiliares` : ''}.`);
    catalogDialog.close();
    showToast(`${remote.name} carregado diretamente do DATASUS`);
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'O DATASUS demorou mais de 2 minutos para responder'
      : error instanceof Error ? error.message : String(error);
    setCatalogStatus(message, true);
  } finally {
    window.clearTimeout(timer);
    setCatalogBusy(false);
  }
}

async function searchCatalog(): Promise<void> {
  const type = fileTypesForSystem(catalogSystem.value).find((item) => item.code === catalogFileType.value);
  if (!type) return;
  const query: DatasusSearchQuery = {
    system: catalogSystem.value,
    fileType: catalogFileType.value,
    year: catalogYear.value,
    ...(!systemIsAnnual(catalogSystem.value) ? { month: catalogMonth.value } : {}),
    ...(catalogUf.value ? { uf: catalogUf.value } : {}),
  };
  setCatalogBusy(true);
  catalogResults.replaceChildren();
  setCatalogStatus('Consultando o catálogo oficial…');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const files = await searchOfficialFiles(query, controller.signal);
    if (!files.length) {
      setCatalogStatus('Nenhum arquivo encontrado para essa combinação. O período pode ainda não ter sido publicado.');
      return;
    }
    setCatalogStatus(`${integerFormat.format(files.length)} arquivo(s) encontrado(s).`);
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
      button.addEventListener('click', () => void openOfficialFile(remote, query));
      item.append(details, button);
      catalogResults.append(item);
    }
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'O catálogo DATASUS demorou para responder. Tente novamente.'
      : error instanceof Error ? error.message : String(error);
    setCatalogStatus(message, true);
  } finally {
    window.clearTimeout(timer);
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
  return `${datasetName.replace(/\.[^.]+$/, '')}-${rowField.value.toLowerCase()}`;
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
  if (!currentPlan || !datasetFingerprint) return;
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
    sourceHints: [{
      name: datasetFingerprint.name,
      sha256: datasetFingerprint.sha256,
      size: datasetFingerprint.size,
    }],
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
    },
  };
  downloadBlob(
    new Blob([serializeRecipe(recipe)], { type: 'application/json;charset=utf-8' }),
    `${exportBaseName()}.twrecipe`,
  );
}

async function openRecipe(file: File): Promise<void> {
  if (!dbfHeader || !datasetFingerprint) throw new Error('Abra um DBC ou DBF antes de aplicar a análise');
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
  if (recipe.view?.chartType) chartType.value = recipe.view.chartType;
  if (recipe.view?.mapClassification) mapClassification.value = recipe.view.mapClassification;
  if (recipe.view?.mapClassCount) mapClassCount.value = String(recipe.view.mapClassCount);
  if (recipe.view?.mapPalette) mapPalette.value = recipe.view.mapPalette;
  if (recipe.view?.statisticsOperation) statisticsOperation.value = recipe.view.statisticsOperation;
  if (recipe.view?.histogramBins) histogramBins.value = String(recipe.view.histogramBins);
  mapClassCount.disabled = mapClassification.value === 'continuous';
  rowConversion.value = '';
  if (recipe.spec.rows.conversionId) {
    const loaded = conversionNameInRegistry(recipe.spec.rows.conversionId);
    if (!loaded) throw new Error(`Carregue a conversão ${displayBaseName(recipe.spec.rows.conversionId)} antes de abrir esta análise`);
    rowConversion.value = loaded;
    startPosition.value = String(recipe.spec.rows.startPosition ?? 1);
  }
  configuredFilters = recipe.spec.filters.map((filter) => {
    if (!filter.conversionId) return { ...filter, acceptedCategories: [...filter.acceptedCategories] };
    const loaded = conversionNameInRegistry(filter.conversionId);
    if (!loaded) throw new Error(`Carregue a conversão ${displayBaseName(filter.conversionId)} antes de abrir esta análise`);
    return { ...filter, conversionId: loaded, acceptedCategories: [...filter.acceptedCategories] };
  });
  renderConfiguredFilters();
  updateMeasureControls();
  await runAnalysis();
  if (currentResult) {
    const xIndex = currentResult.columns.findIndex((column) => column.key === recipe.view?.statisticsXColumnKey);
    const yIndex = currentResult.columns.findIndex((column) => column.key === recipe.view?.statisticsYColumnKey);
    if (xIndex >= 0) statisticsX.value = String(xIndex);
    if (yIndex >= 0) statisticsY.value = String(yIndex);
    renderStatistics();
  }
  const sameSource = recipe.sourceHints.some((hint) => hint.sha256 === datasetFingerprint?.sha256);
  showToast(sameSource
    ? `${file.name}: análise reproduzida`
    : `${file.name}: análise aplicada a uma fonte diferente da original`);
}

function exportCsv(): void {
  if (!currentResult) return;
  const csv = tabulationToCsv(currentResult, {
    sourceName: datasetName,
    rowLabel: fieldLabel(rowField.value),
  });
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${exportBaseName()}.csv`);
}

function exportXml(): void {
  if (!currentResult) return;
  const xml = tabulationToXml(currentResult, {
    sourceName: datasetName,
    rowLabel: fieldLabel(rowField.value),
  });
  downloadBlob(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `${exportBaseName()}.xml`);
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
columnField.addEventListener('change', () => void runAnalysis());
rowConversion.addEventListener('change', () => void runAnalysis());
measureKind.addEventListener('change', () => {
  updateMeasureControls();
  if (measureKind.value === 'count' || measureField.value) void runAnalysis();
});
measureField.addEventListener('change', () => void runAnalysis());
filterField.addEventListener('change', populateFilterValues);
addFilterButton.addEventListener('click', addConfiguredFilter);
clearFilterButton.addEventListener('click', () => {
  for (const input of filterValues.querySelectorAll<HTMLInputElement>('input:checked')) input.checked = false;
  updateFilterCount();
  void runAnalysis();
});
openRecipeButton.addEventListener('click', () => recipeInput.click());
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
suppressZero.addEventListener('change', () => void runAnalysis());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => showView(button.dataset.view as ViewName));
}
exportCsvButton.addEventListener('click', exportCsv);
exportXmlButton.addEventListener('click', exportXml);
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
element<HTMLButtonElement>('#catalog-button').addEventListener('click', () => catalogDialog.showModal());
element<HTMLButtonElement>('#catalog-close').addEventListener('click', () => catalogDialog.close());
catalogDialog.addEventListener('click', (event) => {
  if (event.target === catalogDialog) catalogDialog.close();
});
catalogSystem.addEventListener('change', populateCatalogFileTypes);
catalogFileType.addEventListener('change', updateCatalogGeography);
catalogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void searchCatalog();
});
window.addEventListener('resize', () => {
  if (currentView === 'map' && activeMap) renderMap();
});
initializeCatalog();
