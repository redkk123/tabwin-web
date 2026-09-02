import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForPreparedArchive } from '../dist/packages/acquisition/src/prepared-archive.js';

/** Relógio e sono falsos: o teste mede a lógica, não o tempo de parede. */
function cronometro() {
  let agora = 0;
  return {
    now: () => agora,
    sleep: async (ms) => { agora += ms; },
    avancar: (ms) => { agora += ms; },
  };
}

const resposta = (status) => ({ status, body: null });

test('devolve na primeira sondagem quando o pacote já está pronto', async () => {
  const relogio = cronometro();
  let chamadas = 0;
  const resultado = await waitForPreparedArchive({
    url: 'https://exemplo/arquivo.zip',
    fetchImpl: async () => { chamadas++; return resposta(206); },
    ...relogio,
  });
  assert.equal(resultado.outcome, 'ready');
  assert.equal(resultado.probes, 1);
  assert.equal(chamadas, 1, 'pacote pronto não deve custar uma segunda viagem');
});

test('espera enquanto o DATASUS ainda está escrevendo, e segue quando fica pronto', async () => {
  const relogio = cronometro();
  const status = [404, 404, 404, 206];
  let indice = 0;
  const esperas = [];

  const resultado = await waitForPreparedArchive({
    url: 'https://exemplo/arquivo.zip',
    fetchImpl: async () => resposta(status[indice++] ?? 206),
    onWait: (decorrido) => esperas.push(decorrido),
    intervalMs: 2_000,
    timeoutMs: 45_000,
    ...relogio,
  });

  assert.equal(resultado.outcome, 'ready');
  assert.equal(resultado.probes, 4);
  assert.deepEqual(esperas, [0, 2_000, 4_000],
    'cada espera precisa informar o decorrido, senão a tela fica muda');
  assert.equal(resultado.waitedMs, 6_000);
});

test('desiste no prazo em vez de esperar para sempre', async () => {
  const relogio = cronometro();
  let chamadas = 0;
  const resultado = await waitForPreparedArchive({
    url: 'https://exemplo/arquivo.zip',
    fetchImpl: async () => { chamadas++; return resposta(404); },
    intervalMs: 2_000,
    timeoutMs: 10_000,
    ...relogio,
  });

  assert.equal(resultado.outcome, 'timed-out');
  // Sonda em 0, 2, 4, 6, 8; em 8s a próxima espera passaria de 10s.
  assert.equal(chamadas, 5);
  assert.ok(resultado.waitedMs <= 10_000, 'não pode estourar o prazo pedido');
});

test('um erro de rede na sondagem não impede o download', async () => {
  // Esta é a regra que protege o caminho principal: a sondagem é otimização,
  // e otimização não pode ser a causa de um arquivo não ser baixado.
  const relogio = cronometro();
  const resultado = await waitForPreparedArchive({
    url: 'https://exemplo/arquivo.zip',
    fetchImpl: async () => { throw new TypeError('failed to fetch'); },
    ...relogio,
  });
  assert.equal(resultado.outcome, 'probe-failed');
});

test('cancelamento do usuário propaga em vez de virar espera silenciosa', async () => {
  const controle = new AbortController();
  controle.abort();
  const relogio = cronometro();
  await assert.rejects(
    waitForPreparedArchive({
      url: 'https://exemplo/arquivo.zip',
      fetchImpl: async () => { throw new DOMException('Aborted', 'AbortError'); },
      signal: controle.signal,
      ...relogio,
    }),
    /Aborted/,
  );
});

test('qualquer status que não seja 404 encerra a espera', async () => {
  // 403, 500 e afins são problema real: quem relata bem é o download, não a
  // sondagem. Insistir aqui só atrasaria a mensagem de erro.
  for (const status of [200, 206, 403, 500, 503]) {
    const relogio = cronometro();
    const resultado = await waitForPreparedArchive({
      url: 'https://exemplo/arquivo.zip',
      fetchImpl: async () => resposta(status),
      ...relogio,
    });
    assert.equal(resultado.outcome, 'ready', `status ${status} não devia manter a espera`);
    assert.equal(resultado.probes, 1);
  }
});
