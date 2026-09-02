import {
  addCell,
  createNotebook,
  MAX_CELLS,
  MAX_CODE_LENGTH,
  MAX_NOTEBOOK_BYTES,
  monotonicUpdatedAt,
  moveCell,
  parseNotebook,
  removeCell,
  serializeNotebook,
  updateCell,
} from './notebook-model.js';
import { CanonicalRunner } from './canonical-runner.js';
import {
  createRunRecord,
  executionPlan,
  invalidateExecutions,
  serializeRunRecord,
  storageWriteDecision,
} from './lab-session.js';
import {
  registerRuntimeAdapter,
  registeredRuntimes,
  runtimeAdapter,
} from './runtime-adapter.js';
import {
  prepareRuntimeFiles,
  sha256Text,
  validateRuntimeFiles,
} from './runtime-files.js';
import { PyodideAdapter } from './runtimes/pyodide-adapter.js';
import { WebRAdapter } from './runtimes/webr-adapter.js';

const STORAGE_KEY = 'tabwin-lab.notebook.v1';
const RECOVERY_KEY = 'tabwin-lab.notebook.recovery.v1';
const RECOVERY_REASON_KEY = 'tabwin-lab.notebook.recovery-reason.v1';
const SAVE_DELAY_MS = 400;

const element = (selector) => {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
};

const title = element('#notebook-title');
const cells = element('#cells');
const template = element('#cell-template');
const status = element('#save-status');
const notebookInput = element('#notebook-file');
const importNotebook = element('#import-notebook');
const exportNotebook = element('#export-notebook');
const exportRun = element('#export-run');
const recoverNotebook = element('#recover-notebook');
const forceSave = element('#force-save');
const dataFiles = element('#data-files');
const dataFileList = element('#data-file-list');
const addCellButton = element('#add-cell');
const runAllButton = element('#run-all');
const resetRuntimesButton = element('#reset-runtimes');

const pythonAdapter = new PyodideAdapter();
const rAdapter = new WebRAdapter();
registerRuntimeAdapter(pythonAdapter);
registerRuntimeAdapter(rAdapter);

const runtimeUi = new Map([
  ['python', {
    adapter: pythonAdapter,
    name: 'Python',
    button: element('#load-python'),
    status: element('#python-runtime-status'),
    idleText: 'não carregado',
  }],
  ['r', {
    adapter: rAdapter,
    name: 'R',
    button: element('#load-r'),
    status: element('#r-runtime-status'),
    idleText: 'não carregado',
  }],
]);

const executions = new Map();
const codeDrafts = new Map();
let titleDraft = null;
let persistTimer = null;
let startupWarning = '';
let expectedStorageValue = null;
let storageConflict = false;
let importing = false;
let importGeneration = 0;
let inputRevision = 0;
let preparedInputCache = null;
let lastRunRecord = null;
let notebook;

function humanError(error) {
  return error instanceof Error ? error.message : String(error);
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes.toLocaleString('pt-BR')} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function safeStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeRecovery(serialized, reason) {
  if (typeof serialized !== 'string' || serialized.length === 0) return false;
  try {
    localStorage.setItem(RECOVERY_KEY, serialized);
    localStorage.setItem(RECOVERY_REASON_KEY, reason);
    recoverNotebook.hidden = false;
    return true;
  } catch {
    return false;
  }
}

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  expectedStorageValue = saved;
  notebook = saved ? parseNotebook(saved) : createNotebook();
} catch (error) {
  const inaccessible = safeStorageGet(STORAGE_KEY);
  if (inaccessible) storeRecovery(inaccessible, 'Caderno inválido encontrado na inicialização');
  notebook = createNotebook();
  startupWarning = `O caderno salvo estava inacessível ou inválido (${humanError(error)}). Ele foi preservado na recuperação e não foi sobrescrito.`;
}

function setStatus(message) {
  status.textContent = message;
}

