import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadInRanges } from '../dist/packages/acquisition/src/ranged-download-runner.js';
import {
  HeaderTimeoutError,
  StreamIdleTimeoutError,
} from '../dist/packages/acquisition/src/stream-reader.js';

const TOTAL = 40;
const CONTEUDO = Uint8Array.from({ length: TOTAL }, (_, i) => (i * 7) & 255);
const FAIXAS = [
  { start: 0, end: 9 }, { start: 10, end: 19 },
  { start: 20, end: 29 }, { start: 30, end: 39 },
];

/**
 * Origem falsa: entrega cada faixa em pedaços, sob controle do teste.
 *
 * `comportamento` decide o que cada faixa faz — entregar tudo, travar depois
 * do primeiro pedaço, devolver menos bytes do que prometeu, mudar o tamanho
 * total, ou recusar a faixa.
 */
function origemFalsa(comportamento = () => 'ok') {
  const abertas = [];
  const fetchImpl = async (_url, init) => {
    const [, inicio, fim] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    const range = { start: Number(inicio), end: Number(fim) };
    const acao = comportamento(range);
    if (acao === 'recusa') {
      return new Response(CONTEUDO, { status: 200, headers: { 'content-length': String(TOTAL) } });
    }
    const totalDeclarado = acao === 'total-muda' ? TOTAL + 1 : TOTAL;
    const fatia = CONTEUDO.subarray(range.start, range.end + 1);
    const stream = new ReadableStream({
      start(controller) {
        abertas.push({ range, controller, cancelado: false });
        // Primeiro pedaço sempre sai, para o progresso existir.
        controller.enqueue(fatia.subarray(0, 4));
        if (acao === 'trava') return;
        if (acao === 'curta') { controller.close(); return; }
        controller.enqueue(fatia.subarray(4));
        controller.close();
      },
      cancel() {
        const aberta = abertas.find((a) => a.range.start === range.start);
        if (aberta) aberta.cancelado = true;
      },
    });
    return new Response(stream, {
      status: 206,
      headers: { 'content-range': `bytes ${range.start}-${range.end}/${totalDeclarado}` },
    });
  };
  return { fetchImpl, abertas };
}

test('quatro faixas viram o arquivo inteiro, com progresso a cada pedaço', async () => {
  const { fetchImpl } = origemFalsa();
  const progresso = [];
  const bytes = await downloadInRanges({
    url: 'https://exemplo/arquivo.zip',
    ranges: FAIXAS,
    totalBytes: TOTAL,
    fetchImpl,
    onProgress: (p) => progresso.push(p.receivedBytes),
  });
  assert.deepEqual([...bytes], [...CONTEUDO], 'os bytes montados são os bytes da origem');
  // Duas emissões por faixa: o progresso não espera a parte inteira terminar,
  // que era exatamente o defeito que matava o download a 0,2 MB/s por fluxo.
  assert.equal(progresso.length, 8);
  assert.equal(progresso.at(-1), TOTAL);
});

test('uma faixa que falha aborta as irmãs antes de propagar', async () => {
  // Sem isto, o chamador começa o download integral enquanto três requisições
  // antigas ainda disputam a mesma banda — e a rota do usuário já é o gargalo.
  //
  // A versão anterior deste teste terminava em `assert.ok(vivas.length >= 0)`,
  // verdadeiro sempre: ele passava com ou sem o cancelamento. Auditoria externa
  // apontou a tautologia, que é pior que teste nenhum porque parece cobertura.
  //
  // Corrigir a asserção não bastou: as irmãs "ok" fechavam antes da falha, e
  // stream já fechado nunca recebe `cancel()`. O cenário precisa deixá-las EM
  // VOO — que é a situação real que o cancelamento existe para resolver.
  const abertas = [];
  const fetchImpl = async (_url, init) => {
    const [, inicio, fim] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    const range = { start: Number(inicio), end: Number(fim) };
    const registro = { range, cancelado: false };
    abertas.push(registro);
    const stream = new ReadableStream({
      start(controller) {
        // Um pedaço para todas, e a que falha entrega menos do que prometeu.
        controller.enqueue(CONTEUDO.subarray(range.start, range.start + 4));
        if (range.start === 20) controller.close();
        // As demais ficam abertas, esperando — como uma conexão lenta de verdade.
      },
      cancel() { registro.cancelado = true; },
    });
    return new Response(stream, {
      status: 206,
      headers: { 'content-range': `bytes ${range.start}-${range.end}/${TOTAL}` },
    });
  };

  await assert.rejects(
    downloadInRanges({ url: 'https://exemplo/a.zip', ranges: FAIXAS, totalBytes: TOTAL, fetchImpl }),
    /terminou com 4 de 10/,
  );
  const irmas = abertas.filter((a) => a.range.start !== 20);
  assert.equal(irmas.length, 3, 'as três irmãs chegaram a abrir');
  assert.deepEqual(
    irmas.filter((a) => !a.cancelado).map((a) => a.range.start),
    [],
    'nenhuma irmã pode continuar viva disputando banda enquanto o fallback começa',
  );
});

