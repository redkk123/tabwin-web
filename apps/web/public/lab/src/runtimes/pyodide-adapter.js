import {
  MAX_PYODIDE_FILE_BYTES,
  MAX_PYODIDE_FILES,
  MAX_PYODIDE_INPUT_BYTES,
  PYODIDE_VERSION,
  canonicalSha256,
  validateRuntimeFiles,
} from './pyodide-runtime-guards.js';

export { PYODIDE_VERSION };

export class RuntimeBusyError extends Error {
  constructor(message = 'Já existe uma célula em execução') {
    super(message);
    this.name = 'RuntimeBusyError';
  }
}

export class RuntimeCancelledError extends Error {
  constructor(message = 'Execução cancelada; o estado Python foi reiniciado') {
    super(message);
    this.name = 'RuntimeCancelledError';
  }
}

export class RuntimeExecutionError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'RuntimeExecutionError';
    this.details = details;
  }
}

export class RuntimeUnavailableError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'RuntimeUnavailableError';
    this.details = details;
  }
}

function defaultWorkerFactory() {
  return new Worker(new URL('./pyodide-worker.mjs', import.meta.url), {
    type: 'module',
    name: 'tabwin-lab-python',
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function diagnosticFrom(error) {
  if (isRecord(error)) {
    return {
      name: typeof error.name === 'string' && error.name ? error.name : 'Error',
      message: typeof error.message === 'string' && error.message ? error.message : String(error),
      stack: typeof error.stack === 'string' ? error.stack : '',
    };
  }
  return { name: 'Error', message: String(error), stack: '' };
}

function attachRemoteDiagnostic(error, diagnostic) {
  error.remoteError = diagnostic;
  return error;
}

function unavailableFrom(error, fallback) {
  const diagnostic = diagnosticFrom(error);
  const message = diagnostic.message && diagnostic.message !== '[object Object]'
    ? diagnostic.message
    : fallback;
  return attachRemoteDiagnostic(new RuntimeUnavailableError(message, { remoteError: diagnostic }), diagnostic);
}

function remoteErrorFrom(message) {
  if (!isRecord(message.error) || typeof message.error.message !== 'string' || !message.error.message) {
    throw new Error('Erro malformado recebido do worker Python');
  }
  if (message.error.name !== undefined && typeof message.error.name !== 'string') {
    throw new Error('Nome de erro malformado recebido do worker Python');
  }
  if (message.error.stack !== undefined && typeof message.error.stack !== 'string') {
    throw new Error('Stack de erro malformada recebida do worker Python');
  }
  return {
    name: message.error.name || 'Error',
    message: message.error.message,
    stack: message.error.stack || '',
  };
}

function runtimeVersion(value) {
  if (typeof value !== 'string' || !value || value.length > 100) {
    throw new Error('Versão malformada recebida do worker Python');
  }
  return value;
}

function validateBootPayload(payload) {
  if (!isRecord(payload) || payload.runtime !== 'python') {
    throw new Error('Resposta de carga malformada recebida do worker Python');
  }
  return { ...payload, runtime: 'python', runtimeVersion: runtimeVersion(payload.runtimeVersion) };
}

function validateInputMetadata(inputs) {
  if (!Array.isArray(inputs) || inputs.length > MAX_PYODIDE_FILES) {
    throw new Error('Proveniência de entradas malformada recebida do worker Python');
  }
  const names = new Set();
  let totalBytes = 0;
  return inputs.map((input) => {
    if (
      !isRecord(input)
      || typeof input.name !== 'string'
      || !input.name
      || input.name.length > 255
      || input.name === '.'
      || input.name === '..'
      || /[\\/\0-\x1f\x7f]/u.test(input.name)
      || !Number.isSafeInteger(input.size)
      || input.size < 0
      || input.size > MAX_PYODIDE_FILE_BYTES
    ) {
      throw new Error('Proveniência de entrada malformada recebida do worker Python');
    }
    const comparableName = input.name.toLocaleLowerCase('pt-BR');
    if (names.has(comparableName)) throw new Error('Proveniência contém nomes de arquivo duplicados');
    names.add(comparableName);
    totalBytes += input.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PYODIDE_INPUT_BYTES) {
      throw new Error('Proveniência excede o limite de entradas do runtime Python');
    }
    return {
      name: input.name,
      size: input.size,
      sha256: canonicalSha256(input.sha256, { label: `SHA-256 de ${input.name}` }),
    };
  });
}

function validatePackageManifest(packages) {
  if (!Array.isArray(packages) || packages.length > 512) {
    throw new Error('Manifesto de pacotes malformado recebido do worker Python');
  }
  const names = new Set();
  return packages.map((item) => {
    if (
      !isRecord(item)
      || typeof item.name !== 'string'
      || !item.name
      || item.name.length > 200
      || (item.version !== null && (typeof item.version !== 'string' || item.version.length > 100))
      || typeof item.source !== 'string'
      || item.source.length > 500
      || (item.sha256 !== null && (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)))
      || names.has(item.name)
    ) throw new Error('Manifesto de pacotes malformado recebido do worker Python');
    names.add(item.name);
    return { name: item.name, version: item.version, source: item.source, sha256: item.sha256 };
  });
}

function validateRunPayload(payload, { success }) {
  if (
    !isRecord(payload)
    || payload.runtime !== 'python'
    || !Number.isFinite(payload.durationMs)
    || payload.durationMs < 0
    || typeof payload.stdout !== 'string'
    || typeof payload.stderr !== 'string'
    || typeof payload.stdoutTruncated !== 'boolean'
    || typeof payload.stderrTruncated !== 'boolean'
    || (success && typeof payload.result !== 'string')
  ) {
    throw new Error('Resposta de execução malformada recebida do worker Python');
  }
  const codeHash = canonicalSha256(payload.codeHash, {
    optional: !success,
    label: 'SHA-256 do código',
  });
  return {
    ...payload,
    runtime: 'python',
    runtimeVersion: runtimeVersion(payload.runtimeVersion),
    codeHash,
    inputs: validateInputMetadata(payload.inputs),
    packages: validatePackageManifest(payload.packages),
  };
}

function sameInputs(expected, received) {
  return expected.length === received.length && expected.every((file, index) => (
    file.name === received[index].name
    && file.size === received[index].size
    && file.sha256 === received[index].sha256
  ));
}

export class PyodideAdapter {
  constructor(options = {}) {
    this.kind = 'python';
    this.version = PYODIDE_VERSION;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.bootTimeoutMs = options.bootTimeoutMs ?? 180_000;
    this.runTimeoutMs = options.runTimeoutMs ?? 0;
    this.worker = null;
    this.readyInfo = null;
    this.bootPromise = null;
    this.pending = new Map();
    this.activeRunId = null;
    this.nextRequestId = 1;
  }

  get ready() {
    return this.readyInfo !== null;
  }

  get booting() {
    return this.bootPromise !== null;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    let worker;
    try {
      worker = this.workerFactory();
    } catch (error) {
      throw unavailableFrom(error, 'Falha ao criar o worker Python');
    }
    if (
      !worker
      || typeof worker.postMessage !== 'function'
      || typeof worker.terminate !== 'function'
      || typeof worker.addEventListener !== 'function'
    ) {
      throw new RuntimeUnavailableError('Worker Python indisponível');
    }
    this.worker = worker;
    worker.addEventListener('message', (event) => {
      if (this.worker === worker) this.receive(event.data);
    });
    worker.addEventListener('error', (event) => {
      if (this.worker !== worker) return;
      const message = event?.message || 'Falha ao carregar o worker Python';
      const diagnostic = diagnosticFrom(event?.error ?? {
        name: 'WorkerError',
        message,
        stack: '',
      });
      this.reset(attachRemoteDiagnostic(
        new RuntimeUnavailableError(message, { remoteError: diagnostic }),
        diagnostic,
      ));
    });
    worker.addEventListener('messageerror', () => {
      if (this.worker === worker) this.reset(new RuntimeUnavailableError('Resposta inválida do worker Python'));
    });
    return worker;
  }

  request(type, payload = {}, transfer = [], timeoutMs = 0) {
    const worker = this.ensureWorker();
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs > 0 ? setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.reset(new RuntimeUnavailableError(
          type === 'boot' ? 'O carregamento do Python excedeu o tempo limite' : 'A execução excedeu o tempo limite',
        ));
      }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timeout, type });
      try {
        worker.postMessage({ ...payload, id, type }, transfer);
      } catch (error) {
        this.reset(unavailableFrom(error, 'Falha ao enviar uma operação ao worker Python'));
      }
    });
  }

  receive(message) {
    if (!isRecord(message) || !Number.isSafeInteger(message.id) || message.id < 1) {
      if (this.pending.size > 0) {
        this.reset(new RuntimeUnavailableError('Resposta malformada recebida do worker Python'));
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    if (typeof message.ok !== 'boolean') {
      this.reset(new RuntimeUnavailableError('Resposta malformada recebida do worker Python'));
      return;
    }

    if (message.ok) {
      let payload;
      try {
        payload = pending.type === 'boot'
          ? validateBootPayload(message.payload)
          : validateRunPayload(message.payload, { success: true });
        if (
          pending.type === 'run'
          && this.readyInfo
          && payload.runtimeVersion !== this.readyInfo.runtimeVersion
        ) {
          throw new Error('A versão da execução diverge da versão carregada do runtime Python');
        }
      } catch (error) {
        this.reset(new RuntimeUnavailableError(error instanceof Error ? error.message : String(error)));
        return;
      }
      this.pending.delete(message.id);
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.resolve(payload);
      return;
    }

    let remote;
    let details = null;
    try {
      remote = remoteErrorFrom(message);
      if (pending.type === 'boot') {
        if (message.payload !== null && message.payload !== undefined) {
          throw new Error('Falha de carga trouxe payload malformado do worker Python');
        }
      } else if (remote.name !== 'RuntimeBusyError' || message.payload !== null) {
        details = validateRunPayload(message.payload, { success: false });
        if (this.readyInfo && details.runtimeVersion !== this.readyInfo.runtimeVersion) {
          throw new Error('A versão do erro diverge da versão carregada do runtime Python');
        }
      }
    } catch (error) {
      this.reset(new RuntimeUnavailableError(error instanceof Error ? error.message : String(error)));
      return;
    }

    this.pending.delete(message.id);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (pending.type === 'boot') {
      pending.reject(attachRemoteDiagnostic(
        new RuntimeUnavailableError(remote.message, { remoteError: remote }),
        remote,
      ));
      return;
    }
    if (remote.name === 'RuntimeBusyError') {
      const error = attachRemoteDiagnostic(new RuntimeBusyError(remote.message), remote);
      error.details = details;
      pending.reject(error);
      return;
    }
    pending.reject(attachRemoteDiagnostic(new RuntimeExecutionError(remote.message, details), remote));
  }

  async boot() {
    if (this.readyInfo) return this.readyInfo;
    if (this.bootPromise) return this.bootPromise;
    const worker = this.ensureWorker();
    const operation = this.request('boot', {}, [], this.bootTimeoutMs)
      .then((info) => {
        if (this.worker !== worker) throw new RuntimeUnavailableError('O worker Python foi substituído durante a carga');
        this.readyInfo = info;
        this.version = info.runtimeVersion;
        return info;
      })
      .catch((error) => {
        if (this.worker === worker) this.reset(error);
        throw error;
      })
      .finally(() => {
        if (this.bootPromise === operation) this.bootPromise = null;
      });
    this.bootPromise = operation;
    return operation;
  }

  async run(code, options = {}) {
    if (typeof code !== 'string') throw new Error('Código Python inválido');
    if (this.activeRunId !== null) throw new RuntimeBusyError();
    const files = validateRuntimeFiles(options.files ?? []);
    const codeHash = canonicalSha256(options.codeHash, { optional: true, label: 'SHA-256 do código' });
    const transfer = files.map((file) => file.bytes);
    const runToken = Symbol('python-run');
    this.activeRunId = runToken;
    try {
      await this.boot();
      if (this.activeRunId !== runToken) throw new RuntimeCancelledError();
      const output = await this.request('run', {
        code,
        codeHash,
        files,
      }, transfer, this.runTimeoutMs);
      if (
        (codeHash !== null && output.codeHash !== codeHash)
        || !sameInputs(files, output.inputs)
      ) {
        const error = new RuntimeUnavailableError('A proveniência retornada pelo worker Python diverge da requisição');
        this.reset(error);
        throw error;
      }
      return output;
    } finally {
      if (this.activeRunId === runToken) this.activeRunId = null;
    }
  }

  cancel() {
    if (this.activeRunId === null) return false;
    this.reset(new RuntimeCancelledError());
    return true;
  }

  reset(error = new RuntimeUnavailableError('Runtime Python reiniciado')) {
    const resetError = error instanceof Error
      ? error
      : unavailableFrom(error, 'Runtime Python reiniciado');
    const worker = this.worker;
    this.worker = null;
    this.readyInfo = null;
    this.version = PYODIDE_VERSION;
    this.bootPromise = null;
    this.activeRunId = null;
    try {
      if (worker) worker.terminate();
    } catch (terminationError) {
      if (!('terminationError' in resetError)) {
        try {
          resetError.terminationError = diagnosticFrom(terminationError);
        } catch {
          // O erro original continua sendo a causa principal mesmo se for imutável.
        }
      }
    } finally {
      for (const pending of this.pending.values()) {
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.reject(resetError);
      }
      this.pending.clear();
    }
  }

  dispose() {
    this.reset(new RuntimeUnavailableError('Runtime Python encerrado'));
  }
}