function setRuntimeState(kind, state, detail = null) {
  const definition = runtimeUi.get(kind);
  if (!definition) return;
  definition.state = state;
  definition.info = state === 'ready' && detail && typeof detail === 'object' ? detail : definition.info;
  definition.status.dataset.state = state;
  if (state === 'loading') {
    definition.status.textContent = typeof detail === 'string' ? detail : 'carregando…';
    definition.button.textContent = 'Cancelar carga';
  } else if (state === 'ready') {
    const version = kind === 'r'
      ? `${detail?.runtimeVersion ?? 'R'} · webR ${detail?.webRVersion ?? '0.6.0'}`
      : detail?.runtimeVersion ?? 'pronto';
    definition.status.textContent = `pronto · ${version}`;
    definition.button.textContent = `${definition.name} pronto`;
  } else if (state === 'error') {
    definition.status.textContent = typeof detail === 'string' ? detail : humanError(detail);
    definition.button.textContent = 'Tentar novamente';
  } else {
    definition.status.textContent = definition.idleText;
    definition.button.textContent = `Carregar ${definition.name}`;
    definition.info = null;
  }
  refreshControls();
}

function applyDrafts() {
  if (titleDraft === null && codeDrafts.size === 0) return true;
  const nextTitle = titleDraft === null ? notebook.title : titleDraft.trim();
  try {
    const updatedAt = monotonicUpdatedAt(notebook);
    notebook = parseNotebook({
      ...notebook,
      title: nextTitle,
      updatedAt,
      cells: notebook.cells.map((cell) => codeDrafts.has(cell.id)
        ? { ...cell, code: codeDrafts.get(cell.id) }
        : cell),
    });
    titleDraft = null;
    codeDrafts.clear();
    return true;
  } catch (error) {
    titleDraft = null;
    codeDrafts.clear();
    title.value = notebook.title;
    for (const root of cells.querySelectorAll('.cell')) {
      const cell = notebook.cells.find((candidate) => candidate.id === root.dataset.cellId);
      if (cell) root.querySelector('.cell-code').value = cell.code;
    }
    setStatus(`${humanError(error)}. A edição que ultrapassou o limite foi desfeita.`);
    return false;
  }
}

function persistNow(message = 'Salvo apenas neste navegador.') {
  if (!applyDrafts()) return false;
  try {
    const serialized = serializeNotebook(notebook);
    const current = localStorage.getItem(STORAGE_KEY);
    const decision = storageWriteDecision(expectedStorageValue, current, serialized);
    if (decision.conflict) {
      storageConflict = true;
      storeRecovery(serialized, 'Edição desta aba preservada após conflito entre abas');
      setStatus('Outra aba alterou este caderno. Nada foi sobrescrito; exporte esta versão ou escolha “Manter esta aba”.');
      refreshControls();
      return false;
    }
    localStorage.setItem(STORAGE_KEY, serialized);
    expectedStorageValue = serialized;
    storageConflict = false;
    setStatus(`${message} Atualizado ${new Date(notebook.updatedAt).toLocaleTimeString('pt-BR')}.`);
    refreshControls();
    return true;
  } catch {
    setStatus('O caderno continua nesta aba, mas o navegador recusou a persistência local. Exporte o arquivo para não perder trabalho.');
    return false;
  }
}

function schedulePersist(message = 'Salvo apenas neste navegador.') {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow(message);
  }, SAVE_DELAY_MS);
}

function flushPending(message = 'Salvo apenas neste navegador.') {
  clearTimeout(persistTimer);
  persistTimer = null;
  return persistNow(message);
}

function markRunObsolete() {
  lastRunRecord = null;
  exportRun.disabled = true;
}

function invalidateFrom(index, reason) {
  invalidateExecutions(executions, notebook.cells, { fromIndex: index, reason });
  markRunObsolete();
  updateVisibleExecutions();
}

function defaultCellStatus() {
  return 'Pronta. “Executar até aqui” reinicia os ambientes e percorre o caderno desde a primeira célula.';
}

function setOutputBlock(root, selector, value) {
  const block = root.querySelector(selector);
  const text = typeof value === 'string' ? value : '';
  block.hidden = text.length === 0;
  block.querySelector('pre').textContent = text;
}