test('o erro só sai depois de todas as faixas terminarem', async () => {
  // `Promise.allSettled` antes de propagar: propagar antes devolveria o
  // controle a quem vai abrir outra conexão sem as anteriores terem morrido.
  let vivas = 0;
  const fetchImpl = async (_url, init) => {
    const [, inicio, fim] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    const range = { start: Number(inicio), end: Number(fim) };
    vivas++;
    if (range.start === 0) { vivas--; throw new Error('parte zero explodiu'); }
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(CONTEUDO.subarray(range.start, range.end + 1)); },
      cancel() { vivas--; },
    });
    return new Response(stream, {
      status: 206, headers: { 'content-range': `bytes ${range.start}-${range.end}/${TOTAL}` },
    });
  };
  await assert.rejects(
    downloadInRanges({ url: 'https://exemplo/a.zip', ranges: FAIXAS, totalBytes: TOTAL, fetchImpl }),
    /parte zero explodiu/,
  );
  assert.equal(vivas, 0, 'nenhuma requisição irmã sobrevive ao retorno do erro');
});

test('cancelamento humano não é confundido com falha da origem', async () => {
  const { fetchImpl } = origemFalsa((r) => (r.start === 0 ? 'trava' : 'ok'));
  const controlador = new AbortController();
  const promessa = downloadInRanges({
    url: 'https://exemplo/a.zip', ranges: FAIXAS, totalBytes: TOTAL, fetchImpl,
    signal: controlador.signal, idleMs: 60_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  controlador.abort(new Error('cancelado pelo usuário'));
  await assert.rejects(promessa, (erro) => {
    assert.ok(!(erro instanceof StreamIdleTimeoutError), 'cancelar não pode virar ociosidade');
    return true;
  });
});

test('faixa que trava vence por ociosidade, e o arquivo não é montado pela metade', async () => {
  const { fetchImpl } = origemFalsa((r) => (r.start === 10 ? 'trava' : 'ok'));
  await assert.rejects(
    downloadInRanges({
      url: 'https://exemplo/a.zip', ranges: FAIXAS, totalBytes: TOTAL, fetchImpl, idleMs: 25,
    }),
    (erro) => erro instanceof StreamIdleTimeoutError,
  );
});

test('total que muda no meio é recusado: seria um arquivo que nunca existiu', async () => {
  const { fetchImpl } = origemFalsa((r) => (r.start === 30 ? 'total-muda' : 'ok'));
  await assert.rejects(
    downloadInRanges({ url: 'https://exemplo/a.zip', ranges: FAIXAS, totalBytes: TOTAL, fetchImpl }),
    /total mudou de 40 para 41/,
  );
});

test('servidor que ignora a faixa e devolve 200 é recusado, não montado', async () => {
  const { fetchImpl } = origemFalsa(() => 'recusa');
  await assert.rejects(
    downloadInRanges({ url: 'https://exemplo/a.zip', ranges: FAIXAS, totalBytes: TOTAL, fetchImpl }),
    /parte 0-9/,
  );
});

test('faixa cujo servidor nunca responde é cortada nos cabeçalhos, não fica pendente', async () => {
  // Lacuna apontada por auditoria externa: o relógio de ociosidade só vale
  // quando existe corpo. Uma faixa que trava ANTES da resposta não tinha
  // prazo nenhum — e uma promessa pendente para sempre trava o lote inteiro,
  // porque o fallback espera `allSettled`.
  const fetchImpl = async (_url, init) => {
    const [, inicio] = /bytes=(\d+)-/.exec(init.headers.Range);
    if (Number(inicio) === 10) return new Promise(() => {});
    const range = { start: Number(inicio), end: Number(inicio) + 9 };
    return new Response(CONTEUDO.subarray(range.start, range.end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${range.start}-${range.end}/${TOTAL}` },
    });
  };
  await assert.rejects(
    downloadInRanges({
      url: 'https://exemplo/a.zip', ranges: FAIXAS, totalBytes: TOTAL, fetchImpl, headerMs: 40,
    }),
    (erro) => erro instanceof HeaderTimeoutError,
  );
});
