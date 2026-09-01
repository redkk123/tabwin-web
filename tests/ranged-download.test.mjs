import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_RANGE_PARTS,
  MIN_BYTES_FOR_RANGED_DOWNLOAD,
  assembleRangedParts,
  describeDownloadStrategy,
  parseContentRange,
  planByteRanges,
  rangeHeaderValue,
  readRangeSupport,
} from '../dist/packages/acquisition/src/ranged-download.js';

const MB = 1024 * 1024;

test('arquivo pequeno não é dividido — a ida e volta custaria mais que a economia', () => {
  assert.deepEqual(planByteRanges(1 * MB), []);
  assert.deepEqual(planByteRanges(MIN_BYTES_FOR_RANGED_DOWNLOAD - 1), []);
  assert.deepEqual(planByteRanges(0), []);
  assert.deepEqual(planByteRanges(-5), []);
});

test('as partes cobrem o arquivo inteiro, sem furo e sem sobreposição', () => {
  // Um furo aqui vira arquivo corrompido que só aparece na descompressão.
  for (const total of [8 * MB, 63 * MB, 100 * MB + 7, 12345678]) {
    const ranges = planByteRanges(total);
    if (!ranges.length) continue;
    assert.equal(ranges[0].start, 0, `${total}: precisa começar no byte 0`);
    assert.equal(ranges[ranges.length - 1].end, total - 1, `${total}: precisa terminar no último byte`);
    for (let index = 1; index < ranges.length; index++) {
      assert.equal(ranges[index].start, ranges[index - 1].end + 1, `${total}: furo entre partes`);
    }
    const soma = ranges.reduce((sum, range) => sum + (range.end - range.start + 1), 0);
    assert.equal(soma, total, `${total}: as partes precisam somar o arquivo`);
  }
});

test('o número de partes é pequeno de propósito, porque o servidor oscila', () => {
  assert.ok(planByteRanges(63 * MB).length <= MAX_RANGE_PARTS);
  assert.ok(planByteRanges(2000 * MB).length <= MAX_RANGE_PARTS);
  // Pedir mais que o teto não aumenta.
  assert.ok(planByteRanges(63 * MB, 32).length <= MAX_RANGE_PARTS);
  // Nenhuma parte minúscula: um arquivo de 9 MB não vira 4 pedaços de 2 MB.
  for (const range of planByteRanges(9 * MB)) {
    assert.ok(range.end - range.start + 1 >= 1 * MB);
  }
});

test('o cabeçalho Range sai no formato que o HTTP espera', () => {
  assert.equal(rangeHeaderValue({ start: 0, end: 1023 }), 'bytes=0-1023');
  assert.equal(rangeHeaderValue({ start: 1024, end: 2047 }), 'bytes=1024-2047');
});

test('Content-Range ilegível não vira palpite', () => {
  // Adivinhar aqui monta o arquivo com bytes trocados de lugar.
  for (const value of [null, '', 'bytes */100', 'bytes 0-9', 'itens 0-9/100', 'bytes a-b/c', 'bytes 10-5/100', 'bytes 0-100/50']) {
    assert.equal(parseContentRange(value), null, JSON.stringify(value));
  }
  assert.deepEqual(parseContentRange('bytes 0-1023/66060288'), { start: 0, end: 1023, totalBytes: 66060288 });
  assert.deepEqual(parseContentRange('  BYTES 5-9/10  '), { start: 5, end: 9, totalBytes: 10 });
});

test('só um 206 coerente conta como suporte — promessa não basta', () => {
  const pedido = { start: 0, end: 0 };

  // 200 significa que o servidor ignorou o Range e mandou o arquivo inteiro.
  assert.deepEqual(
    readRangeSupport(200, 'bytes 0-0/100', pedido),
    { supported: false, reason: 'o servidor respondeu 200 em vez de 206' },
  );
  // 206 sem Content-Range legível não dá para montar nada.
  assert.equal(readRangeSupport(206, null, pedido).supported, false);
  assert.equal(readRangeSupport(206, 'bytes */100', pedido).supported, false);
  // Devolveu faixa diferente da pedida: não dá para confiar no resto.
  const outra = readRangeSupport(206, 'bytes 0-99/100', pedido);
  assert.equal(outra.supported, false);
  assert.match(outra.reason, /0-99.*0-0/);

  assert.deepEqual(readRangeSupport(206, 'bytes 0-0/66060288', pedido), {
    supported: true, totalBytes: 66060288,
  });
});

test('a montagem confere os bytes e recusa qualquer coisa fora do lugar', () => {
  const parte = (start, end, fill) => ({
    range: { start, end },
    bytes: new Uint8Array(end - start + 1).fill(fill),
  });

  const montado = assembleRangedParts([parte(4, 7, 2), parte(0, 3, 1)], 8);
  assert.deepEqual([...montado], [1, 1, 1, 1, 2, 2, 2, 2], 'fora de ordem na entrada, na ordem certa na saída');

  // Furo: um byte que ninguém baixou.
  assert.throws(() => assembleRangedParts([parte(0, 3, 1), parte(5, 7, 2)], 8), /fora de sequência/);
  // Parte com tamanho diferente do que declarou.
  assert.throws(
    () => assembleRangedParts([{ range: { start: 0, end: 7 }, bytes: new Uint8Array(4) }], 8),
    /veio com 4 bytes, não 8/,
  );
  // Partes que não somam o arquivo.
  assert.throws(() => assembleRangedParts([parte(0, 3, 1)], 8), /somam 4 bytes, mas o arquivo tem 8/);
  assert.throws(() => assembleRangedParts([], 8), /nenhuma parte/);
});

test('a interface diz por qual caminho o arquivo veio, e por quê', () => {
  // Sem isso, um download lento parece aleatório em vez de explicado.
  assert.match(describeDownloadStrategy('partes paralelas', 4), /4 partes paralelas/);
  assert.match(
    describeDownloadStrategy('única conexão', 1, 'o servidor respondeu 200 em vez de 206'),
    /uma conexão só — o servidor respondeu 200/,
  );
  assert.equal(describeDownloadStrategy('única conexão', 1), 'Baixado por uma conexão só.');
});
