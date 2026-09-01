import test from 'node:test';
import assert from 'node:assert/strict';
import { implodeDecompress } from '@precisa-saude/datasus-dbc';
import { implodeDecompressChunks } from '../dist/packages/acquisition/src/implode-stream.js';

test('chunked DCL decoder matches the reference decoder on the blast.c vector', () => {
  const compressed = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]);
  const expected = implodeDecompress(compressed, 13);
  const chunks = [];
  const produced = implodeDecompressChunks(compressed, expected.length, (chunk, offset) => {
    assert.equal(offset, chunks.reduce((total, item) => total + item.length, 0));
    assert.ok(chunk.length <= 4096);
    chunks.push(chunk);
  });
  assert.equal(produced, expected.length);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(expected));
  assert.equal(new TextDecoder().decode(Buffer.concat(chunks)), 'AIAIAIAIAIAIA');
});

test('chunked DCL decoder rejects declared-size mismatch and output bombs', () => {
  const compressed = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]);
  assert.throws(() => implodeDecompressChunks(compressed, 14, () => {}), /produziu 13 bytes/);
  assert.equal(implodeDecompressChunks(compressed, 14, () => {}, { allowMissingFinalByte: true }), 13);
  assert.throws(() => implodeDecompressChunks(compressed, 13, () => {}, { maxOutputBytes: 12 }), /acima do limite/);
});

test('a tabela rápida responde o mesmo que o percurso bit a bit, em todo padrão possível', async () => {
  // A tabela é construída EXECUTANDO o percurso canônico, então a igualdade é
  // por construção — mas construção por construção já deu errado antes. Aqui
  // ela é conferida: para cada padrão de bits que a tabela resolve, o símbolo
  // e o número de bits consumidos têm que bater com a árvore.
  const { __huffmanTablesForTest } = await import('../dist/packages/acquisition/src/implode-stream.js');
  assert.ok(__huffmanTablesForTest, 'as tabelas precisam ser observáveis para este teste existir');

  for (const [nome, table] of Object.entries(__huffmanTablesForTest)) {
    let resolvidos = 0;
    for (let pattern = 0; pattern < table.fastSymbol.length; pattern++) {
      const symbol = table.fastSymbol[pattern];
      if (symbol < 0) continue;
      resolvidos++;

      // Percurso canônico, escrito aqui de forma independente.
      let code = 0, first = 0, index = 0, nextIndex = 1, achou = null;
      for (let length = 1; length <= 13; length++) {
        code |= ((pattern >> (length - 1)) & 1) ^ 1;
        const count = table.count[nextIndex++];
        if (code < first + count) { achou = { symbol: table.symbol[index + code - first], length }; break; }
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      assert.ok(achou, `${nome}: padrão ${pattern} está na tabela mas a árvore não resolve`);
      assert.equal(symbol, achou.symbol, `${nome}: símbolo diferente no padrão ${pattern}`);
      assert.equal(table.fastLength[pattern], achou.length, `${nome}: bits consumidos diferentes no padrão ${pattern}`);
    }
    // Se a tabela não resolvesse quase nada, o caminho rápido seria decorativo.
    const cobertura = resolvidos / table.fastSymbol.length;
    assert.ok(cobertura > 0.5, `${nome}: a tabela só cobre ${(cobertura * 100).toFixed(0)}% dos padrões`);
  }
});
