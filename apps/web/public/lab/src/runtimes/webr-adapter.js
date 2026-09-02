export const WEBR_VERSION = '0.6.0';
export const WEBR_MODULE_URL = `https://webr.r-wasm.org/v${WEBR_VERSION}/webr.mjs`;

export const WEBR_MAX_RUNTIME_FILES = 32;
export const WEBR_MAX_RUNTIME_FILE_BYTES = 32 * 1024 * 1024;
export const WEBR_MAX_RUNTIME_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_CHARACTERS = 1_000_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export class WebRBusyError extends Error {
  constructor(message = 'Já existe uma célula R em execução') {
    super(message);
    this.name = 'WebRBusyError';
  }
}

export class WebRCancelledError extends Error {
  constructor(message = 'Execução cancelada; o estado R foi reiniciado') {
    super(message);
    this.name = 'WebRCancelledError';
  }
}

export class WebRExecutionError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'WebRExecutionError';
    this.details = details;
  }
}

export class WebRUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WebRUnavailableError';
  }
}

function defaultLoader() {
  return import(WEBR_MODULE_URL);
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle) throw new WebRUnavailableError('SHA-256 indisponível neste navegador');
  const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

function safeFileName(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > 255
    || value === '.'
    || value === '..'
    || /[\\/\0-\x1f\x7f]/u.test(value)
  ) throw new Error(`Nome de arquivo inseguro: ${String(value)}`);
  return value;
}

async function validateInputs(files, code, options, cryptoProvider) {
  const selected = [...files];
  const requestedMaximumFiles = options.maximumFiles ?? WEBR_MAX_RUNTIME_FILES;
  const requestedMaximumBytes = options.maximumBytes ?? WEBR_MAX_RUNTIME_INPUT_BYTES;
  if (!Number.isSafeInteger(requestedMaximumFiles) || requestedMaximumFiles < 0) throw new Error('Limite de arquivos inválido');
  if (!Number.isSafeInteger(requestedMaximumBytes) || requestedMaximumBytes < 0) throw new Error('Limite de bytes inválido');
  const maximumFiles = Math.min(requestedMaximumFiles, WEBR_MAX_RUNTIME_FILES);
  const maximumBytes = Math.min(requestedMaximumBytes, WEBR_MAX_RUNTIME_INPUT_BYTES);
  if (selected.length > maximumFiles) throw new Error(`No máximo ${maximumFiles} arquivos por execução R`);

  const names = new Set();
  let totalBytes = 0;
  const validated = selected.map((candidate) => {
    const name = safeFileName(candidate?.name);
    const comparableName = name.toLocaleLowerCase('pt-BR');
    if (names.has(comparableName)) throw new Error(`Nome de arquivo duplicado: ${name}`);
    names.add(comparableName);
    if (
      !Number.isSafeInteger(candidate?.size)
      || candidate.size < 0
      || candidate.size > WEBR_MAX_RUNTIME_FILE_BYTES
      || !(candidate.bytes instanceof ArrayBuffer)
      || candidate.bytes.byteLength !== candidate.size
      || typeof candidate.sha256 !== 'string'
      || !SHA256_PATTERN.test(candidate.sha256)
    ) throw new Error(`Entrada inválida para o runtime R: ${name}`);
    totalBytes += candidate.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes) {
      throw new Error(`Entradas excedem o limite de ${(maximumBytes / 1024 / 1024).toLocaleString('pt-BR')} MB`);
    }
    return {
      name,
      size: candidate.size,
      sha256: candidate.sha256,
      bytes: candidate.bytes,
    };
  });

  const codeHash = await sha256(new TextEncoder().encode(code), cryptoProvider);
  if (options.codeHash !== undefined && options.codeHash !== null) {
    if (typeof options.codeHash !== 'string' || !SHA256_PATTERN.test(options.codeHash)) {
      throw new Error('SHA-256 do código inválido');
    }
    if (options.codeHash !== codeHash) throw new Error('SHA-256 do código não corresponde ao código executado');
  }
  for (const file of validated) {
    const actualHash = await sha256(file.bytes, cryptoProvider);
    if (actualHash !== file.sha256) throw new Error(`SHA-256 não corresponde ao arquivo: ${file.name}`);
  }
  return { files: validated, codeHash };
}

