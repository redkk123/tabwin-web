import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadInRanges } from '../dist/packages/acquisition/src/ranged-download-runner.js';

const CONTEUDO = new Uint8Array(200).map((_, i) => i % 251);
const FAIXAS = [{ start: 0, end: 99 }, { start: 100, end: 199 }];

const cabecalhos = (mapa) => ({ get: (n) => mapa[n.toLowerCase()] ?? null });

function corpo(bytes, { cortarEm } = {}) {
  let entregue = false;
  return {
    getReader: () => ({
      read: async () => {
        if (entregue) return { done: true };
        entregue = true;
        if (cortarEm !== undefined) {
          // Entrega menos do que prometeu e encerra: é o que uma conexão que
          // cai no meio parece do lado do cliente.
          return { done: false, value: bytes.subarray(0, cortarEm) };
        }
        return { done: false, value: bytes };
      },
      releaseLock: () => {},
      cancel: async () => {},
    }),
    cancel: async () => {},
  };
}

/** Origem que falha as N primeiras tentativas de uma faixa e depois serve. */
function origem({ falharFaixa, vezes = 1, modo = 'corte' } = {}) {
  const tentativasPorFaixa = new Map();
  return {
    tentativasPorFaixa,
    fetchImpl: async (_url, init) => {
      const range = init.headers.Range ?? init.headers.range;
      const [, inicio, fim] = /bytes=(\d+)-(\d+)/.exec(range);
      const chave = Number(inicio);
      const n = (tentativasPorFaixa.get(chave) ?? 0) + 1;
      tentativasPorFaixa.set(chave, n);

      const fatia = CONTEUDO.subarray(Number(inicio), Number(fim) + 1);
      const cabecalho = cabecalhos({
        'content-range': `bytes ${inicio}-${fim}/${CONTEUDO.length}`,
      });

      if (chave === falharFaixa && n <= vezes) {
        if (modo === 'status') return { status: 503, headers: cabecalho, body: corpo(fatia) };
        return { status: 206, headers: cabecalho, body: corpo(fatia, { cortarEm: 10 }) };
      }
      return { status: 206, headers: cabecalho, body: corpo(fatia) };
    },
  };
}

const semEspera = { sleep: async () => {}, random: () => 0.5 };

test('uma faixa que falha se refaz, sem derrubar o que as irmãs trouxeram', async () => {
  // O ponto: antes, um soluço numa faixa abortava o grupo e o download inteiro
  // recomeçava por conexão única. Numa conexão instável isso transforma um
  // tropeço em recomeço do zero.
  const { fetchImpl, tentativasPorFaixa } = origem({ falharFaixa: 100, vezes: 1 });
  const saida = await downloadInRanges({
    url: 'https://exemplo/a.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
    ...semEspera,
  });
  assert.deepEqual(saida, CONTEUDO);
  assert.equal(tentativasPorFaixa.get(0), 1, 'a faixa que deu certo não repete');
  assert.equal(tentativasPorFaixa.get(100), 2, 'a que falhou tenta de novo');
});

test('o progresso não conta duas vezes os bytes de uma tentativa perdida', async () => {
  // Sem devolver o parcial ao total, a barra passaria de 100% e mentiria sobre
  // o que chegou de fato.
  const { fetchImpl } = origem({ falharFaixa: 100, vezes: 1 });
  let maiorProgresso = 0;
  const saida = await downloadInRanges({
    url: 'https://exemplo/a.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
    onProgress: ({ receivedBytes }) => {
      maiorProgresso = Math.max(maiorProgresso, receivedBytes);
    },
    ...semEspera,
  });
  assert.equal(saida.byteLength, CONTEUDO.length);
  assert.ok(maiorProgresso <= CONTEUDO.length,
    `progresso chegou a ${maiorProgresso} de ${CONTEUDO.length}`);
});

test('esgotadas as tentativas, o erro sobe e o grupo cai', async () => {
  const { fetchImpl, tentativasPorFaixa } = origem({ falharFaixa: 100, vezes: 99 });
  await assert.rejects(downloadInRanges({
    url: 'https://exemplo/a.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
    attemptsPerRange: 3,
    ...semEspera,
  }));
  assert.equal(tentativasPorFaixa.get(100), 3, 'três tentativas, contando a primeira');
});

test('arquivo trocado no servidor não é retentado — insistir não muda o fato', async () => {
  const fetchImpl = async (_url, init) => {
    const range = init.headers.Range ?? init.headers.range;
    const [, inicio, fim] = /bytes=(\d+)-(\d+)/.exec(range);
    if (Number(inicio) === 100) {
      return { status: 200, headers: cabecalhos({}), body: corpo(CONTEUDO) };
    }
    return {
      status: 206,
      headers: cabecalhos({ 'content-range': `bytes ${inicio}-${fim}/${CONTEUDO.length}` }),
      body: corpo(CONTEUDO.subarray(Number(inicio), Number(fim) + 1)),
    };
  };
  let esperas = 0;
  await assert.rejects(downloadInRanges({
    url: 'https://exemplo/a.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
    representationTag: '"v1"',
    sleep: async () => { esperas++; },
    random: () => 0.5,
  }), /o arquivo mudou no servidor/);
  assert.equal(esperas, 0, 'não pode nem chegar a esperar para tentar de novo');
});

test('cancelamento do usuário não vira retentativa', async () => {
  const controle = new AbortController();
  const fetchImpl = async () => {
    controle.abort();
    throw new DOMException('Aborted', 'AbortError');
  };
  let esperas = 0;
  await assert.rejects(downloadInRanges({
    url: 'https://exemplo/a.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
    signal: controle.signal,
    sleep: async () => { esperas++; },
    random: () => 0.5,
  }));
  assert.equal(esperas, 0, 'quem cancelou não quer que o programa tente de novo');
});

test('a espera cresce entre tentativas e tem jitter', async () => {
  // Sem jitter, duas faixas que falham pelo mesmo motivo voltariam juntas e
  // repetiriam a colisão.
  const { fetchImpl } = origem({ falharFaixa: 100, vezes: 2 });
  const esperas = [];
  await downloadInRanges({
    url: 'https://exemplo/a.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl,
    sleep: async (ms) => { esperas.push(ms); },
    random: () => 0.5,
  });
  assert.equal(esperas.length, 2);
  assert.ok(esperas[1] > esperas[0], `esperas não cresceram: ${esperas}`);

  // Com sorteio diferente, a espera muda — é isso que separa as faixas.
  const outro = origem({ falharFaixa: 100, vezes: 1 });
  const comOutroJitter = [];
  await downloadInRanges({
    url: 'https://exemplo/a.zip',
    ranges: FAIXAS,
    totalBytes: CONTEUDO.length,
    fetchImpl: outro.fetchImpl,
    sleep: async (ms) => { comOutroJitter.push(ms); },
    random: () => 0.9,
  });
  assert.notEqual(comOutroJitter[0], esperas[0]);
});
