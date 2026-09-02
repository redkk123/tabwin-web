import {
  addCell,
  createNotebook,
  parseNotebook,
  removeCell,
  serializeNotebook,
  updateCell,
} from './notebook-model.js';
import { registerRuntimeAdapter, runtimeAdapter } from './runtime-adapter.js';
import { prepareRuntimeFiles, sha256Text } from './runtime-files.js';
import {
  PyodideAdapter,
  RuntimeCancelledError,
} from './runtimes/pyodide-adapter.js';

const STORAGE_KEY = 'tabwin-lab.notebook.v1';
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
const dataFiles = element('#data-files');
const dataFileList = element('#data-file-list');
const loadPython = element('#load-python');
const pythonRuntimeStatus = element('#python-runtime-status');

const pythonAdapter = new PyodideAdapter();
registerRuntimeAdapter(pythonAdapter);

const executions = new Map();
let activeExecution = null;
let startupWarning = '';
let notebook;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  notebook = saved ? parseNotebook(saved) : createNotebook();
} catch {
  notebook = createNotebook();
  startupWarning = 'O caderno salvo estava inacessível ou inválido. Ele não foi sobrescrito automaticamente; esta aba começou com um caderno novo.';
}

function humanError(error) {
  return error instanceof Error ? error.message : String(error);
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes.toLocaleString('pt-BR')} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function persist(message = 'Salvo apenas neste navegador.') {
  try {
    localStorage.setItem(STORAGE_KEY, serializeNotebook(notebook));
    status.textContent = `${message} Atualizado ${new Date(notebook.updatedAt).toLocaleTimeString('pt-BR')}.`;
  } catch {
    status.textContent = 'O caderno continua nesta aba, mas o navegador recusou a persistência local.';
  }
}

function setTitle(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    title.value = notebook.title;
    status.textContent = 'O nome do caderno não pode ficar vazio.';
    return;
  }
  notebook = parseNotebook({ ...notebook, title: trimmed, updatedAt: new Date().toISOString() });
  persist();
}

function setPythonRuntimeState(state, message) {
  pythonRuntimeStatus.dataset.state = state;
  pythonRuntimeStatus.textContent = message;
  if (state === 'loading') loadPython.textContent = 'Carregando…';
  else if (state === 'ready') loadPython.textContent = 'Python pronto';
  else if (state === 'error') loadPython.textContent = 'Tentar novamente';
  else loadPython.textContent = 'Carregar Python';
  refreshControls();
}

function defaultCellStatus(cell) {
  if (cell.runtime === 'r') return 'webR ainda não foi conectado — código não foi executado.';
  if (!pythonAdapter.ready) return 'Carregue o Python acima para executar esta célula.';
  return 'Pronta. Arquivos selecionados estarão disponíveis em /data.';
}

function setOutputBlock(root, selector, value) {
  const block = root.querySelector(selector);
  const text = typeof value === 'string' ? value : '';
  block.hidden = text.length === 0;
  block.querySelector('pre').textContent = text;
}

function renderExecution(root, cell) {
  const state = executions.get(cell.id);
  const cellStatus = root.querySelector('.cell-status');
  const outputRoot = root.querySelector('.cell-output');
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

  const output = state.output ?? {};
  const isError = state.phase === 'error';
  cellStatus.textContent = isError ? 'A célula falhou; as células anteriores não foram alteradas.' : 'Execução concluída.';
  outputRoot.hidden = false;
  setOutputBlock(root, '.output-error', isError ? state.message : '');
  setOutputBlock(root, '.output-stdout', output.stdout);
  setOutputBlock(root, '.output-stderr', output.stderr);
  setOutputBlock(root, '.output-result', output.result);

  const visibleBlocks = [...outputRoot.querySelectorAll('.output-block')].some((block) => !block.hidden);
  outputRoot.querySelector('.output-empty').hidden = visibleBlocks || isError;
  const metadata = [];
  if (output.runtimeVersion) metadata.push(`Python ${output.runtimeVersion}`);
  if (Number.isFinite(output.durationMs)) metadata.push(`${(output.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s`);
  if (output.codeHash) metadata.push(`código ${output.codeHash.slice(0, 12)}…`);
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
  provenance.hidden = provenanceList.children.length === 0;
}