function runtimeMetadata(output, cell) {
  if (cell.runtime === 'r') {
    const items = [output?.runtimeVersion ?? 'R'];
    if (output?.webRVersion) items.push(`webR ${output.webRVersion}`);
    return items.join(' · ');
  }
  return output?.runtimeVersion ? `Python ${output.runtimeVersion}` : 'Python';
}

function packageEntries(packages) {
  if (Array.isArray(packages)) return packages.map((item) => {
    if (typeof item === 'string') return item;
    return [item?.name, item?.version].filter(Boolean).join(' ') || JSON.stringify(item);
  });
  if (packages && typeof packages === 'object') {
    return Object.entries(packages).map(([name, version]) => `${name} ${String(version)}`);
  }
  return [];
}

function renderExecution(root, cell) {
  const state = executions.get(cell.id);
  const cellStatus = root.querySelector('.cell-status');
  const outputRoot = root.querySelector('.cell-output');
  outputRoot.dataset.stale = 'false';
  if (!state) {
    cellStatus.textContent = defaultCellStatus(cell);
    outputRoot.hidden = true;
    return;
  }
  if (['preparing', 'running', 'cancelling'].includes(state.phase)) {
    cellStatus.textContent = state.message;
    outputRoot.hidden = true;
    return;
  }
  if (state.phase === 'cancelled') {
    cellStatus.textContent = state.message;
    outputRoot.hidden = true;
    return;
  }

  const isError = state.phase === 'error';
  const isStale = state.phase === 'stale';
  const output = state.output ?? {};
  if (isError) cellStatus.textContent = 'A célula falhou; o runtime foi reiniciado e a execução parou aqui.';
  else if (isStale) cellStatus.textContent = `Saída desatualizada: ${state.staleReason}`;
  else cellStatus.textContent = 'Execução canônica concluída.';
  outputRoot.hidden = false;
  outputRoot.dataset.stale = String(isStale);
  const historicalError = isStale && state.staleFromPhase === 'error' ? state.stalePreviousMessage : '';
  setOutputBlock(root, '.output-error', isError ? state.message : historicalError);
  setOutputBlock(root, '.output-stdout', output.stdout);
  setOutputBlock(root, '.output-stderr', output.stderr);
  setOutputBlock(root, '.output-result', output.result);
  const conditions = Array.isArray(output.conditions)
    ? output.conditions.map((condition) => `[${condition.type ?? 'condição'}] ${condition.message ?? ''}`).join('\n')
    : '';
  setOutputBlock(root, '.output-conditions', conditions);

  const visibleBlocks = [...outputRoot.querySelectorAll('.output-block')].some((block) => !block.hidden);
  outputRoot.querySelector('.output-empty').hidden = visibleBlocks || isError;
  const metadata = [runtimeMetadata(output, cell)];
  if (Number.isFinite(output.durationMs)) metadata.push(`${(output.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s`);
  if (output.codeHash) metadata.push(`código ${output.codeHash.slice(0, 12)}…`);
  if (output.stdoutTruncated || output.stderrTruncated) metadata.push('saída truncada');
  if (isStale) metadata.unshift('DESATUALIZADA');
  outputRoot.querySelector('.output-meta').textContent = metadata.join(' · ');

  const provenance = outputRoot.querySelector('.output-inputs');
  const provenanceList = provenance.querySelector('ul');
  provenanceList.replaceChildren();
  if (output.codeHash) {
    provenanceList.append(Object.assign(document.createElement('li'), {
      textContent: `Código · SHA-256 ${output.codeHash}`,
    }));
  }
  for (const input of output.inputs ?? []) {
    provenanceList.append(Object.assign(document.createElement('li'), {
      textContent: `${input.name} · ${humanBytes(input.size)} · SHA-256 ${input.sha256}`,
    }));
  }
  for (const item of packageEntries(output.packages)) {
    provenanceList.append(Object.assign(document.createElement('li'), { textContent: `Pacote · ${item}` }));
  }
  provenance.hidden = provenanceList.children.length === 0;
}

