export class CanonicalRunBusyError extends Error {
  constructor(message = 'Já existe uma execução canônica ativa') {
    super(message);
    this.name = 'CanonicalRunBusyError';
  }
}

export class CanonicalRunCancelledError extends Error {
  constructor(message = 'Execução canônica cancelada') {
    super(message);
    this.name = 'CanonicalRunCancelledError';
  }
}

function humanError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCancellation(error) {
  return error instanceof CanonicalRunCancelledError
    || error?.name === 'RuntimeCancelledError'
    || error?.name === 'RuntimeCancelled';
}

export class CanonicalRunner {
  #runtimeAdapter;
  #prepareCell;
  #active = null;

  constructor({ runtimeAdapter, prepareCell }) {
    if (typeof runtimeAdapter !== 'function' || typeof prepareCell !== 'function') {
      throw new Error('Dependências do executor canônico inválidas');
    }
    this.#runtimeAdapter = runtimeAdapter;
    this.#prepareCell = prepareCell;
  }

  get active() {
    return this.#active !== null;
  }

  get activeCellId() {
    return this.#active?.cellId ?? null;
  }

  async resetRuntimes(kinds, onRuntimeState = () => {}) {
    for (const kind of new Set(kinds)) {
      const adapter = this.#runtimeAdapter(kind);
      if (!adapter) throw new Error(`Runtime não registrado: ${kind}`);
      onRuntimeState(kind, 'resetting');
      await adapter.reset();
      onRuntimeState(kind, 'idle');
    }
  }

  cancel() {
    const token = this.#active;
    if (!token || token.cancelled) return false;
    token.cancelled = true;
    const adapter = token.runtime ? this.#runtimeAdapter(token.runtime) : null;
    token.runtimeInterrupted = typeof adapter?.cancel === 'function' && adapter.cancel();
    if (!token.runtimeInterrupted && adapter?.booting && typeof adapter.reset === 'function') {
      adapter.reset(new CanonicalRunCancelledError('Carga do runtime cancelada'));
      token.runtimeInterrupted = true;
    }
    return true;
  }

  async run(cells, hooks = {}) {
    if (this.#active) throw new CanonicalRunBusyError();
    if (!Array.isArray(cells) || cells.length === 0) throw new Error('Nenhuma célula para executar');
    const onCellState = hooks.onCellState ?? (() => {});
    const onRuntimeState = hooks.onRuntimeState ?? (() => {});
    const token = { cancelled: false, runtimeInterrupted: false, cellId: null, runtime: null };
    this.#active = token;
    const completed = [];

    try {
      await this.resetRuntimes(cells.map((cell) => cell.runtime), onRuntimeState);
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index];
        token.cellId = cell.id;
        token.runtime = cell.runtime;
        if (token.cancelled) throw new CanonicalRunCancelledError();

        onCellState(cell, { phase: 'preparing', index });
        const prepared = await this.#prepareCell(cell);
        if (token.cancelled) throw new CanonicalRunCancelledError();

        const adapter = this.#runtimeAdapter(cell.runtime);
        if (!adapter) throw new Error(`Runtime não registrado: ${cell.runtime}`);
        if (!adapter.ready) {
          onRuntimeState(cell.runtime, 'loading');
          const info = await adapter.boot();
          onRuntimeState(cell.runtime, 'ready', info);
        }
        if (token.cancelled) throw new CanonicalRunCancelledError();

        onCellState(cell, { phase: 'running', index, prepared });
        try {
          const output = await adapter.run(cell.code, prepared);
          completed.push({ cell, prepared, output });
          onCellState(cell, { phase: 'done', index, prepared, output });
        } catch (error) {
          if (token.cancelled || isCancellation(error)) throw new CanonicalRunCancelledError();
          await adapter.reset();
          onRuntimeState(cell.runtime, 'idle');
          const failure = { cell, prepared, error };
          completed.push(failure);
          onCellState(cell, { phase: 'error', index, prepared, error });
          return { status: 'failed', completed, failedCellId: cell.id, error };
        }
      }
      return { status: 'completed', completed };
    } catch (error) {
      if (token.cancelled || isCancellation(error)) {
        const activeAdapter = token.runtime ? this.#runtimeAdapter(token.runtime) : null;
        if (!token.runtimeInterrupted && activeAdapter) await activeAdapter.reset();
        if (token.runtime) onRuntimeState(token.runtime, 'idle');
        if (token.cellId) onCellState(
          cells.find((cell) => cell.id === token.cellId),
          { phase: 'cancelled', error: new CanonicalRunCancelledError() },
        );
        return { status: 'cancelled', completed };
      }

      if (token.runtime) {
        const adapter = this.#runtimeAdapter(token.runtime);
        if (adapter) await adapter.reset();
        onRuntimeState(token.runtime, 'idle');
      }
      if (token.cellId) {
        const cell = cells.find((candidate) => candidate.id === token.cellId);
        onCellState(cell, { phase: 'error', error });
      }
      return { status: 'failed', completed, failedCellId: token.cellId, error: new Error(humanError(error)) };
    } finally {
      this.#active = null;
    }
  }
}