function textCollector() {
  let value = '';
  let truncated = false;
  return {
    push(chunk) {
      if (truncated) return;
      const text = String(chunk ?? '');
      const available = MAX_OUTPUT_CHARACTERS - value.length;
      if (text.length > available) {
        value += text.slice(0, Math.max(0, available));
        truncated = true;
      } else {
        value += text;
      }
    },
    read() {
      return truncated ? `${value}\n[… saída truncada pelo Tabwin Lab …]` : value;
    },
    get truncated() {
      return truncated;
    },
  };
}

function convertedText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value?.message === 'string') return value.message;
  if (Array.isArray(value)) return value.map(convertedText).filter(Boolean).join(' ');
  if (Array.isArray(value?.values)) {
    const messageIndex = Array.isArray(value.names) ? value.names.indexOf('message') : -1;
    if (messageIndex >= 0) return convertedText(value.values[messageIndex]);
    return value.values.map(convertedText).filter(Boolean).join(' ');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function conditionText(value) {
  if (typeof value === 'string' || value === null || value === undefined) return convertedText(value);
  try {
    if (typeof value.get === 'function') {
      const message = await value.get('message');
      if (message && typeof message.toString === 'function') {
        const rendered = await message.toString();
        if (typeof rendered === 'string') return rendered;
      }
    }
  } catch {
    // Some condition classes are not list-like; fall through to toJs/toString.
  }
  try {
    if (typeof value.toJs === 'function') return convertedText(await value.toJs());
  } catch {
    // Fall through to the proxy's string representation.
  }
  try {
    if (typeof value.toString === 'function') return convertedText(await value.toString());
  } catch {
    return convertedText(value);
  }
  return convertedText(value);
}

async function capturedOutput(messages = []) {
  const stdout = textCollector();
  const stderr = textCollector();
  const conditions = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const type = typeof message?.type === 'string' ? message.type : 'condition';
    const data = await conditionText(message?.data);
    if (type === 'stdout') stdout.push(data);
    else if (type === 'stderr') stderr.push(data);
    else conditions.push({ type, message: data });
  }
  return {
    stdout: stdout.read(),
    stderr: stderr.read(),
    conditions,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  };
}

async function evalRVoid(runtime, code) {
  if (typeof runtime.evalRVoid === 'function') {
    await runtime.evalRVoid(code);
    return;
  }
  if (typeof runtime.evalR !== 'function') throw new WebRUnavailableError('webR não oferece avaliação R');
  const result = await runtime.evalR(code);
  if (typeof runtime.destroy === 'function') await runtime.destroy(result);
}

async function rVersion(runtime) {
  if (typeof runtime.evalRString === 'function') {
    const value = await runtime.evalRString('R.version.string');
    if (typeof value === 'string' && value) return value;
  }
  if (typeof runtime.evalR !== 'function') return 'R (versão não informada)';
  const result = await runtime.evalR('R.version.string');
  try {
    if (typeof result?.toJs === 'function') {
      const value = await result.toJs();
      if (typeof value === 'string' && value) return value;
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
      if (Array.isArray(value?.values) && typeof value.values[0] === 'string') return value.values[0];
    }
    return String(result ?? 'R (versão não informada)');
  } finally {
    if (typeof runtime.destroy === 'function') await runtime.destroy(result);
  }
}

async function installedPackages(runtime) {
  if (typeof runtime.evalRString !== 'function') return [];
  try {
    const value = await runtime.evalRString(`
local({
  p <- base::installed.packages()[, c("Package", "Version"), drop = FALSE]
  base::paste(p[, "Package"], p[, "Version"], sep = "\\t", collapse = "\\n")
})
`);
    if (typeof value !== 'string') return [];
    return value.split('\n').filter(Boolean).slice(0, 512).map((line) => {
      const [name, version = ''] = line.split('\t');
      return { name: name.slice(0, 200), version: version.slice(0, 100) };
    }).filter(({ name }) => name.length > 0);
  } catch {
    return [];
  }
}