function updateVisibleExecutions() {
  for (const root of cells.querySelectorAll('.cell')) {
    const cell = notebook.cells.find((candidate) => candidate.id === root.dataset.cellId);
    if (cell) renderExecution(root, cell);
  }
  refreshControls();
}

function refreshControls() {
  const busy = runner.active || importing;
  title.disabled = busy;
  importNotebook.disabled = busy;
  exportNotebook.disabled = busy;
  dataFiles.disabled = busy;
  addCellButton.disabled = busy || notebook.cells.length >= MAX_CELLS;
  resetRuntimesButton.disabled = busy;
  exportRun.disabled = busy || lastRunRecord === null;
  recoverNotebook.hidden = safeStorageGet(RECOVERY_KEY) === null;
  recoverNotebook.disabled = busy;
  forceSave.hidden = !storageConflict;
  forceSave.disabled = busy;

  runAllButton.textContent = runner.active ? 'Cancelar execução' : 'Executar tudo';
  runAllButton.classList.toggle('danger', runner.active);
  runAllButton.disabled = importing || (!runner.active && notebook.cells.length === 0);

  for (const definition of runtimeUi.values()) {
    definition.button.disabled = busy || definition.adapter.ready;
  }

  notebook.cells.forEach((cell, index) => {
    const root = cells.querySelector(`[data-cell-id="${CSS.escape(cell.id)}"]`);
    if (!root) return;
    const active = runner.activeCellId === cell.id;
    const run = root.querySelector('.cell-run');
    run.textContent = active ? 'Cancelar' : 'Executar até aqui';
    run.classList.toggle('danger', active);
    run.disabled = importing || (runner.active && !active);
    run.title = active
      ? 'Cancelar e reiniciar o runtime ativo'
      : `Reiniciar os ambientes e executar as células 1 a ${index + 1}`;
    root.querySelector('.cell-runtime').disabled = busy;
    root.querySelector('.cell-code').disabled = busy;
    root.querySelector('.cell-delete').disabled = busy;
    root.querySelector('.cell-move-up').disabled = busy || index === 0;
    root.querySelector('.cell-move-down').disabled = busy || index === notebook.cells.length - 1;
  });
}

function render(options = {}) {
  const focusCellId = options.focusCellId ?? null;
  const focusSelector = options.focusSelector ?? '.cell-code';
  title.value = titleDraft ?? notebook.title;
  cells.replaceChildren();
  notebook.cells.forEach((cell, index) => {
    const fragment = template.content.cloneNode(true);
    const root = fragment.querySelector('.cell');
    const runtime = fragment.querySelector('.cell-runtime');
    const code = fragment.querySelector('.cell-code');
    const run = fragment.querySelector('.cell-run');
    const remove = fragment.querySelector('.cell-delete');
    const up = fragment.querySelector('.cell-move-up');
    const down = fragment.querySelector('.cell-move-down');
    const number = index + 1;
    fragment.querySelector('.cell-number').textContent = `Célula ${number}`;
    root.dataset.cellId = cell.id;
    runtime.value = cell.runtime;
    runtime.setAttribute('aria-label', `Runtime da célula ${number}`);
    code.value = codeDrafts.get(cell.id) ?? cell.code;
    code.maxLength = MAX_CODE_LENGTH;
    code.setAttribute('aria-label', `Código da célula ${number}`);
    run.setAttribute('aria-label', `Executar da célula 1 até a célula ${number}`);
    remove.setAttribute('aria-label', `Remover célula ${number}`);
    up.setAttribute('aria-label', `Mover célula ${number} para cima`);
    down.setAttribute('aria-label', `Mover célula ${number} para baixo`);

    runtime.addEventListener('change', () => {
      if (!flushPending()) return;
      try {
        notebook = updateCell(notebook, cell.id, { runtime: runtime.value });
        invalidateFrom(index, `O runtime da célula ${number} mudou.`);
        persistNow('Runtime alterado.');
        updateVisibleExecutions();
      } catch (error) {
        runtime.value = cell.runtime;
        setStatus(humanError(error));
      }
    });
    code.addEventListener('input', () => {
      codeDrafts.set(cell.id, code.value);
      invalidateFrom(index, `O código da célula ${number} mudou.`);
      schedulePersist();
    });
    code.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !run.disabled) {
        event.preventDefault();
        run.click();
      }
    });
    remove.addEventListener('click', () => {
      if (!window.confirm(`Remover a célula ${number}?`)) return;
      if (!flushPending()) return;
      try {
        notebook = removeCell(notebook, cell.id);
        executions.delete(cell.id);
        invalidateFrom(0, 'A estrutura do caderno mudou.');
        persistNow('Célula removida.');
        const next = notebook.cells[Math.min(index, notebook.cells.length - 1)];
        render({ focusCellId: next?.id });
      } catch (error) {
        setStatus(humanError(error));
      }
    });
    const move = (offset) => {
      if (!flushPending()) return;
      try {
        notebook = moveCell(notebook, cell.id, offset);
        invalidateFrom(0, 'A ordem das células mudou.');
        persistNow('Célula reordenada.');
        render({ focusCellId: cell.id, focusSelector: offset < 0 ? '.cell-move-up' : '.cell-move-down' });
      } catch (error) {
        setStatus(humanError(error));
      }
    };
    up.addEventListener('click', () => move(-1));
    down.addEventListener('click', () => move(1));
    run.addEventListener('click', () => {
      if (runner.active) requestCancellation();
      else void executeCanonical(cell.id);
    });

    cells.append(fragment);
    renderExecution(root, cell);
  });
  refreshControls();
  if (focusCellId) {
    const root = cells.querySelector(`[data-cell-id="${CSS.escape(focusCellId)}"]`);
    root?.querySelector(focusSelector)?.focus();
  }
}

