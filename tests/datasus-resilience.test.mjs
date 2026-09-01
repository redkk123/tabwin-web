import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBatchPromiseCache,
  createDatasusBatchManifest,
  retryFailedRequests,
  runDatasusBatch,
  serializeDatasusBatchManifest,
} from '../dist/packages/acquisition/src/resilient-batch.js';
import { retryWithPolicy } from '../dist/packages/acquisition/src/retry-policy.js';
import {
  InvalidDatasusArchiveError,
  validateDatasusZipArchive,
} from '../dist/packages/acquisition/src/archive-validation.js';
import { resolveMicrodatasusCompatibleCandidates } from '../dist/packages/acquisition/src/microdatasus-resolver.js';

const found = (value, attempts = 1, resolver = 'primary') => ({
  status: 'FOUND', value, attempts, resolver,
});

test('A/B/F: ordinary item failures are recorded and later files are still attempted', async () => {
  const called = [];
  const batch = await runDatasusBatch(['A', 'B', 'C'], async (request) => {
    called.push(request);
    if (request === 'B') throw new Error('timeout');
    return found(request);
  }, { failureStatus: 'DOWNLOAD_FAILED' });
  assert.deepEqual(called, ['A', 'B', 'C']);
  assert.deepEqual(batch.items.map((item) => item.status), ['FOUND', 'DOWNLOAD_FAILED', 'FOUND']);
  assert.equal(batch.succeeded, 2);
  assert.equal(batch.failed, 1);
  assert.deepEqual(retryFailedRequests(batch), ['B']);
});

test('A: a completely successful batch reports every success', async () => {
  const batch = await runDatasusBatch([1, 2, 3], async (request) => found(request), {
    failureStatus: 'LOOKUP_FAILED',
  });
  assert.equal(batch.requested, 3);
  assert.equal(batch.succeeded, 3);
  assert.equal(batch.failed, 0);
  assert.equal(batch.cancelled, false);
});

test('C: bounded retry recovers and exposes the exact attempt count', async () => {
  let calls = 0;
  const outcome = await retryWithPolicy(async () => {
    calls++;
    if (calls === 1) throw new TypeError('504');
    return 'ok';
  }, {
    maxAttempts: 3,
    shouldRetry: (error) => error instanceof TypeError,
    sleep: async () => {},
  });
  assert.deepEqual(outcome, { value: 'ok', attempts: 2 });
});

test('D: confirmed absence is NOT_PUBLISHED and is not selected for retry', async () => {
  let calls = 0;
  const batch = await runDatasusBatch(['1981'], async () => {
    calls++;
    return { status: 'NOT_PUBLISHED', attempts: 1, resolver: 'primary', value: [] };
  }, { failureStatus: 'LOOKUP_FAILED' });
  assert.equal(calls, 1);
  assert.equal(batch.notPublished, 1);
  assert.deepEqual(retryFailedRequests(batch), []);
});

test('E: the microdatasus-compatible resolver emits only evidence-backed exact candidates', () => {
  const [candidate] = resolveMicrodatasusCompatibleCandidates({
    system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC',
  });
  assert.equal(candidate?.name, 'RDAC2401.DBC');
  assert.equal(candidate?.resolver, 'microdatasus-compatible');
  assert.equal(candidate?.address, 'ftp://ftp.datasus.gov.br/dissemin/publicos/SIHSUS/200801_/Dados/RDAC2401.DBC');
  assert.deepEqual(resolveMicrodatasusCompatibleCandidates({
    system: 'SINAN', fileType: 'ACBI', year: '2024', uf: 'BR',
  }), []);
});

test('G: human cancellation preserves prior success and never starts the next item', async () => {
  const controller = new AbortController();
  const called = [];
  const batch = await runDatasusBatch(['A', 'B', 'C'], async (request) => {
    called.push(request);
    if (request === 'B') {
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    }
    return found(request);
  }, { failureStatus: 'DOWNLOAD_FAILED', signal: controller.signal });
  assert.deepEqual(called, ['A', 'B']);
  assert.deepEqual(batch.items.map((item) => item.status), ['FOUND', 'CANCELLED', 'CANCELLED']);
  assert.equal(batch.succeeded, 1);
  assert.equal(batch.cancelled, true);
});

