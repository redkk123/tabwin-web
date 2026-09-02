export const NOTEBOOK_SCHEMA = 'tabwin-lab.notebook';
export const NOTEBOOK_VERSION = 1;
export const MAX_CELLS = 500;
export const MAX_CODE_LENGTH = 1_000_000;
export const MAX_NOTEBOOK_BYTES = 5 * 1024 * 1024;
export const NOTEBOOK_SIZE_ERROR_MESSAGE = `Caderno excede o limite de ${MAX_NOTEBOOK_BYTES / 1024 / 1024} MB`;
const RUNTIMES = new Set(['python', 'r']);

export class NotebookSizeError extends Error {
  constructor(message = NOTEBOOK_SIZE_ERROR_MESSAGE) {
    super(message);
    this.name = 'NotebookSizeError';
  }
}

function isoDate(value, field) {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) throw new Error(`${field} inválido`);
  return value;
}

function nonEmpty(value, field, maximum = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${field} inválido`);
  return value;
}

function validateCell(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Célula inválida');
  const id = nonEmpty(value.id, 'ID da célula', 100);
  if (!RUNTIMES.has(value.runtime)) throw new Error(`Runtime inválido na célula ${id}`);
  if (typeof value.code !== 'string' || value.code.length > MAX_CODE_LENGTH) throw new Error(`Código inválido na célula ${id}`);
  return { id, runtime: value.runtime, code: value.code };
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > MAX_NOTEBOOK_BYTES) return bytes;
  }
  return bytes;
}

function assertNotebookSize(serialized) {
  if (utf8ByteLength(serialized) > MAX_NOTEBOOK_BYTES) throw new NotebookSizeError();
}

function compareKeys(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => compareKeys(left, right)).map(([key, item]) => [key, stable(item)]),
  );
  return value;
}

function canonicalSerialization(notebook) {
  return `${JSON.stringify(stable(notebook), null, 2)}\n`;
}

function validateNotebook(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Caderno inválido');
  if (value.schema !== NOTEBOOK_SCHEMA || value.version !== NOTEBOOK_VERSION) throw new Error('Formato de caderno não suportado');
  if (!Array.isArray(value.cells) || value.cells.length > MAX_CELLS) throw new Error('Quantidade de células inválida');
  const cells = value.cells.map(validateCell);
  if (new Set(cells.map((cell) => cell.id)).size !== cells.length) throw new Error('IDs de célula duplicados');
  const createdAt = isoDate(value.createdAt, 'Data de criação');
  const updatedAt = isoDate(value.updatedAt, 'Data de atualização');
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error('Data de atualização anterior à criação');
  return {
    schema: NOTEBOOK_SCHEMA,
    version: NOTEBOOK_VERSION,
    id: nonEmpty(value.id, 'ID do caderno', 100),
    title: nonEmpty(value.title, 'Título do caderno'),
    createdAt,
    updatedAt,
    cells,
  };
}

export function parseNotebook(payload) {
  if (typeof payload === 'string') assertNotebookSize(payload);
  const notebook = validateNotebook(typeof payload === 'string' ? JSON.parse(payload) : payload);
  assertNotebookSize(canonicalSerialization(notebook));
  return notebook;
}

export function monotonicUpdatedAt(notebook, now = new Date().toISOString()) {
  const current = isoDate(now, 'Data de atualização');
  const createdAt = isoDate(notebook?.createdAt, 'Data de criação');
  const previous = isoDate(notebook?.updatedAt, 'Data de atualização');
  return new Date(Math.max(Date.parse(current), Date.parse(createdAt), Date.parse(previous))).toISOString();
}

export function createNotebook(options = {}) {
  const now = options.now ?? new Date().toISOString();
  const id = options.id ?? crypto.randomUUID();
  return parseNotebook({
    schema: NOTEBOOK_SCHEMA,
    version: NOTEBOOK_VERSION,
    id,
    title: options.title ?? 'Nova análise',
    createdAt: now,
    updatedAt: now,
    cells: [{ id: options.cellId ?? crypto.randomUUID(), runtime: 'python', code: '# Escreva a primeira análise aqui\n' }],
  });
}

export function addCell(notebook, runtime = 'python', id = crypto.randomUUID(), now = new Date().toISOString()) {
  return parseNotebook({
    ...notebook,
    updatedAt: monotonicUpdatedAt(notebook, now),
    cells: [...notebook.cells, { id, runtime, code: '' }],
  });
}

export function updateCell(notebook, id, patch, now = new Date().toISOString()) {
  let found = false;
  const cells = notebook.cells.map((cell) => {
    if (cell.id !== id) return cell;
    found = true;
    return { ...cell, ...patch, id };
  });
  if (!found) throw new Error(`Célula não encontrada: ${id}`);
  return parseNotebook({ ...notebook, updatedAt: monotonicUpdatedAt(notebook, now), cells });
}

export function removeCell(notebook, id, now = new Date().toISOString()) {
  const cells = notebook.cells.filter((cell) => cell.id !== id);
  if (cells.length === notebook.cells.length) throw new Error(`Célula não encontrada: ${id}`);
  return parseNotebook({ ...notebook, updatedAt: monotonicUpdatedAt(notebook, now), cells });
}

export function moveCell(notebook, id, offset, now = new Date().toISOString()) {
  if (!Number.isSafeInteger(offset) || ![-1, 1].includes(offset)) throw new Error('Movimento de célula inválido');
  const from = notebook.cells.findIndex((cell) => cell.id === id);
  if (from < 0) throw new Error(`Célula não encontrada: ${id}`);
  const to = from + offset;
  if (to < 0 || to >= notebook.cells.length) return notebook;
  const cells = [...notebook.cells];
  [cells[from], cells[to]] = [cells[to], cells[from]];
  return parseNotebook({ ...notebook, updatedAt: monotonicUpdatedAt(notebook, now), cells });
}

export function serializeNotebook(notebook) {
  if (typeof notebook === 'string') assertNotebookSize(notebook);
  const value = typeof notebook === 'string' ? JSON.parse(notebook) : notebook;
  const serialized = canonicalSerialization(validateNotebook(value));
  assertNotebookSize(serialized);
  return serialized;
}