function renderDataFiles() {
  dataFileList.replaceChildren();
  const selected = [...(dataFiles.files ?? [])];
  if (!selected.length) {
    dataFileList.append(Object.assign(document.createElement('li'), { textContent: 'Nenhum arquivo em memória.' }));
    return;
  }
  for (const file of selected) {
    const item = document.createElement('li');
    item.textContent = `/data/${file.name} · ${humanBytes(file.size)}`;
    dataFileList.append(item);
  }
}

async function preparedFiles() {
  const revision = inputRevision;
  if (!preparedInputCache || preparedInputCache.revision !== revision) {
    const selected = [...(dataFiles.files ?? [])];
    validateRuntimeFiles(selected);
    preparedInputCache = {
      revision,
      promise: prepareRuntimeFiles(selected),
    };
  }
  const prepared = await preparedInputCache.promise;
  if (revision !== inputRevision) throw new Error('A seleção de arquivos mudou durante a preparação');
  return prepared.map((file) => ({
    ...file,
    bytes: file.bytes.slice(0),
  }));
}

const runner = new CanonicalRunner({
  runtimeAdapter,
  prepareCell: async (cell) => {
    const [files, codeHash] = await Promise.all([
      preparedFiles(),
      sha256Text(cell.code),
    ]);
    return { files, codeHash };
  },
});

async function loadRuntime(kind) {
  const definition = runtimeUi.get(kind);
  if (!definition || definition.adapter.ready || runner.active || importing) return false;
  definition.loadGeneration = (definition.loadGeneration ?? 0) + 1;
  const generation = definition.loadGeneration;
  if (definition.adapter.booting) {
    definition.adapter.reset();
    setRuntimeState(kind, 'idle');
    return false;
  }
  if (!flushPending()) return false;
  setRuntimeState(kind, 'loading');
  try {
    const info = await definition.adapter.boot();
    if (generation !== definition.loadGeneration) return false;
    setRuntimeState(kind, 'ready', info);
    updateVisibleExecutions();
    return true;
  } catch (error) {
    if (generation !== definition.loadGeneration) return false;
    setRuntimeState(kind, 'error', humanError(error));
    return false;
  }
}

