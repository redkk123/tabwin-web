export interface RetryPolicy {
  maxAttempts?: number;
  delaysMs?: readonly number[];
  signal?: AbortSignal;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export interface RetrySuccess<T> {
  value: T;
  attempts: number;
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  override readonly cause: unknown;

  constructor(cause: unknown, attempts: number) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'RetryExhaustedError';
    this.cause = cause;
    this.attempts = attempts;
  }
}

export function isAbortErrorLike(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

export function retryAttempts(error: unknown): number {
  return error instanceof RetryExhaustedError ? error.attempts : 1;
}

export function retryCause(error: unknown): unknown {
  return error instanceof RetryExhaustedError ? error.cause : error;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Operation aborted', 'AbortError');
}

async function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return;
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : new DOMException('Operation aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Bounded, abort-aware retry. Every terminal ordinary failure carries the
 * number of attempts; cancellation is propagated unchanged and never retried.
 */
export async function retryWithPolicy<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
): Promise<RetrySuccess<T>> {
  const maximum = policy.maxAttempts ?? 3;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 10) {
    throw new Error('Retry maxAttempts must be an integer between 1 and 10');
  }
  const delays = policy.delaysMs ?? [500, 1_500];
  const sleep = policy.sleep ?? abortableSleep;
  for (let attempt = 1; attempt <= maximum; attempt++) {
    if (policy.signal?.aborted) throw abortReason(policy.signal);
    try {
      return { value: await operation(attempt), attempts: attempt };
    } catch (error) {
      if (isAbortErrorLike(error) || policy.signal?.aborted) throw error;
      if (attempt >= maximum || !policy.shouldRetry(error, attempt)) {
        throw new RetryExhaustedError(error, attempt);
      }
      await sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0, policy.signal);
    }
  }
  throw new Error('Unreachable retry state');
}