test('H: HTML returned with HTTP success is rejected before cache/extraction', () => {
  const html = new TextEncoder().encode('<!doctype html><body>erro</body>');
  assert.throws(() => validateDatasusZipArchive(html, 'text/html'), InvalidDatasusArchiveError);
  assert.doesNotThrow(() => validateDatasusZipArchive(Uint8Array.from([0x50, 0x4b, 0x05, 0x06])));
});

test('I: shared auxiliaries execute once, reuse success, and evict rejection', async () => {
  const cache = createBatchPromiseCache();
  let calls = 0;
  const values = await Promise.all(Array.from({ length: 10 }, () => cache.getOrCreate('SIHSUS/RD', async () => ++calls)));
  assert.equal(calls, 1);
  assert.deepEqual(values, Array(10).fill(1));

  let rejectedCalls = 0;
  await assert.rejects(cache.getOrCreate('bad', async () => { rejectedCalls++; throw new Error('once'); }));
  assert.equal(await cache.getOrCreate('bad', async () => { rejectedCalls++; return 2; }), 2);
  assert.equal(rejectedCalls, 2);
});

test('the operational manifest records every request and failure deterministically', async () => {
  const batch = await runDatasusBatch(['A', 'B'], async (request) => request === 'A'
    ? found(request)
    : { status: 'LOOKUP_FAILED', attempts: 3, resolver: 'microdatasus-compatible', error: 'timeout' }, {
    failureStatus: 'LOOKUP_FAILED',
  });
  const manifest = createDatasusBatchManifest(batch, (item) => ({ request: item.request }), '2026-08-31T00:00:00.000Z');
  const serialized = serializeDatasusBatchManifest(manifest);
  assert.equal(JSON.parse(serialized).items.length, 2);
  assert.match(serialized, /LOOKUP_FAILED/);
  assert.match(serialized, /microdatasus-compatible/);
});

test('o lote paralelo preserva a ordem, o cancelamento e o isolamento de falha', async () => {
  // Ordem: um manifesto cuja ordem muda a cada execução não serve para
  // comparar duas rodadas — e comparar rodadas é o motivo de o manifesto
  // existir.
  const pedidos = Array.from({ length: 20 }, (_, index) => `q${index}`);
  const atrasos = pedidos.map((_, index) => (index % 5) * 12);

  const resultado = await runDatasusBatch(pedidos, async (pedido, index) => {
    await new Promise((resolve) => setTimeout(resolve, atrasos[index]));
    if (index === 7) throw new Error('esta caiu');
    return { status: 'FOUND', value: pedido, attempts: 1 };
  }, { failureStatus: 'LOOKUP_FAILED', concurrency: 6 });

  assert.deepEqual(resultado.items.map((item) => item.request), pedidos, 'a ordem precisa ser a dos pedidos');
  // Uma falha não derruba as outras.
  assert.equal(resultado.items[7].status, 'LOOKUP_FAILED');
  assert.equal(resultado.succeeded, 19);
  assert.equal(resultado.failed, 1);
});

test('paralelo é mais rápido que fila, que é a razão de existir', async () => {
  const pedidos = Array.from({ length: 12 }, (_, index) => index);
  const medir = async (concurrency) => {
    const inicio = Date.now();
    await runDatasusBatch(pedidos, async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { status: 'FOUND', value: 1, attempts: 1 };
    }, { failureStatus: 'LOOKUP_FAILED', concurrency });
    return Date.now() - inicio;
  };
  const fila = await medir(1);
  const paralelo = await medir(6);
  assert.ok(paralelo < fila / 2, `paralelo ${paralelo}ms devia ser bem menor que fila ${fila}ms`);
});

test('cancelar no meio preserva o que terminou e marca o resto', async () => {
  const controller = new AbortController();
  const pedidos = Array.from({ length: 30 }, (_, index) => index);
  let atendidos = 0;
  const resultado = await runDatasusBatch(pedidos, async () => {
    atendidos++;
    if (atendidos === 8) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { status: 'FOUND', value: 1, attempts: 1 };
  }, { failureStatus: 'LOOKUP_FAILED', concurrency: 4, signal: controller.signal });

  assert.equal(resultado.items.length, pedidos.length, 'todo pedido precisa aparecer no resultado');
  assert.ok(resultado.cancelled, 'o lote precisa se declarar cancelado');
  assert.ok(resultado.succeeded > 0, 'o que já tinha terminado é preservado');
  assert.ok(resultado.succeeded < pedidos.length, 'e o resto não é dado como feito');
});