function requestCancellation() {
  const cellId = runner.activeCellId;
  if (!runner.cancel()) return;
  if (cellId) {
    executions.set(cellId, {
      phase: 'cancelling',
      message: 'Encerrando o runtime ativo; o ambiente desta linguagem será apagado…',
    });
  }
  updateVisibleExecutions();
}

function executionOutput(error) {
  return error instanceof Error && 'details' in error && error.details ? error.details : {};
}

async function buildRunRecord(result, startedAt) {
  const serialized = serializeNotebook(notebook);
  const notebookHash = await sha256Text(serialized);
  const records = await Promise.all(result.completed.map(async (item) => {
    const output = item.output ?? executionOutput(item.error);
    const error = item.error ? humanError(item.error) : null;
    const outputHash = await sha256Text(JSON.stringify({ output, error }));
    return {
      order: notebook.cells.findIndex((cell) => cell.id === item.cell.id) + 1,
      cellId: item.cell.id,
      runtime: item.cell.runtime,
      status: item.error ? 'error' : 'completed',
      codeHash: item.prepared?.codeHash ?? null,
      inputs: (item.prepared?.files ?? []).map(({ name, size, sha256 }) => ({ name, size, sha256 })),
      runtimeVersion: output.runtimeVersion ?? null,
      webRVersion: output.webRVersion ?? null,
      packages: output.packages ?? [],
      durationMs: output.durationMs ?? null,
      outputSha256: outputHash,
      output: {
        stdout: output.stdout ?? '',
        stderr: output.stderr ?? '',
        conditions: output.conditions ?? [],
        result: output.result ?? '',
        error,
      },
    };
  }));
  if (result.failedCellId && !records.some((record) => record.cellId === result.failedCellId)) {
    const failedCell = notebook.cells.find((cell) => cell.id === result.failedCellId);
    const failedState = executions.get(result.failedCellId);
    if (failedCell) {
      const output = failedState?.output ?? executionOutput(result.error);
      const error = humanError(result.error);
      records.push({
        order: notebook.cells.findIndex((cell) => cell.id === failedCell.id) + 1,
        cellId: failedCell.id,
        runtime: failedCell.runtime,
        status: 'error',
        codeHash: await sha256Text(failedCell.code),
        inputs: output.inputs ?? [],
        runtimeVersion: output.runtimeVersion ?? null,
        webRVersion: output.webRVersion ?? null,
        packages: output.packages ?? [],
        durationMs: output.durationMs ?? null,
        outputSha256: await sha256Text(JSON.stringify({ output, error })),
        output: {
          stdout: output.stdout ?? '',
          stderr: output.stderr ?? '',
          conditions: output.conditions ?? [],
          result: output.result ?? '',
          error,
        },
      });
    }
  }
  records.sort((left, right) => left.order - right.order);
  return createRunRecord({
    notebook,
    notebookHash,
    startedAt,
    completedAt: new Date().toISOString(),
    status: result.status,
    cells: records,
  });
}