function refreshControls() {
  const hasActiveExecution = activeExecution !== null;
  loadPython.disabled = pythonAdapter.booting || pythonAdapter.ready || hasActiveExecution;
  importNotebook.disabled = hasActiveExecution;
  dataFiles.disabled = hasActiveExecution;
  for (const root of cells.querySelectorAll('.cell')) {
    const cell = notebook.cells.find((candidate) => candidate.id === root.dataset.cellId);
    if (!cell) continue;
    const state = executions.get(cell.id);
    const isRunning = state && ['preparing', 'running', 'cancelling'].includes(state.phase);
    const run = root.querySelector('.cell-run');
    run.textContent = isRunning ? (state.phase === 'cancelling' ? 'Cancelando…' : 'Cancelar') : 'Executar';
    run.classList.toggle('danger', Boolean(isRunning));
    run.disabled = isRunning
      ? state.phase === 'cancelling'
      : hasActiveExecution || runtimeAdapter(cell.runtime)?.ready !== true;
    run.title = isRunning
      ? 'Cancelar e reiniciar o runtime'
      : runtimeAdapter(cell.runtime)?.ready === true
        ? 'Executar nesta runtime'
        : 'Runtime ainda não carregado';
    root.querySelector('.cell-runtime').disabled = Boolean(isRunning);
    root.querySelector('.cell-code').disabled = Boolean(isRunning);
    root.querySelector('.cell-delete').disabled = hasActiveExecution;
  }
}

function render() {
  title.value = notebook.title;
  cells.replaceChildren();
  notebook.cells.forEach((cell, index) => {
    const fragment = template.content.cloneNode(true);
    const root = fragment.querySelector('.cell');
    const runtime = fragment.querySelector('.cell-runtime');
    const code = fragment.querySelector('.cell-code');
    const run = fragment.querySelector('.cell-run');
    fragment.querySelector('.cell-number').textContent = `Célula ${index + 1}`;
    runtime.value = cell.runtime;
    code.value = cell.code;
    runtime.addEventListener('change', () => {
      notebook = updateCell(notebook, cell.id, { runtime: runtime.value });
      executions.delete(cell.id);
      persist();
      render();
    });
    code.addEventListener('input', () => {
      notebook = updateCell(notebook, cell.id, { code: code.value });
      executions.delete(cell.id);
      persist();
      renderExecution(root, notebook.cells.find((candidate) => candidate.id === cell.id));
      refreshControls();
    });
    code.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !run.disabled) {
        event.preventDefault();
        run.click();
      }
    });
    fragment.querySelector('.cell-delete').addEventListener('click', () => {
      notebook = removeCell(notebook, cell.id);
      executions.delete(cell.id);
      persist('Célula removida.');
      render();
    });
    run.addEventListener('click', () => {
      if (activeExecution?.cellId === cell.id) requestCancellation(cell.id);
      else void executeCell(cell.id);
    });
    root.dataset.cellId = cell.id;
    renderExecution(root, cell);
    cells.append(fragment);
  });
  refreshControls();
}

async function loadPythonRuntime() {
  if (pythonAdapter.ready) return true;
  setPythonRuntimeState('loading', 'baixando e inicializando…');
  try {
    const info = await pythonAdapter.boot();
    setPythonRuntimeState('ready', `pronto · ${info.runtimeVersion}`);
    render();
    return true;
  } catch (error) {
    setPythonRuntimeState('error', humanError(error));
    render();
    return false;
  }
}

