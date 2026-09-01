import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';

/**
 * A fiação do download em partes, testada onde ela mora.
 *
 * O módulo do cliente importa `.ts` direto (é código do Vite), então aqui a
 * verificação é sobre o COMPORTAMENTO combinado das peças puras — sondagem,
 * plano de faixas e montagem — encadeadas do mesmo jeito que o cliente as
 * encadeia. O que se prova é a regra que importa: a otimização nunca pode ser
 * o motivo de um download falhar.
 */
const {
  assembleRangedParts,
  planByteRanges,
  rangeHeaderValue,
  readRangeSupport,
} = await import('../dist/packages/acquisition/src/ranged-download.js');

const MB = 1024 * 1024;

/** Repete o encadeamento do cliente sobre um `fetch` falso. */
async function baixar(fakeFetch, url = 'https://exemplo/arquivo.zip') {
  const probe = { start: 0, end: 0 };
  const resposta = await fakeFetch(url, { headers: { Range: rangeHeaderValue(probe) } });
  const support = readRangeSupport(resposta.status, resposta.headers.get('content-range'), probe);
  if (!support.supported) return { estrategia: 'única conexão', motivo: support.reason, bytes: null };

  const ranges = planByteRanges(support.totalBytes);
  if (ranges.length < 2) {
    return { estrategia: 'única conexão', motivo: 'arquivo pequeno demais para dividir', bytes: null };
  }
  const partes = await Promise.all(ranges.map(async (range) => {
    const parte = await fakeFetch(url, { headers: { Range: rangeHeaderValue(range) } });
    if (parte.status !== 206) throw new Error(`parte respondeu ${parte.status}`);
    return { range, bytes: new Uint8Array(await parte.arrayBuffer()) };
  }));
  return {
    estrategia: 'partes paralelas',
    partes: ranges.length,
    bytes: assembleRangedParts(partes, support.totalBytes),
  };
}

/** Servidor falso que honra `Range` sobre um conteúdo conhecido. */
function servidorComFaixas(conteudo) {
  let pedidos = 0;
  const impl = async (_url, init = {}) => {
    pedidos++;
    const header = init.headers?.Range;
    const match = /^bytes=(\d+)-(\d+)$/.exec(header ?? '');
    if (!match) {
      return new Response(conteudo, { status: 200, headers: { 'content-type': 'application/zip' } });
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), conteudo.byteLength - 1);
    return new Response(conteudo.slice(start, end + 1), {
      status: 206,
      headers: {
        'content-type': 'application/zip',
        'content-range': `bytes ${start}-${end}/${conteudo.byteLength}`,
      },
    });
  };
  impl.pedidos = () => pedidos;
  return impl;
}

test('com suporte a faixas, o arquivo montado é byte a byte igual ao original', () => {
  // A prova que importa: paralelizar não pode mudar um único byte. Um arquivo
  // montado errado não falha na hora — falha depois, na descompressão, com uma
  // mensagem que não aponta para a causa.
  const original = new Uint8Array(20 * MB);
  for (let index = 0; index < original.length; index++) original[index] = index % 251;

  return baixar(servidorComFaixas(original)).then((resultado) => {
    assert.equal(resultado.estrategia, 'partes paralelas');
    assert.ok(resultado.partes >= 2);
    assert.equal(resultado.bytes.byteLength, original.byteLength);
    assert.ok(Buffer.from(resultado.bytes).equals(Buffer.from(original)), 'os bytes precisam ser idênticos');
  });
});

test('servidor que ignora Range faz o download voltar ao caminho simples', async () => {
  // O caso mais provável no mundo real: o servidor responde 200 com o arquivo
  // inteiro. Tratar isso como uma "parte" montaria lixo.
  const conteudo = zipSync({ 'A.dbf': strToU8('conteudo') });
  const resultado = await baixar(async () => new Response(conteudo, {
    status: 200, headers: { 'content-type': 'application/zip' },
  }));
  assert.equal(resultado.estrategia, 'única conexão');
  assert.match(resultado.motivo, /200 em vez de 206/);
  assert.equal(resultado.bytes, null, 'nada é montado a partir de uma resposta que não é 206');
});

test('206 com Content-Range incoerente também volta ao caminho simples', async () => {
  const resultado = await baixar(async () => new Response(new Uint8Array(4), {
    status: 206,
    headers: { 'content-type': 'application/zip', 'content-range': 'bytes 0-99/1000' },
  }));
  assert.equal(resultado.estrategia, 'única conexão');
  assert.match(resultado.motivo, /0-99.*0-0/);
});

test('arquivo pequeno não é dividido, mesmo com suporte a faixas', async () => {
  const pequeno = new Uint8Array(1 * MB).fill(7);
  const resultado = await baixar(servidorComFaixas(pequeno));
  assert.equal(resultado.estrategia, 'única conexão');
  assert.match(resultado.motivo, /pequeno demais/);
});

test('uma parte que falha derruba a montagem, e o chamador cai no caminho simples', async () => {
  // A montagem precisa lançar em vez de devolver algo parcial: bytes faltando
  // viram arquivo corrompido, e corrompido é pior do que lento.
  const original = new Uint8Array(20 * MB).fill(3);
  const servidor = servidorComFaixas(original);
  let chamadas = 0;
  const instavel = async (url, init) => {
    chamadas++;
    // A sondagem passa; a terceira parte falha, como o DATASUS faz.
    if (chamadas === 3) return new Response('erro', { status: 504 });
    return servidor(url, init);
  };
  await assert.rejects(() => baixar(instavel), /parte respondeu 504/);
});

test('o servidor recebe exatamente as faixas planejadas, sem furo', async () => {
  const original = new Uint8Array(20 * MB).fill(9);
  const pedidas = [];
  const servidor = servidorComFaixas(original);
  await baixar(async (url, init) => {
    const header = init.headers?.Range;
    if (header && header !== 'bytes=0-0') pedidas.push(header);
    return servidor(url, init);
  });

  const faixas = pedidas.map((header) => {
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(header);
    return { start: Number(start), end: Number(end) };
  }).sort((left, right) => left.start - right.start);

  assert.ok(faixas.length >= 2);
  assert.equal(faixas[0].start, 0);
  assert.equal(faixas[faixas.length - 1].end, original.byteLength - 1);
  for (let index = 1; index < faixas.length; index++) {
    assert.equal(faixas[index].start, faixas[index - 1].end + 1, 'furo entre as faixas pedidas');
  }
});
