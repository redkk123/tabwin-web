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
  const items: Array<DatasusBatchItem<TRequest, TValue>> = [];
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    if (request === undefined) continue;
    if (options.signal?.aborted) {
      for (let rest = index; rest < requests.length; rest++) {
        const pending = requests[rest];
        if (pending !== undefined) items.push(cancelledItem<TRequest, TValue>(pending));
      }
      break;
    }
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
    items.push(item);
    options.onProgress?.({ completed: items.length, total: requests.length, item });
    if (item.status === 'CANCELLED') {
      for (let rest = index + 1; rest < requests.length; rest++) {
        const pending = requests[rest];
        if (pending !== undefined) items.push(cancelledItem<TRequest, TValue>(pending));
      }
      break;
    }
  }
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