async function executeCanonical(targetCellId = null) {
  if (runner.active || importing || !flushPending()) return;
  const plan = executionPlan(notebook.cells, targetCellId);
  if (!plan.length) return;
  const startedAt = new Date().toISOString();
  invalidateExecutions(executions, notebook.cells, {
    fromIndex: 0,
    reason: 'Uma nova execução canônica foi iniciada.',
  });
  markRunObsolete();
  updateVisibleExecutions();

  const result = await runner.run(plan, {
    onRuntimeState(kind, state, info) {
      if (state === 'ready') setRuntimeState(kind, 'ready', info);
      else if (state === 'loading') setRuntimeState(kind, 'loading');
      else if (state === 'resetting') setRuntimeState(kind, 'loading', 'reiniciando ambiente…');
      else setRuntimeState(kind, 'idle');
    },
    onCellState(cell, state) {
      if (!cell) return;
      if (state.phase === 'preparing') {
        executions.set(cell.id, {
          phase: 'preparing',
          message: `Preparando hashes e entradas (${state.index + 1}/${plan.length})…`,
        });
      } else if (state.phase === 'running') {
        executions.set(cell.id, {
          phase: 'running',
          message: `Executando em ambiente limpo (${state.index + 1}/${plan.length})…`,
        });
      } else if (state.phase === 'done') {
        executions.set(cell.id, { phase: 'done', message: 'Execução concluída.', output: state.output });
      } else if (state.phase === 'error') {
        executions.set(cell.id, {
          phase: 'error',
          message: humanError(state.error),
          output: executionOutput(state.error),
        });
      } else if (state.phase === 'cancelled') {
        executions.set(cell.id, {
          phase: 'cancelled',
          message: 'Execução cancelada. O runtime ativo foi apagado.',
        });
      }
      updateVisibleExecutions();
    },
  });

  try {
    lastRunRecord = await buildRunRecord(result, startedAt);
  } catch (error) {
    lastRunRecord = null;
    setStatus(`A execução terminou, mas o registro não pôde ser criado: ${humanError(error)}`);
    refreshControls();
    return;
  }
  if (result.status === 'completed') {
    setStatus(`${plan.length} célula(s) executada(s) desde ambientes limpos. Salve o registro para preservar as saídas e hashes.`);
  } else if (result.status === 'cancelled') {
    setStatus('Execução cancelada. O registro parcial pode ser exportado.');
  } else {
    setStatus(`Execução interrompida na célula ${result.failedCellId ?? 'desconhecida'}: ${humanError(result.error)}`);
  }
  updateVisibleExecutions();
}

async function resetAllRuntimes() {
  if (runner.active || importing || !flushPending()) return;
  try {
    await runner.resetRuntimes(registeredRuntimes(), (kind, state) => {
      setRuntimeState(kind, state === 'resetting' ? 'loading' : 'idle', state === 'resetting' ? 'reiniciando ambiente…' : null);
    });
    setStatus('Ambientes Python e R reiniciados. As saídas permanecem como registros históricos até o código ou as entradas mudarem.');
  } catch (error) {
    setStatus(`Não foi possível reiniciar todos os ambientes: ${humanError(error)}`);
  }
  refreshControls();
}

function fileName(stem, extension) {
  const safe = stem.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'analise';
  return `${safe}.${extension}`;
}

