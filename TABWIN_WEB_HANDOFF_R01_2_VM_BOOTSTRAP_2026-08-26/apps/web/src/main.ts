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
  type TabwinMapDefinition,
} from '../../../packages/formats/src/index.ts';
import './styles.css';

type ViewName = 'table' | 'chart' | 'map' | 'audit';

interface LoadedSource {
  name: string;
  extension: string;
  size: number;
  sha256: string;
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
const startPosition = element<HTMLInputElement>('#start-position');
const suppressZero = element<HTMLInputElement>('#suppress-zero');
const runButton = element<HTMLButtonElement>('#run-button');
const exportButton = element<HTMLButtonElement>('#export-button');
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
const toast = element<HTMLElement>('#toast');
const aboutDialog = element<HTMLDialogElement>('#about-dialog');

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
  for (const source of loadedSources) {
    const chip = document.createElement('div');
    chip.className = 'file-chip ok';
    const name = document.createElement('b');
    name.textContent = source.name;
    const meta = document.createElement('span');
    meta.textContent = `${source.extension} · ${formatBytes(source.size)}`;
    chip.append(name, meta);
    fileList.append(chip);
  }
}

function setBusy(message: string): void {
  resultKicker.textContent = 'Processando localmente';
  resultTitle.textContent = message;
  runButton.disabled = true;
}

function setControlsEnabled(enabled: boolean): void {
  for (const control of [rowField, columnField, rowConversion, startPosition, suppressZero, runButton]) {
    control.disabled = !enabled;
  }
}

function fieldLabel(fieldName: string): string {
  if (!activeDef) return fieldName;
  const match = activeDef.options.find((option) =>
    option.field.toUpperCase() === fieldName.toUpperCase() && option.roles.includes('row'));
  return match ? `${match.label} · ${fieldName}` : fieldName;
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
  populateConversions();
  setControlsEnabled(true);
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
  const spec = {
    compatibilityProfile: 'tabwin-4.15' as const,
    rows: row,
    ...(columnField.value ? { columns: { field: columnField.value } } : {}),
    measure: { kind: 'count' as const },
    filters: [],
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
    const result = executeInMemory(records, plan, conversions);
    currentPlan = plan;
    currentResult = result;
    resultKicker.textContent = `${datasetName} · frequência`;
    resultTitle.textContent = fieldLabel(rowField.value).replace(` · ${rowField.value}`, '');
    renderResult();
    exportButton.disabled = false;
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
  const ranked = result.rows
    .map((row, index) => ({ label: row.label, value: cellValue(result, index) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 24);
  const max = Math.max(...ranked.map((item) => item.value), 1);
  for (const item of ranked) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const label = document.createElement('div');
    label.className = 'bar-label';
    label.title = item.label;
    label.textContent = item.label;
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max(0.5, (item.value / max) * 100)}%`;
    track.append(fill);
    const value = document.createElement('div');
    value.className = 'bar-value';
    value.textContent = numberFormat.format(item.value);
    row.append(label, track, value);
    chart.append(row);
  }
}

function renderAudit(): void {
  const audit = {
    application: { name: 'TabWin Web', version: '0.2.0-dev', compatibilityProfile: 'tabwin-4.15' },
    source: datasetFingerprint,
    relatedFiles: loadedSources.filter((source) => source.name !== datasetFingerprint?.name),
    definition: activeDef ? {
      description: activeDef.description,
      options: activeDef.options.length,
      warnings: activeDef.warnings,
      unresolvedLines: activeDef.unknownLines.length,
    } : null,
    map: activeMap ? { source: activeMapSource, objects: activeMap.objects.length, version: activeMap.version } : null,
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

function colorFor(value: number | undefined, max: number): string {
  if (value === undefined) return '#dfe8e5';
  const ratio = max > 0 ? Math.sqrt(Math.max(0, value) / max) : 0;
  const start = [185, 232, 217];
  const end = [6, 96, 78];
  const rgb = start.map((channel, index) => Math.round(channel + ((end[index] ?? channel) - channel) * ratio));
  return `rgb(${rgb.join(',')})`;
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
  const fit = Math.min((cssWidth - padding * 2) / sourceWidth, (cssHeight - padding * 2) / sourceHeight);
  const drawnWidth = sourceWidth * fit;
  const drawnHeight = sourceHeight * fit;
  const offsetX = (cssWidth - drawnWidth) / 2;
  const offsetY = (cssHeight - drawnHeight) / 2;
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
  const max = Math.max(...values.values(), 0);
  let matched = 0;

  context.lineJoin = 'round';
  context.lineWidth = Math.max(.28, .45 / scale);
  context.strokeStyle = 'rgba(49, 91, 86, .48)';
  for (const object of activeMap.objects) {
    if (object.type !== 'polygon' && object.type !== 'polygon-with-seat') continue;
    const value = values.get(object.geocode.trim().toLowerCase()) ?? values.get(normalizeLabel(object.name));
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
      context.closePath();
    }
    context.fillStyle = colorFor(value, max);
    context.fill('evenodd');
    context.stroke();
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
  const range = document.createElement('div');
  range.className = 'legend-range';
  const low = document.createElement('span');
  const high = document.createElement('span');
  low.textContent = '0';
  high.textContent = numberFormat.format(max);
  range.append(low, high);
  mapLegend.append(title, gradient, range);
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

function exportCsv(): void {
  if (!currentResult) return;
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = [
    [fieldLabel(rowField.value), ...currentResult.columns.map((column) => column.label)].map(quote).join(','),
    ...currentResult.rows.map((row, index) =>
      [row.label, ...(currentResult?.cells[index] ?? [])].map(quote).join(',')),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${datasetName.replace(/\.[^.]+$/, '')}-${rowField.value.toLowerCase()}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
suppressZero.addEventListener('change', () => void runAnalysis());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  button.addEventListener('click', () => showView(button.dataset.view as ViewName));
}
exportButton.addEventListener('click', exportCsv);
element<HTMLButtonElement>('#about-button').addEventListener('click', () => aboutDialog.showModal());
element<HTMLButtonElement>('#dialog-close').addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});
window.addEventListener('resize', () => {
  if (currentView === 'map' && activeMap) renderMap();
});
