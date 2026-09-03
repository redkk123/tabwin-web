import assert from 'node:assert/strict';
import test from 'node:test';

import { readRepresentationTag } from '../dist/packages/acquisition/src/ranged-download.js';
import { downloadInRanges } from '../dist/packages/acquisition/src/ranged-download-runner.js';

const cabecalhos = (mapa) => ({
  get: (nome) => mapa[nome.toLowerCase()] ?? null,
});

test('ETag forte é a identidade', () => {
  assert.equal(readRepresentationTag(cabecalhos({ etag: '"abc123"' })), '"abc123"');
});

test('Last-Modified NÃO vira identidade, mesmo sozinho', () => {
  // Medido em 2026-09-03: o DATASUS devolve a hora atual nesse cabeçalho. Seis
  // sondagens ao mesmo pacote preparado deram seis valores, e um `If-Range`
  // com o valor de um segundo antes fez o servidor responder 200 — recusando a
  // faixa. Usar a data ali quebraria todo download em partes.
  assert.equal(readRepresentationTag(cabecalhos({
    'last-modified': 'Wed, 03 Sep 2026 00:00:00 GMT',
  })), undefined);
  assert.equal(readRepresentationTag(cabecalhos({
    etag: 'W/"abc123"', 'last-modified': 'Wed, 03 Sep 2026 00:00:00 GMT',
  })), undefined);
});

test('ETag fraco é recusado', () => {
  // `W/` significa "equivalente para exibição", não "os mesmos bytes" — é
  // exatamente a garantia que não serve para costurar faixas.
  assert.equal(readRepresentationTag(cabecalhos({ etag: 'W/"abc123"' })), undefined);
});

test('sem ETag, não há identidade a fixar', () => {
  assert.equal(readRepresentationTag(cabecalhos({})), undefined);
  assert.equal(readRepresentationTag(cabecalhos({ etag: '  ' })), undefined);
});

/** Origem falsa que serve faixas de um conteúdo, com identidade opcional. */
function origem(conteudo, { tag, trocarNaFaixa } = {}) {
  const pedidos = [];
  return {
    pedidos,
    fetchImpl: async (_url, init) => {
      const range = init.headers.Range ?? init.headers.range;
      const [, inicio, fim] = /bytes=(\d+)-(\d+)/.exec(range);
      pedidos.push({ range, ifRange: init.headers['If-Range'] });

      // Simula o arquivo trocando no servidor: a origem responde 200 com o
      // arquivo inteiro, que é o que um servidor faz quando o `If-Range` não
      // bate mais.
      if (trocarNaFaixa !== undefined && Number(inicio) === trocarNaFaixa) {
        return {
          status: 200,
          headers: cabecalhos({ 'content-length': String(conteudo.length) }),
          body: umCorpo(conteudo),
        };
      }
      const fatia = conteudo.subarray(Number(inicio), Number(fim) + 1);
      return {
        status: 206,
        headers: cabecalhos({
          'content-range': `bytes ${inicio}-${fim}/${conteudo.length}`,
          ...(tag ? { etag: tag } : {}),
        }),
        body: umCorpo(fatia),
      };
    },
  };
}

function umCorpo(bytes) {
  let entregue = false;
  return {
    getReader: () => ({
      read: async () => (entregue ? { done: true } : (entregue = true, { done: false, value: bytes })),
      releaseLock: () => {},
      cancel: async () => {},
    }),
    cancel: async () => {},
  };
}

const CONTEUDO = new Uint8Array(200).map((_, i) => i % 251);
const FAIXAS = [{ start: 0, end: 99 }, { start: 100, end: 199 }];

test('a identidade viaja em If-Range em todas as faixas', async () => {
  const { fetchImpl, pedidos } = origem(CONTEUDO, { tag: '"v1"' });
  const saida = await downloadInRanges({
    url: 'https://exemplo/arquivo.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
    representationTag: '"v1"',
  });
  assert.deepEqual(saida, CONTEUDO);
  assert.equal(pedidos.length, 2);
  assert.ok(pedidos.every((p) => p.ifRange === '"v1"'), 'toda faixa precisa fixar a identidade');
});

test('sem identidade, nada de If-Range — o download segue como antes', async () => {
  const { fetchImpl, pedidos } = origem(CONTEUDO);
  await downloadInRanges({
    url: 'https://exemplo/arquivo.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
  });
  assert.ok(pedidos.every((p) => p.ifRange === undefined));
});

test('arquivo trocado no meio do download é recusado, e a mensagem diz isso', async () => {
  // Este é o caso que o If-Range existe para pegar. O DATASUS monta um zip
  // novo a cada /prepare, então dois pacotes do mesmo arquivo têm exatamente o
  // mesmo tamanho — conferir só o total não separava um do outro.
  const { fetchImpl } = origem(CONTEUDO, { tag: '"v1"', trocarNaFaixa: 100 });
  await assert.rejects(
    downloadInRanges({
      url: 'https://exemplo/arquivo.zip',
      ranges: FAIXAS,
      totalBytes: CONTEUDO.length,
      fetchImpl,
      representationTag: '"v1"',
    }),
    /o arquivo mudou no servidor durante o download/,
  );
});

test('sem If-Range, um 200 continua sendo "não suporta faixa"', async () => {
  // A mensagem precisa mudar conforme o que se sabe: sem identidade fixada,
  // um 200 não prova troca de arquivo, e culpar o servidor de trocar seria
  // afirmar mais do que o dado sustenta.
  const { fetchImpl } = origem(CONTEUDO, { trocarNaFaixa: 100 });
  await assert.rejects(
    downloadInRanges({
      url: 'https://exemplo/arquivo.zip',
      ranges: FAIXAS,
      totalBytes: CONTEUDO.length,
      fetchImpl,
    }),
    /respondeu 200 em vez de 206/,
  );
});
