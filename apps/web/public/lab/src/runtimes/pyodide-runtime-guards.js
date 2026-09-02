export const PYODIDE_VERSION = '314.0.6';
export const MAX_PYODIDE_FILES = 32;
export const MAX_PYODIDE_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_PYODIDE_INPUT_BYTES = 64 * 1024 * 1024;

const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;

function comparableFileName(name) {
  return name.toLocaleLowerCase('pt-BR');
}

function validateFileName(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > 255
    || value === '.'
    || value === '..'
    || /[\\/\0-\x1f\x7f]/u.test(value)
  ) {
    throw new Error('Nome de arquivo inválido para o runtime Python');
  }
  return value;
}

export function canonicalSha256(value, { optional = false, label = 'SHA-256' } = {}) {
  if (optional && (value === null || value === undefined)) return null;
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} inválido para o runtime Python`);
  }
  return value.toLowerCase();
}

export function validateRuntimeFiles(files) {
  if (!Array.isArray(files)) throw new Error('Lista de entradas inválida para o runtime Python');
  if (files.length > MAX_PYODIDE_FILES) {
    throw new Error(`No máximo ${MAX_PYODIDE_FILES} arquivos por execução Python`);
  }

  const names = new Set();
  let totalBytes = 0;
  const metadata = files.map((file) => {
    if (
      !file
      || typeof file !== 'object'
      || !Number.isSafeInteger(file.size)
      || file.size < 0
    ) {
      throw new Error('Entrada inválida para o runtime Python');
    }

    const name = validateFileName(file.name);
    const comparableName = comparableFileName(name);
    if (names.has(comparableName)) throw new Error(`Nome de arquivo duplicado: ${name}`);
    names.add(comparableName);

    if (file.size > MAX_PYODIDE_FILE_BYTES) {
      throw new Error(`Arquivo excede o limite de ${MAX_PYODIDE_FILE_BYTES / 1024 / 1024} MB: ${name}`);
    }
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PYODIDE_INPUT_BYTES) {
      throw new Error(`Entradas excedem o limite de ${MAX_PYODIDE_INPUT_BYTES / 1024 / 1024} MB`);
    }

    return { file, name };
  });

  const transferred = new Set();
  return metadata.map(({ file, name }) => {
    if (!(file.bytes instanceof ArrayBuffer) || file.bytes.byteLength !== file.size) {
      throw new Error('Entrada inválida para o runtime Python');
    }
    if (transferred.has(file.bytes)) throw new Error('O mesmo buffer não pode representar dois arquivos');
    transferred.add(file.bytes);
    return {
      name,
      size: file.size,
      sha256: canonicalSha256(file.sha256, { label: `SHA-256 de ${name}` }),
      bytes: file.bytes,
    };
  });
}

function bytesToHex(bytes) {
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}

export async function sha256Bytes(bytes, cryptoProvider = globalThis.crypto) {
  if (!(bytes instanceof ArrayBuffer)) throw new Error('Bytes inválidos para SHA-256');
  if (!cryptoProvider?.subtle || typeof cryptoProvider.subtle.digest !== 'function') {
    throw new Error('SHA-256 indisponível no worker Python');
  }
  const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyRuntimeIntegrity(code, expectedCodeHash, candidates, cryptoProvider = globalThis.crypto) {
  if (typeof code !== 'string') throw new Error('Código Python inválido');
  const files = validateRuntimeFiles(candidates);
  const suppliedCodeHash = canonicalSha256(expectedCodeHash, { optional: true, label: 'SHA-256 do código' });
  const codeBytes = new TextEncoder().encode(code);
  const codeHash = await sha256Bytes(
    codeBytes.buffer.slice(codeBytes.byteOffset, codeBytes.byteOffset + codeBytes.byteLength),
    cryptoProvider,
  );
  if (suppliedCodeHash !== null && suppliedCodeHash !== codeHash) {
    throw new Error('SHA-256 do código não corresponde ao código recebido');
  }

  for (const file of files) {
    const actualHash = await sha256Bytes(file.bytes, cryptoProvider);
    if (actualHash !== file.sha256) {
      throw new Error(`SHA-256 não corresponde aos bytes recebidos: ${file.name}`);
    }
  }
  return { codeHash, files };
}

export function createBatchedTextCollector(maximumCharacters = 1_000_000) {
  if (!Number.isSafeInteger(maximumCharacters) || maximumCharacters < 0) {
    throw new Error('Limite de saída inválido');
  }
  let value = '';
  let truncated = false;
  return {
    push(chunk) {
      if (truncated) return;
      const text = String(chunk ?? '');
      const available = maximumCharacters - value.length;
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

function removeFileSystemNode(fileSystem, path) {
  const pending = [{ path, visited: false }];
  while (pending.length > 0) {
    const current = pending.pop();
    const stat = fileSystem.lstat(current.path);
    if (!fileSystem.isDir(stat.mode)) {
      fileSystem.unlink(current.path);
      continue;
    }
    if (current.visited) {
      fileSystem.rmdir(current.path);
      continue;
    }
    pending.push({ path: current.path, visited: true });
    const entries = fileSystem.readdir(current.path)
      .filter((name) => name !== '.' && name !== '..');
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      pending.push({ path: `${current.path}/${entries[index]}`, visited: false });
    }
  }
}

export function resetRuntimeDataDirectory(fileSystem) {
  if (
    !fileSystem
    || typeof fileSystem.lstat !== 'function'
    || typeof fileSystem.isDir !== 'function'
    || typeof fileSystem.unlink !== 'function'
    || typeof fileSystem.readdir !== 'function'
    || typeof fileSystem.rmdir !== 'function'
    || typeof fileSystem.mkdir !== 'function'
    || typeof fileSystem.chdir !== 'function'
  ) {
    throw new Error('Filesystem do runtime Python indisponível');
  }

  fileSystem.chdir('/');
  try {
    fileSystem.lstat('/data');
  } catch {
    fileSystem.mkdir('/data');
    fileSystem.chdir('/data');
    return;
  }
  removeFileSystemNode(fileSystem, '/data');
  fileSystem.mkdir('/data');
  fileSystem.chdir('/data');
}

export function mountRuntimeFiles(pyodide, files) {
  if (!pyodide?.FS || typeof pyodide.FS.writeFile !== 'function') {
    throw new Error('Filesystem do runtime Python indisponível');
  }
  resetRuntimeDataDirectory(pyodide.FS);
  for (const file of files) {
    pyodide.FS.writeFile(`/data/${file.name}`, new Uint8Array(file.bytes));
  }
}