function requestCancellation(cellId) {
  const token = activeExecution;
  if (!token || token.cellId !== cellId || token.cancelled) return;
  token.cancelled = true;
  const adapter = runtimeAdapter(token.runtime);
  token.runtimeInterrupted = typeof adapter?.cancel === 'function' && adapter.cancel();
  executions.set(cellId, {
    phase: 'cancelling',
    message: token.runtimeInterrupted
      ? 'Encerrando o worker; o estado Python desta sessão será apagado…'
      : 'Cancelando antes de enviar a célula ao runtime…',
  });
  const root = cells.querySelector(`[data-cell-id="${CSS.escape(cellId)}"]`);
  const cell = notebook.cells.find((candidate) => candidate.id === cellId);
  if (root && cell) renderExecution(root, cell);
  refreshControls();
}

async function executeCell(cellId) {
  const cell = notebook.cells.find((candidate) => candidate.id === cellId);
  const adapter = cell ? runtimeAdapter(cell.runtime) : null;
  if (!cell || !adapter?.ready || activeExecution) return;

  const token = { cellId, runtime: cell.runtime, cancelled: false, runtimeInterrupted: false };
  activeExecution = token;
  executions.set(cellId, { phase: 'preparing', message: 'Lendo e calculando os hashes das entradas locais…' });
  render();
  let cancelled = false;
  try {
    const selectedFiles = [...(dataFiles.files ?? [])];
    const [files, codeHash] = await Promise.all([
      prepareRuntimeFiles(selectedFiles),
      sha256Text(cell.code),
    ]);
    if (token.cancelled) throw new RuntimeCancelledError('Execução cancelada antes de iniciar');
    executions.set(cellId, {
      phase: 'running',
      message: 'Executando. Imports podem baixar pacotes pinados do Pyodide…',
    });
    render();
    const output = await adapter.run(cell.code, { files, codeHash });
    if (token.cancelled) throw new RuntimeCancelledError();
    executions.set(cellId, { phase: 'done', message: 'Execução concluída.', output });
  } catch (error) {
    cancelled = token.cancelled || error instanceof RuntimeCancelledError;
    if (cancelled) {
      executions.set(cellId, {
        phase: 'cancelled',
        message: token.runtimeInterrupted
          ? 'Execução cancelada. O estado Python foi apagado e será recarregado.'
          : 'Execução cancelada antes de chegar ao runtime.',
      });
    } else {
      executions.set(cellId, {
        phase: 'error',
        message: humanError(error),
        output: error instanceof Error && 'details' in error ? error.details : null,
      });
      if (cell.runtime === 'python' && !pythonAdapter.ready) {
        setPythonRuntimeState('error', 'worker interrompido; recarregue o Python');
      }
    }
  } finally {
    if (activeExecution === token) activeExecution = null;
    render();
    if (cancelled && token.runtimeInterrupted) await loadPythonRuntime();
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

title.addEventListener('change', () => setTitle(title.value));
element('#add-cell').addEventListener('click', () => {
  notebook = addCell(notebook);
  persist('Célula adicionada.');
  render();
});
element('#export-notebook').addEventListener('click', () => {
  const blob = new Blob([serializeNotebook(notebook)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${notebook.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'analise'}.twlab`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
});
importNotebook.addEventListener('click', () => notebookInput.click());
notebookInput.addEventListener('change', async () => {
  const file = notebookInput.files?.[0];
  notebookInput.value = '';
  if (!file || activeExecution) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Caderno maior que 5 MB recusado');
    notebook = parseNotebook(await file.text());
    executions.clear();
    persist('Caderno importado.');
    render();
  } catch (error) {
    status.textContent = humanError(error);
  }
});
dataFiles.addEventListener('change', renderDataFiles);
loadPython.addEventListener('click', () => void loadPythonRuntime());

renderDataFiles();
render();
if (startupWarning) status.textContent = startupWarning;
else persist('Caderno pronto.');