async function mountFiles(runtime, files) {
  await evalRVoid(runtime, `
base::setwd("/")
if (base::file.exists("/data") || base::dir.exists("/data")) base::unlink("/data", recursive = TRUE, force = TRUE)
if (base::file.exists("/data") || base::dir.exists("/data")) base::stop("Não foi possível limpar /data")
if (!base::dir.create("/data", recursive = TRUE, showWarnings = FALSE) || !base::dir.exists("/data")) {
  base::stop("Não foi possível preparar /data")
}
base::setwd("/data")
`);
  if (!runtime.FS || typeof runtime.FS.writeFile !== 'function') {
    throw new WebRUnavailableError('Filesystem do webR indisponível');
  }
  for (const file of files) {
    await runtime.FS.writeFile(`/data/${file.name}`, new Uint8Array(file.bytes));
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class WebRAdapter {
  constructor(options = {}) {
    this.kind = 'r';
    this.version = WEBR_VERSION;
    this.loader = options.loader ?? defaultLoader;
    this.webROptions = options.webROptions ?? {};
    this.cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
    this.runtime = null;
    this.shelter = null;
    this.initializingRuntime = null;
    this.readyInfo = null;
    this.bootPromise = null;
    this.activeRun = null;
    this.generation = 0;
    this.closingPromise = Promise.resolve();
    this.runtimeClosures = new WeakMap();
  }

  get ready() {
    return this.readyInfo !== null;
  }

  get booting() {
    return this.bootPromise !== null;
  }

  closeRuntime(runtime) {
    if (!runtime || typeof runtime.close !== 'function') return Promise.resolve();
    if (this.runtimeClosures.has(runtime)) return this.runtimeClosures.get(runtime);
    let closing;
    try {
      closing = Promise.resolve(runtime.close());
    } catch (error) {
      closing = Promise.reject(error);
    }
    const settled = closing.catch(() => {});
    this.runtimeClosures.set(runtime, settled);
    this.closingPromise = Promise.all([this.closingPromise, settled]).then(() => undefined);
    return settled;
  }

  async boot() {
    if (this.readyInfo) return this.readyInfo;
    if (this.bootPromise) return this.bootPromise;
    const generation = this.generation;
    const operation = (async () => {
      await this.closingPromise;
      let loaded;
      try {
        loaded = await this.loader();
      } catch (error) {
        throw new WebRUnavailableError(`Não foi possível carregar webR ${WEBR_VERSION}: ${errorMessage(error)}`);
      }
      if (generation !== this.generation) throw new WebRCancelledError('Carga do webR cancelada');
      const Constructor = loaded?.WebR;
      if (typeof Constructor !== 'function') throw new WebRUnavailableError('Módulo webR inválido');
      const runtime = new Constructor(this.webROptions);
      if (!runtime || typeof runtime.init !== 'function' || typeof runtime.close !== 'function') {
        await this.closeRuntime(runtime);
        throw new WebRUnavailableError('Instância webR inválida');
      }
      this.initializingRuntime = runtime;
      try {
        await runtime.init();
        if (generation !== this.generation) throw new WebRCancelledError('Carga do webR cancelada');
        const detectedWebRVersion = typeof runtime.version === 'string' ? runtime.version : WEBR_VERSION;
        if (detectedWebRVersion !== WEBR_VERSION) {
          throw new WebRUnavailableError(`Versão webR inesperada: ${detectedWebRVersion}`);
        }
        const shelter = typeof runtime.Shelter === 'function'
          ? await new runtime.Shelter()
          : runtime.globalShelter;
        if (!shelter || typeof shelter.captureR !== 'function' || typeof shelter.purge !== 'function') {
          throw new WebRUnavailableError('Shelter do webR indisponível');
        }
        const detectedRVersion = await rVersion(runtime);
        if (generation !== this.generation) throw new WebRCancelledError('Carga do webR cancelada');
        this.runtime = runtime;
        this.shelter = shelter;
        this.readyInfo = {
          runtime: 'r',
          runtimeVersion: detectedRVersion,
          rVersion: detectedRVersion,
          webRVersion: detectedWebRVersion,
        };
        return this.readyInfo;
      } catch (error) {
        await this.closeRuntime(runtime);
        throw error;
      } finally {
        if (this.initializingRuntime === runtime) this.initializingRuntime = null;
      }
    })().catch((error) => {
      if (error instanceof WebRCancelledError || error instanceof WebRUnavailableError) throw error;
      throw new WebRUnavailableError(`Falha ao inicializar webR ${WEBR_VERSION}: ${errorMessage(error)}`);
    }).finally(() => {
      if (this.bootPromise === operation) this.bootPromise = null;
    });
    this.bootPromise = operation;
    return operation;
  }

  async run(code, options = {}) {
    if (typeof code !== 'string') throw new Error('Código R inválido');
    if (this.activeRun) throw new WebRBusyError();
    const token = {};
    let cancelReject;
    const cancelled = new Promise((resolve, reject) => {
      cancelReject = reject;
    });
    this.activeRun = { token, cancelReject };
    try {
      const prepared = await Promise.race([
        validateInputs(options.files ?? [], code, options, this.cryptoProvider),
        cancelled,
      ]);
      if (!this.activeRun || this.activeRun.token !== token) throw new WebRCancelledError();
      const runtime = await Promise.race([this.boot(), cancelled]);
      if (!this.activeRun || this.activeRun.token !== token) throw new WebRCancelledError();
      const startedAt = performance.now();
      const execution = (async () => {
        await mountFiles(this.runtime, prepared.files);
        const captured = await this.shelter.captureR(code, {
          captureStreams: true,
          captureConditions: true,
          captureGraphics: false,
          withAutoprint: true,
          throwJsException: false,
          withHandlers: true,
        });
        const streams = await capturedOutput(captured?.output);
        const packages = await installedPackages(this.runtime);
        const output = {
          runtime: 'r',
          runtimeVersion: runtime.rVersion,
          rVersion: runtime.rVersion,
          webRVersion: runtime.webRVersion,
          durationMs: Math.round(performance.now() - startedAt),
          codeHash: prepared.codeHash,
          inputs: prepared.files.map(({ name, size, sha256: fileHash }) => ({ name, size, sha256: fileHash })),
          packages,
          ...streams,
          result: '',
        };
        const failure = streams.conditions.find((condition) => condition.type === 'error');
        if (failure) throw new WebRExecutionError(failure.message || 'Falha na execução R', output);
        return output;
      })();
      try {
        return await Promise.race([execution, cancelled]);
      } catch (error) {
        if (error instanceof WebRCancelledError) throw error;
        if (error instanceof WebRExecutionError) throw error;
        const partial = await capturedOutput(error?.output);
        const packages = await installedPackages(this.runtime);
        throw new WebRExecutionError(errorMessage(error), {
          runtime: 'r',
          runtimeVersion: runtime.rVersion,
          rVersion: runtime.rVersion,
          webRVersion: runtime.webRVersion,
          durationMs: Math.round(performance.now() - startedAt),
          codeHash: prepared.codeHash,
          inputs: prepared.files.map(({ name, size, sha256: fileHash }) => ({ name, size, sha256: fileHash })),
          packages,
          ...partial,
          result: '',
        });
      } finally {
        if (this.shelter && typeof this.shelter.purge === 'function') {
          try {
            await this.shelter.purge();
          } catch {
            // Closing/resetting a runtime invalidates its shelter; no cleanup remains possible.
          }
        }
      }
    } finally {
      if (this.activeRun?.token === token) this.activeRun = null;
    }
  }

  cancel() {
    if (!this.activeRun) return false;
    this.reset(new WebRCancelledError());
    return true;
  }

  reset(error = new WebRUnavailableError('Runtime R reiniciado')) {
    this.generation += 1;
    const runtime = this.runtime;
    const initializingRuntime = this.initializingRuntime;
    this.runtime = null;
    this.shelter = null;
    this.initializingRuntime = null;
    this.readyInfo = null;
    this.bootPromise = null;
    const activeRun = this.activeRun;
    this.activeRun = null;
    if (activeRun) activeRun.cancelReject(error);
    void this.closeRuntime(runtime);
    if (initializingRuntime && initializingRuntime !== runtime) void this.closeRuntime(initializingRuntime);
  }

  dispose() {
    this.reset(new WebRUnavailableError('Runtime R encerrado'));
  }
}

export function createWebRAdapter(options = {}) {
  return new WebRAdapter(options);
}
