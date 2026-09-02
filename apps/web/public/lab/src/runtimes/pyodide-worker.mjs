import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide.mjs';
import {
  PYODIDE_VERSION,
  createBatchedTextCollector,
  mountRuntimeFiles,
  validateRuntimeFiles,
  verifyRuntimeIntegrity,
} from './pyodide-runtime-guards.js';

const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const MAX_OUTPUT_CHARACTERS = 1_000_000;
let pyodidePromise = null;
let activeRunId = null;
let loadedRuntimeVersion = null;

function plainError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error && typeof error.stack === 'string' ? error.stack.slice(0, 20_000) : '',
  };
}

function respond(id, ok, payload = null, error = null) {
  self.postMessage({ id, ok, payload, error });
}

function packageManifest(pyodide) {
  const loaded = pyodide?.loadedPackages;
  if (!loaded || typeof loaded !== 'object') return [];
  const lockPackages = pyodide?.lockfile?.packages ?? {};
  return Object.entries(loaded)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .slice(0, 512)
    .map(([name, source]) => {
      const locked = lockPackages[name] ?? {};
      return {
        name: String(name).slice(0, 200),
        version: typeof locked.version === 'string' ? locked.version.slice(0, 100) : null,
        source: String(source ?? '').slice(0, 500),
        sha256: typeof locked.sha256 === 'string' ? locked.sha256.toLowerCase() : null,
      };
    });
}

async function boot() {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  }
  const pyodide = await pyodidePromise;
  if (typeof pyodide.version !== 'string' || !pyodide.version) {
    throw new Error('O runtime Python carregado não informou sua versão');
  }
  loadedRuntimeVersion = pyodide.version;
  if (loadedRuntimeVersion !== PYODIDE_VERSION) {
    throw new Error(`Versão inesperada do runtime Python: ${loadedRuntimeVersion}`);
  }
  pyodide.setStdin({ error: true });
  return pyodide;
}

function renderResult(value) {
  if (value === undefined || value === null) return '';
  try {
    const rendered = String(value);
    return rendered.length > MAX_OUTPUT_CHARACTERS
      ? `${rendered.slice(0, MAX_OUTPUT_CHARACTERS)}\n[… resultado truncado pelo Tabwin Lab …]`
      : rendered;
  } finally {
    if (value && typeof value.destroy === 'function') value.destroy();
  }
}

async function execute(message) {
  if (activeRunId !== null) {
    respond(message.id, false, null, {
      name: 'RuntimeBusyError',
      message: 'O runtime Python já está executando outra célula',
      stack: '',
    });
    return;
  }
  activeRunId = message.id;
  const startedAt = performance.now();
  const stdout = createBatchedTextCollector(MAX_OUTPUT_CHARACTERS);
  const stderr = createBatchedTextCollector(MAX_OUTPUT_CHARACTERS);
  let files = [];
  let packages = [];
  let codeHash = null;
  let runtimeVersion = loadedRuntimeVersion;
  const baseOutput = () => ({
    runtime: 'python',
    runtimeVersion,
    durationMs: Math.round(performance.now() - startedAt),
    codeHash,
    inputs: files.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
    packages,
    stdout: stdout.read(),
    stderr: stderr.read(),
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  });
  try {
    if (typeof message.code !== 'string') throw new Error('Código Python inválido');
    const candidates = validateRuntimeFiles(message.files);
    const pyodide = await boot();
    runtimeVersion = loadedRuntimeVersion;
    const verified = await verifyRuntimeIntegrity(message.code, message.codeHash, candidates);
    codeHash = verified.codeHash;
    files = verified.files;
    pyodide.setStdout({ batched: (line) => stdout.push(line) });
    pyodide.setStderr({ batched: (line) => stderr.push(line) });
    mountRuntimeFiles(pyodide, files);
    await pyodide.loadPackagesFromImports(message.code);
    packages = packageManifest(pyodide);
    const result = await pyodide.runPythonAsync(message.code);
    respond(message.id, true, { ...baseOutput(), result: renderResult(result) });
  } catch (error) {
    respond(message.id, false, baseOutput(), plainError(error));
  } finally {
    activeRunId = null;
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || !Number.isSafeInteger(message.id)) return;
  if (message.type === 'boot') {
    void boot()
      .then((pyodide) => respond(message.id, true, {
        runtime: 'python',
        runtimeVersion: pyodide.version,
      }))
      .catch((error) => respond(message.id, false, null, plainError(error)));
    return;
  }
  if (message.type === 'run') {
    void execute(message);
    return;
  }
  respond(message.id, false, null, { name: 'Error', message: 'Operação de runtime desconhecida', stack: '' });
});
