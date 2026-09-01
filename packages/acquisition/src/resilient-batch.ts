import { isAbortErrorLike, retryAttempts } from './retry-policy.js';

export type DatasusBatchStatus =
  | 'FOUND'
  | 'NOT_PUBLISHED'
  | 'LOOKUP_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'INVALID_FILE'
  | 'CANCELLED';

export type DatasusResolverName = 'primary' | 'microdatasus-compatible';

export interface DatasusOperationOutcome<T> {
  status: DatasusBatchStatus;
  value?: T;
  resolver?: DatasusResolverName;
  attempts: number;
  error?: string;
}

export interface DatasusBatchItem<TRequest, TValue> extends DatasusOperationOutcome<TValue> {
  request: TRequest;
}

export interface DatasusBatchResult<TRequest, TValue> {
  requested: number;
  succeeded: number;
  notPublished: number;
  failed: number;
  cancelled: boolean;
  items: Array<DatasusBatchItem<TRequest, TValue>>;
}

export interface DatasusBatchProgress<TRequest, TValue> {
  completed: number;
  total: number;
  item: DatasusBatchItem<TRequest, TValue>;
}

interface RunDatasusBatchOptions<TRequest, TValue> {
  signal?: AbortSignal;
  failureStatus: 'LOOKUP_FAILED' | 'DOWNLOAD_FAILED';
  onProgress?: (progress: DatasusBatchProgress<TRequest, TValue>) => void;
  /**
   * Quantas operações rodam ao mesmo tempo. O padrão é 1 — uma de cada vez.
   *
   * Baixar arquivo continua em 1 de propósito: são dezenas de MB cada, e o
   * servidor do DATASUS já oscila com uma conexão. Consultar o catálogo é
   * outra história — são POSTs pequenos, e em sequência ficam insuportáveis:
   * medido, "todos os anos × todas as UFs" do SINASC/DN dá 868 consultas, o
   * que em fila levaria cerca de cinco minutos.
   */
  concurrency?: number;
}

const RETRYABLE_FAILURES = new Set<DatasusBatchStatus>([
  'LOOKUP_FAILED', 'DOWNLOAD_FAILED', 'INVALID_FILE',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarize<TRequest, TValue>(items: Array<DatasusBatchItem<TRequest, TValue>>, requested: number): DatasusBatchResult<TRequest, TValue> {
  return {
    requested,
    succeeded: items.filter((item) => item.status === 'FOUND').length,
    notPublished: items.filter((item) => item.status === 'NOT_PUBLISHED').length,
    failed: items.filter((item) => RETRYABLE_FAILURES.has(item.status)).length,
    cancelled: items.some((item) => item.status === 'CANCELLED'),
    items,
  };
}

function cancelledItem<TRequest, TValue>(request: TRequest): DatasusBatchItem<TRequest, TValue> {
  return { request, status: 'CANCELLED', attempts: 0, error: 'Operação cancelada.' };
}

/** Sequential by design: bounded memory and predictable pressure on DATASUS. */
export async function runDatasusBatch<TRequest, TValue>(
  requests: readonly TRequest[],
  worker: (request: TRequest, index: number) => Promise<DatasusOperationOutcome<TValue>>,
  options: RunDatasusBatchOptions<TRequest, TValue>,
): Promise<DatasusBatchResult<TRequest, TValue>> {
  // Os resultados são guardados POR ÍNDICE e ordenados no fim: com mais de uma
  // operação em voo, a ordem de chegada é a do acaso, e um manifesto cuja
  // ordem muda a cada execução não serve para comparar duas rodadas.
  const slots = new Array<DatasusBatchItem<TRequest, TValue> | undefined>(requests.length);
  const workers = Math.max(1, Math.min(options.concurrency ?? 1, 8));
  let next = 0;
  let stopped = false;
  let completed = 0;

  const markRemainingCancelled = (): void => {
    for (let index = 0; index < requests.length; index++) {
      const pending = requests[index];
      if (slots[index] === undefined && pending !== undefined) {
        slots[index] = cancelledItem<TRequest, TValue>(pending);
      }
    }
  };

  const runOne = async (): Promise<void> => {
    while (!stopped) {
      const index = next++;
      if (index >= requests.length) return;
      const request = requests[index];
      if (request === undefined) continue;
      if (options.signal?.aborted) { stopped = true; break; }

      let item: DatasusBatchItem<TRequest, TValue>;
      try {
        const outcome = await worker(request, index);
        item = { request, ...outcome };
      } catch (error) {
        if (isAbortErrorLike(error) || options.signal?.aborted) {
          item = cancelledItem<TRequest, TValue>(request);
        } else {
          item = {
            request,
            status: options.failureStatus,
            attempts: retryAttempts(error),
            error: errorMessage(error),
          };
        }
      }
      slots[index] = item;
      completed++;
      options.onProgress?.({ completed, total: requests.length, item });
      // Cancelamento interrompe o lote inteiro, como antes: o que já terminou
      // é preservado, o resto é marcado como cancelado.
      if (item.status === 'CANCELLED') { stopped = true; break; }
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runOne()));
  if (stopped) markRemainingCancelled();

  const items = slots.filter((item): item is DatasusBatchItem<TRequest, TValue> => item !== undefined);
  return summarize(items, requests.length);
}

export function retryFailedRequests<TRequest, TValue>(batch: DatasusBatchResult<TRequest, TValue>): TRequest[] {
  return batch.items.filter((item) => RETRYABLE_FAILURES.has(item.status)).map((item) => item.request);
}

export interface BatchPromiseCache<TKey, TValue> {
  getOrCreate(key: TKey, factory: () => Promise<TValue>): Promise<TValue>;
  readonly size: number;
}

/** Rejected promises are evicted, so one transient failure cannot poison a batch. */
export function createBatchPromiseCache<TKey, TValue>(): BatchPromiseCache<TKey, TValue> {
  const entries = new Map<TKey, Promise<TValue>>();
  return {
    get size() { return entries.size; },
    getOrCreate(key, factory) {
      const existing = entries.get(key);
      if (existing) return existing;
      const created = Promise.resolve().then(factory);
      entries.set(key, created);
      void created.catch(() => {
        if (entries.get(key) === created) entries.delete(key);
      });
      return created;
    },
  };
}

export interface DatasusBatchManifestV1 {
  schema: 'tabwin-web.datasus-batch';
  version: 1;
  createdAt: string;
  requested: number;
  succeeded: number;
  notPublished: number;
  failed: number;
  cancelled: boolean;
  items: Array<Record<string, unknown>>;
}

export function createDatasusBatchManifest<TRequest, TValue>(
  batch: DatasusBatchResult<TRequest, TValue>,
  describe: (item: DatasusBatchItem<TRequest, TValue>) => Record<string, unknown>,
  createdAt = new Date().toISOString(),
): DatasusBatchManifestV1 {
  return {
    schema: 'tabwin-web.datasus-batch', version: 1, createdAt,
    requested: batch.requested, succeeded: batch.succeeded,
    notPublished: batch.notPublished, failed: batch.failed,
    cancelled: batch.cancelled,
    items: batch.items.map((item) => ({
      ...describe(item), status: item.status,
      ...(item.resolver ? { resolver: item.resolver } : {}),
      attempts: item.attempts,
      ...(item.error ? { error: item.error } : {}),
    })),
  };
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]));
  }
  return value;
}

export function serializeDatasusBatchManifest(manifest: DatasusBatchManifestV1): string {
  return `${JSON.stringify(stableJsonValue(manifest), null, 2)}\n`;
}
