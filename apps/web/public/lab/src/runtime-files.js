export const MAX_RUNTIME_FILES = 32;
export const MAX_RUNTIME_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_RUNTIME_INPUT_BYTES = 64 * 1024 * 1024;

export function runtimeFileName(value) {
  if (typeof value !== 'string' || !value || value.length > 255) {
    throw new Error('Nome de arquivo inválido');
  }
  if (value === '.' || value === '..' || /[\\/\0-\x1f\x7f]/u.test(value)) {
    throw new Error(`Nome de arquivo inseguro: ${value}`);
  }
  return value;
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function digestSha256(bytes, cryptoProvider) {
  if (!cryptoProvider?.subtle) throw new Error('SHA-256 indisponível neste navegador');
  return bytesToHex(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', bytes)));
}

export async function sha256Text(value, cryptoProvider = globalThis.crypto) {
  if (typeof value !== 'string') throw new Error('Texto inválido para hash');
  return digestSha256(new TextEncoder().encode(value), cryptoProvider);
}

export function validateRuntimeFiles(files, options = {}) {
  const selected = [...files];
  const maximumFiles = options.maximumFiles ?? MAX_RUNTIME_FILES;
  const maximumFileBytes = options.maximumFileBytes ?? MAX_RUNTIME_FILE_BYTES;
  const maximumBytes = options.maximumBytes ?? MAX_RUNTIME_INPUT_BYTES;

  if (!Number.isSafeInteger(maximumFiles) || maximumFiles < 0) throw new Error('Limite de arquivos inválido');
  if (!Number.isSafeInteger(maximumFileBytes) || maximumFileBytes < 0) throw new Error('Limite por arquivo inválido');
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error('Limite de bytes inválido');
  if (selected.length > maximumFiles) throw new Error(`No máximo ${maximumFiles} arquivos por execução`);

  const names = new Set();
  let totalBytes = 0;
  for (const file of selected) {
    const name = runtimeFileName(file?.name);
    const comparableName = name.toLowerCase();
    if (names.has(comparableName)) throw new Error(`Nome de arquivo duplicado: ${name}`);
    names.add(comparableName);
    if (!Number.isSafeInteger(file?.size) || file.size < 0 || typeof file.arrayBuffer !== 'function') {
      throw new Error(`Arquivo inválido: ${name}`);
    }
    if (file.size > maximumFileBytes) {
      throw new Error(`Arquivo excede o limite de ${(maximumFileBytes / 1024 / 1024).toLocaleString('pt-BR')} MB: ${name}`);
    }
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumBytes) {
      throw new Error(`Entradas excedem o limite de ${(maximumBytes / 1024 / 1024).toLocaleString('pt-BR')} MB`);
    }
  }
  return { files: selected, totalBytes };
}

export async function prepareRuntimeFiles(files, options = {}) {
  const maximumFiles = options.maximumFiles ?? MAX_RUNTIME_FILES;
  const maximumFileBytes = options.maximumFileBytes ?? MAX_RUNTIME_FILE_BYTES;
  const maximumBytes = options.maximumBytes ?? MAX_RUNTIME_INPUT_BYTES;
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
  const { files: selected } = validateRuntimeFiles(files, { maximumFiles, maximumFileBytes, maximumBytes });

  const prepared = [];
  for (const file of selected) {
    const bytes = await file.arrayBuffer();
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) {
      throw new Error(`Leitura incompleta do arquivo: ${file.name}`);
    }
    prepared.push({
      name: file.name,
      size: bytes.byteLength,
      sha256: await digestSha256(bytes, cryptoProvider),
      bytes,
    });
  }
  return prepared;
}
