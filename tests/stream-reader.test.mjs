import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_READ_IDLE_MS,
  StreamIdleTimeoutError,
  readStreamWithIdleTimeout,
} from '../dist/packages/acquisition/src/stream-reader.js';

/** Relógio de mentira: dispara quando eu mandar, não quando o tempo passar. */
function relogio() {
  let proximo = 1;
  const pendentes = new Map();
  return {
    setTimer(fn, ms) { const id = proximo++; pendentes.set(id, { fn, ms }); return id; },
    clearTimer(id) { pendentes.delete(id); },
    disparar() { for (const [id, { fn }] of [...pendentes]) { pendentes.delete(id); fn(); } },
    get armados() { return pendentes.size; },
  };
}

/** Origem sob controle do teste: entrega quando eu mandar, ou nunca. */
function origem() {
  let controlador = null;
  const stream = new ReadableStream({ start(c) { controlador = c; } });
  return {
    stream,
    enviar(bytes) { controlador.enqueue(Uint8Array.from(bytes)); },
    encerrar() { controlador.close(); },
  };
}

const passar = () => new Promise((resolve) => setImmediate(resolve));

test('progresso contínuo nunca vence o prazo, por mais tempo que leve no total', async () => {
  // O defeito real: quatro faixas de 30 MB a 0,2 MB/s levam ~152 s cada. Com
  // relógio de duração, morriam aos 90 s recebendo bytes o tempo todo.
  const t = relogio();
  const o = origem();
  const recebidos = [];
  const leitura = readStreamWithIdleTimeout(o.stream, {
    idleMs: 90_000,
    onChunk: (c) => recebidos.push(c.byteLength),
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });

  for (let i = 0; i < 40; i++) {
    await passar();
    assert.equal(t.armados, 1, 'com leitura pendente há exatamente um relógio armado');
    o.enviar([1, 2, 3]);
    await passar();
  }
  o.encerrar();
  assert.equal(await leitura, 120, 'todos os bytes chegam');
  assert.equal(recebidos.length, 40);
  assert.equal(t.armados, 0, 'ao terminar nada fica armado');
});

test('silêncio da origem vira erro de ociosidade, não sucesso truncado', async () => {
  // `cancel()` faz a leitura pendente resolver com `done`. Sem a checagem
  // explícita, um fluxo travado terminaria como sucesso com metade dos bytes.
  const t = relogio();
  const o = origem();
  const leitura = readStreamWithIdleTimeout(o.stream, {
    idleMs: 90_000, onChunk: () => {}, setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  await passar();
  o.enviar([1, 2]);
  await passar();
  t.disparar();
  await assert.rejects(leitura, (erro) => {
    assert.ok(erro instanceof StreamIdleTimeoutError, 'precisa ser reconhecível como ociosidade');
    assert.equal(erro.idleMs, 90_000);
    assert.match(erro.message, /90 segundos/);
    return true;
  });
});

test('cancelamento humano é distinto de ociosidade', async () => {
  // A interface precisa dizer "você cancelou" e não "o servidor travou".
  const t = relogio();
  const o = origem();
  const controlador = new AbortController();
  const leitura = readStreamWithIdleTimeout(o.stream, {
    idleMs: 90_000, onChunk: () => {}, signal: controlador.signal,
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  await passar();
  controlador.abort(new Error('cancelado pelo usuário'));
  await assert.rejects(leitura, (erro) => {
    assert.ok(!(erro instanceof StreamIdleTimeoutError), 'cancelar não pode virar ociosidade');
    return true;
  });
  assert.equal(t.armados, 0, 'cancelar também desarma');
});

test('erro no consumidor interrompe a leitura em vez de seguir consumindo', async () => {
  const t = relogio();
  const o = origem();
  const leitura = readStreamWithIdleTimeout(o.stream, {
    idleMs: 90_000,
    onChunk: () => { throw new Error('destino recusou o pedaço'); },
    setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  await passar();
  o.enviar([9]);
  await assert.rejects(leitura, /destino recusou/);
  assert.equal(t.armados, 0);
});

test('o prazo é validado e o padrão é declarado', async () => {
  assert.equal(DEFAULT_READ_IDLE_MS, 90_000);
  for (const invalido of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      readStreamWithIdleTimeout(origem().stream, { idleMs: invalido, onChunk: () => {} }),
      /precisa ser positivo/,
    );
  }
});
