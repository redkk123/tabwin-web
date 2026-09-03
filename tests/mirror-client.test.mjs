import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { fetchFromMirror, resetMirrorCache } from '../apps/web/src/mirror-client.ts';

const CONTEUDO = new Uint8Array(64).map((_, i) => i);
const HASH = createHash('sha256').update(CONTEUDO).digest('hex');
const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

const manifesto = (extra = {}) => JSON.stringify({
  schema: 'tabwin-web.mirror',
  version: 1,
  baseUrl: 'https://espelho.exemplo',
  updatedAt: new Date().toISOString(),
  entries: [{
    name: 'DNBR2024.dbc',
    path: 'sinasc/DNBR2024.dbc',
    sha256: HASH,
    bytes: CONTEUDO.length,
    fetchedAt: new Date().toISOString(),
    source: 'ftp://ftp.datasus.gov.br/x/DNBR2024.dbc',
  }],
  ...extra,
});

function corpo(bytes) {
  let entregue = false;
  return {
    getReader: () => ({
      read: async () => (entregue ? { done: true } : (entregue = true, { done: false, value: bytes })),
    }),
  };
}

/** Origem falsa: serve o manifesto e o arquivo, com o conteúdo que se pedir. */
function origem({ texto = manifesto(), arquivo = CONTEUDO, statusArquivo = 200 } = {}) {
  const pedidos = [];
  return {
    pedidos,
    fetchImpl: async (url) => {
      pedidos.push(String(url));
      if (String(url).includes('mirror.json')) {
        return { ok: true, text: async () => texto };
      }
      return { ok: statusArquivo === 200, status: statusArquivo, body: corpo(arquivo) };
    },
  };
}

test('arquivo no espelho, com hash certo, é entregue', async () => {
  resetMirrorCache();
  const { fetchImpl } = origem();
  globalThis.fetch = fetchImpl;
  const r = await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl });
  assert.ok(r);
  assert.deepEqual(r.bytes, CONTEUDO);
  assert.equal(r.url, 'https://espelho.exemplo/sinasc/DNBR2024.dbc');
});

test('hash diferente do declarado é descartado, sem alarde', async () => {
  // Esta é a regra que separa espelho de origem qualquer. Sem ela, quem
  // controlasse o bucket serviria o que quisesse.
  resetMirrorCache();
  const { fetchImpl } = origem({ arquivo: new Uint8Array(64).fill(9) });
  globalThis.fetch = fetchImpl;
  assert.equal(await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl }), null);
});

test('arquivo fora do espelho devolve nulo: vá ao DATASUS', async () => {
  resetMirrorCache();
  const { fetchImpl } = origem();
  globalThis.fetch = fetchImpl;
  assert.equal(await fetchFromMirror('DNBR1996.dbc', sha256, { fetchImpl }), null);
});

test('sem manifesto publicado, o aplicativo segue igual', async () => {
  resetMirrorCache();
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '' });
  globalThis.fetch = fetchImpl;
  assert.equal(await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl }), null);
});

test('manifesto ilegível não derruba nada', async () => {
  resetMirrorCache();
  const { fetchImpl } = origem({ texto: 'isto não é json' });
  globalThis.fetch = fetchImpl;
  assert.equal(await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl }), null);
});

test('espelho fora do ar devolve nulo, não erro', async () => {
  resetMirrorCache();
  const { fetchImpl } = origem({ statusArquivo: 503 });
  globalThis.fetch = fetchImpl;
  assert.equal(await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl }), null);
});

test('rede que lança no meio devolve nulo, não propaga', async () => {
  // Um espelho indisponível não pode impedir ninguém de baixar o dado.
  resetMirrorCache();
  const fetchImpl = async (url) => {
    if (String(url).includes('mirror.json')) return { ok: true, text: async () => manifesto() };
    throw new TypeError('failed to fetch');
  };
  globalThis.fetch = fetchImpl;
  assert.equal(await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl }), null);
});

test('o manifesto é lido uma vez por sessão, não a cada arquivo', async () => {
  resetMirrorCache();
  const { fetchImpl, pedidos } = origem();
  globalThis.fetch = fetchImpl;
  await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl });
  await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl });
  assert.equal(pedidos.filter((u) => u.includes('mirror.json')).length, 1);
});

test('o progresso é informado enquanto o espelho entrega', async () => {
  resetMirrorCache();
  const { fetchImpl } = origem();
  globalThis.fetch = fetchImpl;
  const avisos = [];
  await fetchFromMirror('DNBR2024.dbc', sha256, {
    fetchImpl,
    onProgress: (recebidos, total) => avisos.push([recebidos, total]),
  });
  assert.deepEqual(avisos, [[CONTEUDO.length, CONTEUDO.length]]);
});
