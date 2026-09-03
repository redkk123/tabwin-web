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

/** Armazenamento de partes em memória, para a retomada ser exercitável. */
function armazenamento(inicial = null) {
  const guardado = inicial ? new Map([[inicial.sha256, inicial.bytes]]) : new Map();
  const chamadas = [];
  return {
    guardado,
    chamadas,
    store: {
      read: async (sha, total) => {
        chamadas.push(`read:${sha.slice(0, 6)}`);
        const bytes = guardado.get(sha);
        return bytes ? { sha256: sha, bytes: bytes.byteLength, totalBytes: total } : null;
      },
      readBytes: async (sha, esperados) => {
        const bytes = guardado.get(sha);
        return bytes && bytes.byteLength === esperados ? bytes : null;
      },
      write: async (sha, bytes) => { chamadas.push('write'); guardado.set(sha, bytes); },
      delete: async (sha) => { chamadas.push('delete'); guardado.delete(sha); },
    },
  };
}

/** Origem que honra `Range`, como o R2 faz. */
function origemComFaixa({ arquivo = CONTEUDO, ignoraFaixa = false } = {}) {
  const pedidos = [];
  return {
    pedidos,
    fetchImpl: async (url, init) => {
      pedidos.push({ url: String(url), range: init?.headers?.Range ?? null });
      if (String(url).includes('mirror.json')) return { ok: true, text: async () => manifesto() };
      const faixa = init?.headers?.Range;
      if (!faixa || ignoraFaixa) {
        return { ok: true, status: 200, headers: { get: () => null }, body: corpo(arquivo) };
      }
      const de = Number(/bytes=(\d+)-/.exec(faixa)[1]);
      return {
        ok: true,
        status: 206,
        headers: { get: (n) => (n.toLowerCase() === 'content-range' ? `bytes ${de}-${arquivo.length - 1}/${arquivo.length}` : null) },
        body: corpo(arquivo.subarray(de)),
      };
    },
  };
}

test('um download interrompido continua de onde parou', async () => {
  // O caso que a retomada existe para socorrer: 40 dos 64 bytes já estavam
  // neste aparelho, e a origem só precisa mandar os 24 que faltam.
  resetMirrorCache();
  const { store } = armazenamento({ sha256: HASH, bytes: CONTEUDO.subarray(0, 40) });
  const { fetchImpl, pedidos } = origemComFaixa();
  globalThis.fetch = fetchImpl;
  const retomadas = [];
  const r = await fetchFromMirror('DNBR2024.dbc', sha256, {
    fetchImpl, partials: store, onResume: (de, total) => retomadas.push([de, total]),
  });
  assert.ok(r, 'a retomada não entregou o arquivo');
  assert.deepEqual(r.bytes, CONTEUDO, 'o arquivo montado difere do original');
  assert.deepEqual(retomadas, [[40, 64]]);
  assert.equal(pedidos.at(-1).range, 'bytes=40-');
});

test('a origem que ignora a faixa não produz um arquivo do dobro do tamanho', async () => {
  // Somar o guardado a uma resposta 200 daria 104 bytes de um arquivo de 64,
  // e o hash denunciaria — mas tarde, depois de baixar tudo de novo.
  resetMirrorCache();
  const { store } = armazenamento({ sha256: HASH, bytes: CONTEUDO.subarray(0, 40) });
  const { fetchImpl } = origemComFaixa({ ignoraFaixa: true });
  globalThis.fetch = fetchImpl;
  const r = await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl, partials: store });
  assert.ok(r);
  assert.deepEqual(r.bytes, CONTEUDO);
});

test('a parte guardada é apagada quando o arquivo completa', async () => {
  // Sem isto o espaço cresce para sempre, e num celular apertado isso é a
  // diferença entre o aplicativo servir e atrapalhar.
  resetMirrorCache();
  const { store, guardado } = armazenamento({ sha256: HASH, bytes: CONTEUDO.subarray(0, 40) });
  const { fetchImpl } = origemComFaixa();
  globalThis.fetch = fetchImpl;
  await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl, partials: store });
  assert.equal(guardado.size, 0);
});

test('parte que leva a hash errado é apagada, para o erro não se repetir', async () => {
  resetMirrorCache();
  const { store, guardado } = armazenamento({ sha256: HASH, bytes: new Uint8Array(40).fill(7) });
  const { fetchImpl } = origemComFaixa();
  globalThis.fetch = fetchImpl;
  assert.equal(await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl, partials: store }), null);
  assert.equal(guardado.size, 0, 'a parte ruim ficou guardada e envenenaria a próxima tentativa');
});

test('sem parte guardada, nada muda: nenhum Range é pedido', async () => {
  resetMirrorCache();
  const { store } = armazenamento();
  const { fetchImpl, pedidos } = origemComFaixa();
  globalThis.fetch = fetchImpl;
  const r = await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl, partials: store });
  assert.ok(r);
  assert.equal(pedidos.at(-1).range, null);
});

test('um navegador sem OPFS baixa igual, pelo mesmo caminho', async () => {
  // O armazenamento vazio é o padrão em navegador sem suporte; ele não pode
  // virar um desvio de código que ninguém testa.
  resetMirrorCache();
  const { NO_PARTIAL_STORE } = await import('../dist/packages/acquisition/src/partial-download.js');
  const { fetchImpl } = origemComFaixa();
  globalThis.fetch = fetchImpl;
  const r = await fetchFromMirror('DNBR2024.dbc', sha256, { fetchImpl, partials: NO_PARTIAL_STORE });
  assert.ok(r);
  assert.deepEqual(r.bytes, CONTEUDO);
});
