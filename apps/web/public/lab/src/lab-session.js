export const RUN_SCHEMA = 'tabwin-lab.run';
export const RUN_VERSION = 1;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function compareKeys(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareKeys(left, right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function executionPlan(cells, targetCellId = null) {
  if (!Array.isArray(cells)) throw new Error('Lista de células inválida');
  const end = targetCellId === null
    ? cells.length
    : cells.findIndex((cell) => cell.id === targetCellId) + 1;
  if (targetCellId !== null && end === 0) throw new Error(`Célula não encontrada: ${targetCellId}`);
  return cells.slice(0, end);
}

export function invalidateExecutions(executions, cells, options = {}) {
  if (!(executions instanceof Map)) throw new Error('Registro de execuções inválido');
  const fromIndex = options.fromIndex ?? 0;
  const reason = options.reason ?? 'O caderno mudou desde esta execução.';
  if (!Number.isSafeInteger(fromIndex) || fromIndex < 0 || fromIndex > cells.length) {
    throw new Error('Índice de invalidação inválido');
  }

  for (const cell of cells.slice(fromIndex)) {
    const current = executions.get(cell.id);
    if (!current || ['preparing', 'running', 'cancelling'].includes(current.phase)) continue;
    executions.set(cell.id, {
      ...current,
      staleFromPhase: current.staleFromPhase ?? current.phase,
      stalePreviousMessage: current.stalePreviousMessage ?? current.message,
      phase: 'stale',
      staleReason: reason,
      message: reason,
    });
  }
  return executions;
}

export function createRunRecord({ notebook, notebookHash, startedAt, completedAt, status, cells }) {
  if (!notebook || typeof notebook !== 'object') throw new Error('Caderno ausente no registro');
  if (typeof notebookHash !== 'string' || !/^[a-f0-9]{64}$/u.test(notebookHash)) {
    throw new Error('Hash do caderno inválido');
  }
  if (!['completed', 'failed', 'cancelled'].includes(status)) throw new Error('Status de execução inválido');
  if (!Array.isArray(cells)) throw new Error('Células executadas inválidas');
  return {
    schema: RUN_SCHEMA,
    version: RUN_VERSION,
    notebook: {
      schema: notebook.schema,
      version: notebook.version,
      id: notebook.id,
      title: notebook.title,
      updatedAt: notebook.updatedAt,
      sha256: notebookHash,
    },
    startedAt,
    completedAt,
    status,
    cells: clone(cells),
  };
}

export function serializeRunRecord(record) {
  if (!record || record.schema !== RUN_SCHEMA || record.version !== RUN_VERSION) {
    throw new Error('Registro de execução incompatível');
  }
  return `${JSON.stringify(stable(record), null, 2)}\n`;
}

export function storageWriteDecision(expectedValue, currentValue, nextValue) {
  if (typeof nextValue !== 'string') throw new Error('Conteúdo local inválido');
  if (currentValue !== expectedValue && currentValue !== nextValue) {
    return { conflict: true, value: currentValue };
  }
  return { conflict: false, value: nextValue };
}
