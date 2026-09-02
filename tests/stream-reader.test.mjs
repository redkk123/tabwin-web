import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_HEADER_TIMEOUT_MS,
  DEFAULT_READ_IDLE_MS,
  HeaderTimeoutError,
  StreamIdleTimeoutError,
  fetchWithHeaderTimeout,
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

test('servidor que aceita a conexão e nunca responde é cortado nos cabeçalhos', async () => {
  // Buraco apontado por auditoria externa: o relógio de ociosidade só vale
  // quando existe corpo para ler. Antes dos cabeçalhos não havia prazo nenhum,
  // e a promessa ficava pendente para sempre. Na interface o vigia de parada
  // acabava pegando, mas por acidente — o transporte é quem deve ser dono
  // disso.
  const mudo = () => new Promise(() => {});
  await assert.rejects(
    fetchWithHeaderTimeout(mudo, 'https://exemplo/a.zip', {}, { headerMs: 30 }),
    (erro) => {
      assert.ok(erro instanceof HeaderTimeoutError, 'precisa ser reconhecível como prazo de cabeçalho');
      assert.equal(erro.headerMs, 30);
      return true;
    },
  );
});

test('o relógio de cabeçalho é desarmado quando a resposta chega, e não corta o corpo', async () => {
  // Deixá-lo armado abortaria o corpo no meio — o defeito que este projeto já
  // cometeu em três camadas diferentes.
  let controlador;
  const corpo = new ReadableStream({ start(c) { controlador = c; } });
  const responde = async () => new Response(corpo, { status: 200 });
  const resposta = await fetchWithHeaderTimeout(responde, 'https://exemplo/a.zip', {}, { headerMs: 40 });
  // Bem depois do prazo de cabeçalho, o corpo continua utilizável.
  await new Promise((r) => setTimeout(r, 120));
  controlador.enqueue(Uint8Array.of(1, 2, 3));
  controlador.close();
  const lidos = [];
  const total = await readStreamWithIdleTimeout(resposta.body, {
    idleMs: 5000, onChunk: (c) => lidos.push(c.byteLength),
  });
  assert.equal(total, 3, 'o corpo sobreviveu ao prazo de cabeçalho já vencido');
  assert.deepEqual(lidos, [3]);
});

test('cancelamento humano durante a espera dos cabeçalhos não vira prazo', async () => {
  const controlador = new AbortController();
  const mudo = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  const promessa = fetchWithHeaderTimeout(
    mudo, 'https://exemplo/a.zip', {}, { headerMs: 5000, signal: controlador.signal });
  controlador.abort(new Error('cancelado pelo usuário'));
  await assert.rejects(promessa, (erro) => {
    assert.ok(!(erro instanceof HeaderTimeoutError), 'cancelar não pode virar prazo de servidor');
    return true;
  });
});

test('o prazo de cabeçalho é validado e o padrão é declarado', async () => {
  assert.equal(DEFAULT_HEADER_TIMEOUT_MS, 30_000);
  for (const invalido of [0, -1, Number.NaN]) {
    await assert.rejects(
      fetchWithHeaderTimeout(async () => new Response(''), 'https://x', {}, { headerMs: invalido }),
      /precisa ser positivo/,
    );
  }
});
