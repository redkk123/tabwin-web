import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_SUPPORTED_PROTOCOL,
  bridgeBaseUrl,
  bridgeWouldHelp,
  cancelBridgeDownload,
  describeBridgeProbe,
  probeBridge,
  readBridgeJob,
  startBridgeDownload,
} from '../dist/packages/acquisition/src/bridge-client.js';

/** fetch falso: os testes não podem depender do auxiliar estar rodando. */
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  impl.calls = calls;
  return impl;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

const HEALTH = {
  service: 'tabwin-bridge',
  protocol: BRIDGE_SUPPORTED_PROTOCOL,
  allowlist: ['https://ftp.datasus.gov.br/dissemin/publicos/… — árvore pública'],
  directory: 'C:/Users/x/Downloads/TabWin',
};

test('o auxiliar ausente é um resultado, não um erro', async () => {
  // É o caso comum: quase ninguém tem isso rodando. Tratar como exceção
  // encheria o console de ruído a cada verificação.
  const probe = await probeBridge(bridgeBaseUrl(), fakeFetch(async () => {
    throw new TypeError('Failed to fetch');
  }));
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'offline');
  assert.match(describeBridgeProbe(probe), /não está rodando/);
});

test('auxiliar no ar é detectado, com a allowlist que ele mesmo declara', async () => {
  const probe = await probeBridge(bridgeBaseUrl(), fakeFetch(async () => json(HEALTH)));
  assert.equal(probe.available, true);
  assert.equal(probe.health.directory, HEALTH.directory);
  assert.match(describeBridgeProbe(probe), /Downloader local disponível/);
});

test('versão de protocolo diferente é recusa explícita, não adivinhação', async () => {
  const probe = await probeBridge(bridgeBaseUrl(), fakeFetch(async () => json({ ...HEALTH, protocol: 99 })));
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'incompatible');
  assert.match(probe.detail, /99/);
  assert.match(probe.detail, new RegExp(String(BRIDGE_SUPPORTED_PROTOCOL)));
});

test('outro serviço na mesma porta não é confundido com o auxiliar', async () => {
  const probe = await probeBridge(bridgeBaseUrl(), fakeFetch(async () => json({ service: 'outra-coisa' })));
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'unexpected');
});

test('a verificação desiste sozinha em vez de pendurar a interface', async () => {
  const probe = await probeBridge(bridgeBaseUrl(), fakeFetch(async (_url, init) => {
    await new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    return json(HEALTH);
  }), 60);
  assert.equal(probe.available, false);
  assert.equal(probe.reason, 'offline');
});

test('todo pedido leva o token, senão o auxiliar recusaria', async () => {
  const impl = fakeFetch(async () => json({ id: 'abc', status: 'downloading' }));
  await startBridgeDownload({ token: 'segredo', fetchImpl: impl }, 'https://ftp.datasus.gov.br/dissemin/publicos/a.dbc');
  assert.equal(impl.calls[0].init.headers.authorization, 'Bearer segredo');
  assert.equal(impl.calls[0].init.method, 'POST');
  assert.equal(JSON.parse(impl.calls[0].init.body).url, 'https://ftp.datasus.gov.br/dissemin/publicos/a.dbc');
});

test('token recusado vira mensagem que o usuário sabe resolver', async () => {
  const impl = fakeFetch(async () => json({ error: 'token ausente ou inválido' }, 401));
  await assert.rejects(
    () => startBridgeDownload({ token: 'errado', fetchImpl: impl }, 'https://x'),
    /token recusado/,
  );
});

test('recusa da allowlist chega com o motivo do auxiliar, não genérica', async () => {
  const impl = fakeFetch(async () => json({ error: 'o host não está na lista de origens permitidas', code: 'host-not-allowed' }, 400));
  await assert.rejects(
    () => startBridgeDownload({ token: 't', fetchImpl: impl }, 'https://evil.com/a.zip'),
    /lista de origens permitidas/,
  );
});

test('acompanhar e cancelar batem nas rotas certas', async () => {
  const impl = fakeFetch(async () => json({ id: 'abc', status: 'cancelled' }));
  const options = { token: 't', fetchImpl: impl };
  await readBridgeJob(options, 'abc');
  await cancelBridgeDownload(options, 'abc');
  assert.match(impl.calls[0].url, /\/downloads\/abc$/);
  assert.match(impl.calls[1].url, /\/downloads\/abc\/cancel$/);
  assert.equal(impl.calls[1].init.method, 'POST');
});

test('o auxiliar só é oferecido para falha que ele plausivelmente resolve', () => {
  // Oferecer diante de qualquer erro treinaria a pessoa a ignorar a oferta.
  for (const error of [
    new TypeError('Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource'),
    new Error('tempo esgotado ao falar com o proxy'),
    new Error('CORS policy blocked the request'),
    Object.assign(new Error('Bad Gateway'), { status: 502 }),
    Object.assign(new Error('Too Many Requests'), { status: 429 }),
    Object.assign(new Error('Request Timeout'), { status: 408 }),
  ]) {
    assert.equal(bridgeWouldHelp(error), true, String(error.message));
  }
});

test('não é oferecido quando outro transporte não mudaria nada', () => {
  for (const error of [
    Object.assign(new Error('Not Found'), { status: 404 }),
    Object.assign(new Error('Forbidden'), { status: 403 }),
    new Error('o arquivo não contém um DBC reconhecido'),
    new Error('ZIP excede o limite total expandido'),
    null,
    undefined,
  ]) {
    assert.equal(bridgeWouldHelp(error), false, String(error?.message ?? error));
  }
});
