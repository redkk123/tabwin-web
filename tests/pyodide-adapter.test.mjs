/**
 * O caminho de FALHA do runtime Python do laboratório.
 *
 * Ele existe por um motivo específico: quando o worker morre executando código
 * de outra origem — o Pyodide vem do jsDelivr — o navegador dispara o evento
 * `error` com `message` vazio, por segurança. O adaptador caía então num
 * "Falha ao carregar o worker Python" que não diz nada e não sugere o que
 * fazer, e foi exatamente isso que apareceu na tela do usuário.
 *
 * O worker passa a postar o motivo como mensagem comum, que atravessa a
 * fronteira de origem intacta. Estes testes travam esse contrato.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PyodideAdapter } from '../apps/web/public/lab/src/runtimes/pyodide-adapter.js';

/** Worker de mentira: guarda os ouvintes e deixa o teste disparar eventos. */
class WorkerFalso {
  constructor() { this.ouvintes = new Map(); }

  addEventListener(tipo, fn) {
    const lista = this.ouvintes.get(tipo) ?? [];
    lista.push(fn);
    this.ouvintes.set(tipo, lista);
  }

  postMessage() {}
  terminate() {}

  disparar(tipo, evento) {
    for (const fn of this.ouvintes.get(tipo) ?? []) fn(evento);
  }
}

// O adaptador espera um instante pelo motivo antes de desistir, e usa
// `window.setTimeout` para isso.
globalThis.window ??= { setTimeout: (fn, ms) => setTimeout(fn, ms) };

const comAdaptador = async (roteiro) => {
  const worker = new WorkerFalso();
  const adaptador = new PyodideAdapter({ workerFactory: () => worker });
  const promessa = adaptador.boot().catch((erro) => erro);
  await roteiro(worker);
  return promessa;
};

const MOTIVO = 'o navegador não conseguiu reservar memória para o Python (Out of memory)';

test('o motivo que o worker mandou substitui o texto genérico', async () => {
  const erro = await comAdaptador(async (worker) => {
    worker.disparar('message', {
      data: { id: null, fatal: true, error: { name: 'Error', message: MOTIVO, stack: '' } },
    });
    worker.disparar('error', { message: '', error: null });
  });
  assert.match(String(erro?.message), /reservar memória/);
});

test('sem motivo do worker, o texto genérico continua valendo', async () => {
  // A rede de segurança não pode piorar o caso em que ela não tem o que dizer.
  const erro = await comAdaptador(async (worker) => {
    worker.disparar('error', { message: '', error: null });
  });
  assert.match(String(erro?.message), /Falha ao carregar o worker Python/);
});

test('quando o navegador informa a mensagem, ela é usada', async () => {
  const erro = await comAdaptador(async (worker) => {
    worker.disparar('error', { message: 'script não encontrado', error: null });
  });
  assert.match(String(erro?.message), /script não encontrado/);
});

test('a mensagem fatal não é confundida com resposta malformada', async () => {
  // Ela não tem `id`, e a checagem de id vinha antes. Sem a ordem certa, o
  // próprio aviso derrubava o runtime com "Resposta malformada".
  const erro = await comAdaptador(async (worker) => {
    worker.disparar('message', {
      data: { id: null, fatal: true, error: { name: 'Error', message: MOTIVO, stack: '' } },
    });
    worker.disparar('error', { message: '', error: null });
  });
  assert.doesNotMatch(String(erro?.message), /malformada/);
});

test('mensagem fatal sem erro legível não inventa motivo', async () => {
  const erro = await comAdaptador(async (worker) => {
    worker.disparar('message', { data: { id: null, fatal: true, error: null } });
    worker.disparar('error', { message: '', error: null });
  });
  assert.match(String(erro?.message), /Falha ao carregar o worker Python/);
});
