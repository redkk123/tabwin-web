import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBridge } from '../apps/tabwin-bridge/server.mjs';

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
}

async function call(port, route, { token, method = 'GET', body, origin } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
}

test('/health responde sem token, porque é como o app descobre que existe', async () => {
  const bridge = createBridge({ directory: scratchDir() });
  const { port } = await bridge.listen(0);
  try {
    const health = await call(port, '/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.service, 'tabwin-bridge');
    assert.equal(typeof health.json.protocol, 'number');
    // A allowlist é pública: o usuário tem direito de saber o que isso alcança.
    assert.ok(Array.isArray(health.json.allowlist) && health.json.allowlist.length > 0);
    // E ele não vaza o token.
    assert.ok(!JSON.stringify(health.json).includes(bridge.token));
  } finally { await bridge.close(); }
});

test('sem token válido, nada além do /health responde', async () => {
  const bridge = createBridge({ directory: scratchDir() });
  const { port } = await bridge.listen(0);
  try {
    const semToken = await call(port, '/downloads', { method: 'POST', body: { url: 'https://x' } });
    assert.equal(semToken.status, 401);

    const tokenErrado = await call(port, '/downloads', {
      method: 'POST', token: 'nao-e-o-token', body: { url: 'https://x' },
    });
    assert.equal(tokenErrado.status, 401);

    // Um token do tamanho certo, mas errado, também não passa.
    const mesmoTamanho = await call(port, '/downloads', {
      method: 'POST', token: 'a'.repeat(bridge.token.length), body: { url: 'https://x' },
    });
    assert.equal(mesmoTamanho.status, 401);
  } finally { await bridge.close(); }
});

test('origem web desconhecida é recusada antes de qualquer coisa', async () => {
  const bridge = createBridge({ directory: scratchDir() });
  const { port } = await bridge.listen(0);
  try {
    const hostil = await call(port, '/health', { origin: 'https://evil.com' });
    assert.equal(hostil.status, 403);

    const oficial = await call(port, '/health', { origin: 'https://redkk123.github.io' });
    assert.equal(oficial.status, 200);
    assert.equal(oficial.headers.get('access-control-allow-origin'), 'https://redkk123.github.io');
    // Curinga aqui seria o mesmo que não ter CORS.
    assert.notEqual(oficial.headers.get('access-control-allow-origin'), '*');
  } finally { await bridge.close(); }
});

test('a allowlist é aplicada no auxiliar, não só no navegador', async () => {
  // O frontend validar não basta: quem chama a API pode não ser o frontend.
  const bridge = createBridge({ directory: scratchDir() });
  const { port } = await bridge.listen(0);
  try {
    for (const [url, code] of [
      ['https://evil.com/a.zip', 'host-not-allowed'],
      ['http://datasus.saude.gov.br/wp-content/zipupload/a/arquivo.zip', 'protocol-not-allowed'],
      ['file:///C:/Windows/win.ini', 'protocol-not-allowed'],
      ['https://datasus.saude.gov.br/wp-admin/', 'path-not-allowed'],
      ['nao-e-url', 'malformed-url'],
    ]) {
      const recusa = await call(port, '/downloads', {
        method: 'POST', token: bridge.token, body: { url },
      });
      assert.equal(recusa.status, 400, url);
      assert.equal(recusa.json.code, code, url);
      // A recusa explica o motivo em vez de só dizer "não".
      assert.ok(recusa.json.error.length > 8, url);
    }
  } finally { await bridge.close(); }
});


async function poll(port, token, id, wanted, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = (await call(port, `/downloads/${id}`, { token })).json;
    if (last.status === wanted) return last;
    if (['done', 'failed', 'cancelled'].includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return last;
}

const FAKE_CURL = ['node', path.resolve('tests/fixtures/fake-curl.mjs')];

/**
 * Roda o Bridge com um curl falso.
 *
 * A allowlist continua a de produção: o que muda é a ferramenta que ela manda
 * executar. Abrir exceção na política para testar seria destruir a garantia
 * que os outros testes provam.
 */
function bridgeWithFakeCurl(directory, mode = 'ok', bytes) {
  process.env.FAKE_CURL_MODE = mode;
  if (bytes !== undefined) process.env.FAKE_CURL_BYTES = bytes;
  else delete process.env.FAKE_CURL_BYTES;
  // spawn de "node fake-curl.mjs": o primeiro argumento vira o executável e o
  // script entra como argumento, então embrulhamos num .cmd-equivalente.
  return createBridge({ directory, curlPath: FAKE_CURL[0], curlArgsPrefix: [FAKE_CURL[1]] });
}

test('download que termina bem só então vira arquivo final, com nome derivado', async () => {
  const dir = scratchDir();
  const bridge = bridgeWithFakeCurl(dir, 'ok', 'microdados-de-teste');
  const { port } = await bridge.listen(0);
  try {
    const criado = await call(port, '/downloads', {
      method: 'POST', token: bridge.token,
      body: { url: 'https://ftp.datasus.gov.br/dissemin/publicos/DENGBR24.dbc' },
    });
    assert.equal(criado.status, 202);
    assert.equal(criado.json.filename, 'DENGBR24.dbc');
    assert.equal(criado.json.path, null, 'nada de caminho final antes de concluir');

    const done = await poll(port, bridge.token, criado.json.id, 'done');
    assert.equal(done.status, 'done');
    assert.equal(done.receivedBytes, 'microdados-de-teste'.length);
    assert.ok(done.path.endsWith('DENGBR24.dbc'));

    // O ponto do rename atômico: existe o final, não existe o .part.
    assert.equal(fs.readFileSync(path.join(dir, 'DENGBR24.dbc'), 'utf8'), 'microdados-de-teste');
    assert.equal(fs.existsSync(path.join(dir, 'DENGBR24.dbc.part')), false);
  } finally { await bridge.close(); }
});

test('download que falha não deixa arquivo final, e diz o que houve', async () => {
  const dir = scratchDir();
  const bridge = bridgeWithFakeCurl(dir, 'fail');
  const { port } = await bridge.listen(0);
  try {
    const criado = await call(port, '/downloads', {
      method: 'POST', token: bridge.token,
      body: { url: 'https://ftp.datasus.gov.br/dissemin/publicos/QUEBRA.dbc' },
    });
    const failed = await poll(port, bridge.token, criado.json.id, 'failed');
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /500|curl/);
    assert.equal(failed.path, null);
    // Um download que falhou nunca pode se passar por completo.
    assert.equal(fs.existsSync(path.join(dir, 'QUEBRA.dbc')), false);
  } finally { await bridge.close(); }
});

test('cancelar mata o processo, não cria arquivo final e preserva o .part', async () => {
  const dir = scratchDir();
  const bridge = bridgeWithFakeCurl(dir, 'hang');
  const { port } = await bridge.listen(0);
  try {
    const criado = await call(port, '/downloads', {
      method: 'POST', token: bridge.token,
      body: { url: 'https://ftp.datasus.gov.br/dissemin/publicos/LONGO.dbc' },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const cancelado = await call(port, `/downloads/${criado.json.id}/cancel`, {
      method: 'POST', token: bridge.token,
    });
    assert.equal(cancelado.status, 200);
    assert.equal(cancelado.json.status, 'cancelled');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fs.existsSync(path.join(dir, 'LONGO.dbc')), false);
    // O .part fica: é o que permite retomar com --continue-at.
    assert.equal(fs.existsSync(path.join(dir, 'LONGO.dbc.part')), true);
  } finally { await bridge.close(); }
});

test('um arquivo já completo não é baixado de novo', async () => {
  const dir = scratchDir();
  fs.writeFileSync(path.join(dir, 'pronto.dbc'), 'ja-estava-aqui');
  const bridge = createBridge({ directory: dir });
  const { port } = await bridge.listen(0);
  try {
    const criado = await call(port, '/downloads', {
      method: 'POST', token: bridge.token,
      body: { url: 'https://ftp.datasus.gov.br/dissemin/publicos/pronto.dbc' },
    });
    assert.equal(criado.json.status, 'done');
    assert.equal(criado.json.receivedBytes, 'ja-estava-aqui'.length);
    assert.ok(criado.json.path?.endsWith('pronto.dbc'));
  } finally { await bridge.close(); }
});

test('download desconhecido responde 404 em vez de vazar estado', async () => {
  const bridge = createBridge({ directory: scratchDir() });
  const { port } = await bridge.listen(0);
  try {
    const ausente = await call(port, '/downloads/00000000-0000-0000-0000-000000000000', { token: bridge.token });
    assert.equal(ausente.status, 404);
    const rota = await call(port, '/qualquer-outra', { token: bridge.token });
    assert.equal(rota.status, 404);
  } finally { await bridge.close(); }
});

test('escuta apenas em 127.0.0.1, nunca em todas as interfaces', async () => {
  const bridge = createBridge({ directory: scratchDir() });
  const address = await bridge.listen(0);
  try {
    assert.equal(address.address, '127.0.0.1');
    assert.notEqual(address.address, '0.0.0.0');
  } finally { await bridge.close(); }
});

test('dois pedidos ao mesmo tempo recebem ids distintos', async () => {
  const bridge = createBridge({ directory: scratchDir() });
  const { port } = await bridge.listen(0);
  try {
    const [a, b] = await Promise.all([
      call(port, '/downloads', { method: 'POST', token: bridge.token, body: { url: 'https://ftp.datasus.gov.br/dissemin/publicos/a.dbc' } }),
      call(port, '/downloads', { method: 'POST', token: bridge.token, body: { url: 'https://ftp.datasus.gov.br/dissemin/publicos/b.dbc' } }),
    ]);
    assert.notEqual(a.json.id, b.json.id);
    assert.equal(bridge.jobs.size, 2);
  } finally { await bridge.close(); }
});
