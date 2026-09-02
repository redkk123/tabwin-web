const adapters = new Map();

export function registerRuntimeAdapter(adapter) {
  if (
    !adapter
    || !['python', 'r'].includes(adapter.kind)
    || typeof adapter.boot !== 'function'
    || typeof adapter.run !== 'function'
    || typeof adapter.cancel !== 'function'
    || typeof adapter.reset !== 'function'
    || typeof adapter.ready !== 'boolean'
  ) {
    throw new Error('Adaptador de runtime inválido');
  }
  if (adapters.has(adapter.kind)) throw new Error(`Runtime já registrado: ${adapter.kind}`);
  adapters.set(adapter.kind, adapter);
}

export function runtimeAdapter(kind) {
  return adapters.get(kind) ?? null;
}

export function registeredRuntimes() {
  return [...adapters.keys()].sort();
}