function downloadText(contents, name, type = 'application/json;charset=utf-8') {
  const blob = new Blob([contents], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}

title.addEventListener('input', () => {
  titleDraft = title.value;
  markRunObsolete();
  schedulePersist();
});
title.addEventListener('change', () => flushPending());

addCellButton.addEventListener('click', () => {
  if (!flushPending()) return;
  try {
    notebook = addCell(notebook);
    const added = notebook.cells.at(-1);
    invalidateFrom(0, 'A estrutura do caderno mudou.');
    persistNow('Célula adicionada.');
    render({ focusCellId: added.id });
  } catch (error) {
    setStatus(humanError(error));
  }
});

exportNotebook.addEventListener('click', () => {
  if (!flushPending()) return;
  downloadText(serializeNotebook(notebook), fileName(notebook.title, 'twlab'));
  setStatus('Caderno exportado. Os arquivos de dados e as saídas não foram embutidos.');
});

exportRun.addEventListener('click', () => {
  if (!lastRunRecord) return;
  downloadText(serializeRunRecord(lastRunRecord), fileName(`${notebook.title}-execucao`, 'twrun'));
  setStatus('Registro da execução exportado com saídas, versões e hashes; os microdados não foram embutidos.');
});

importNotebook.addEventListener('click', () => notebookInput.click());
notebookInput.addEventListener('change', async () => {
  const file = notebookInput.files?.[0];
  notebookInput.value = '';
  if (!file || runner.active || importing || !flushPending()) return;
  importing = true;
  const generation = ++importGeneration;
  refreshControls();
  setStatus('Lendo e validando o caderno…');
  try {
    if (file.size > MAX_NOTEBOOK_BYTES) throw new Error(`Caderno maior que ${MAX_NOTEBOOK_BYTES / 1024 / 1024} MB recusado`);
    const imported = parseNotebook(await file.text());
    if (generation !== importGeneration) return;
    storeRecovery(serializeNotebook(notebook), 'Versão anterior à importação');
    await runner.resetRuntimes(registeredRuntimes(), (kind, state) => {
      setRuntimeState(kind, state === 'resetting' ? 'loading' : 'idle', state === 'resetting' ? 'reiniciando ambiente…' : null);
    });
    notebook = imported;
    executions.clear();
    markRunObsolete();
    dataFiles.value = '';
    inputRevision += 1;
    preparedInputCache = null;
    renderDataFiles();
    persistNow('Caderno importado; ambientes e arquivos da sessão anterior foram apagados.');
    render();
  } catch (error) {
    setStatus(humanError(error));
  } finally {
    if (generation === importGeneration) importing = false;
    refreshControls();
  }
});

dataFiles.addEventListener('change', () => {
  inputRevision += 1;
  preparedInputCache = null;
  try {
    const selection = validateRuntimeFiles([...(dataFiles.files ?? [])]);
    renderDataFiles();
    invalidateFrom(0, 'Os arquivos de entrada mudaram.');
    setStatus(`${selection.files.length} arquivo(s), ${humanBytes(selection.totalBytes)}: serão montados na próxima execução.`);
  } catch (error) {
    dataFiles.value = '';
    renderDataFiles();
    invalidateFrom(0, 'A seleção de arquivos foi removida.');
    setStatus(humanError(error));
  }
});

for (const [kind, definition] of runtimeUi) {
  definition.button.addEventListener('click', () => void loadRuntime(kind));
}
runAllButton.addEventListener('click', () => {
  if (runner.active) requestCancellation();
  else void executeCanonical();
});
resetRuntimesButton.addEventListener('click', () => void resetAllRuntimes());

recoverNotebook.addEventListener('click', async () => {
  if (runner.active || importing || !flushPending()) return;
  const recoveredRaw = safeStorageGet(RECOVERY_KEY);
  if (!recoveredRaw) return;
  try {
    const recovered = parseNotebook(recoveredRaw);
    const current = serializeNotebook(notebook);
    await runner.resetRuntimes(registeredRuntimes());
    notebook = recovered;
    executions.clear();
    markRunObsolete();
    dataFiles.value = '';
    inputRevision += 1;
    preparedInputCache = null;
    renderDataFiles();
    storeRecovery(current, 'Versão anterior à recuperação');
    persistNow('Versão anterior recuperada; ambientes reiniciados.');
    render();
  } catch (error) {
    downloadText(recoveredRaw, 'tabwin-lab-recuperacao.txt', 'text/plain;charset=utf-8');
    setStatus(`A recuperação não contém um .twlab válido e foi baixada como texto bruto: ${humanError(error)}`);
  }
});

forceSave.addEventListener('click', () => {
  if (!applyDrafts()) return;
  try {
    const serialized = serializeNotebook(notebook);
    const replaced = safeStorageGet(STORAGE_KEY);
    if (replaced) storeRecovery(replaced, 'Versão substituída ao resolver conflito entre abas');
    localStorage.setItem(STORAGE_KEY, serialized);
    expectedStorageValue = serialized;
    storageConflict = false;
    setStatus(replaced
      ? 'Esta aba foi mantida por escolha explícita; a versão substituída ficou na recuperação.'
      : 'Esta aba foi mantida por escolha explícita.');
    refreshControls();
  } catch (error) {
    setStatus(humanError(error));
  }
});

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || event.newValue === expectedStorageValue) return;
  storeRecovery(serializeNotebook(notebook), 'Edição desta aba preservada após alteração em outra aba');
  storageConflict = true;
  setStatus('Outra aba alterou ou removeu este caderno. Esta aba não sobrescreverá a mudança sem sua escolha.');
  refreshControls();
});

window.addEventListener('pagehide', () => {
  clearTimeout(persistTimer);
  persistTimer = null;
  persistNow();
});

renderDataFiles();
render();
if (startupWarning) setStatus(startupWarning);
else persistNow('Caderno pronto.');
