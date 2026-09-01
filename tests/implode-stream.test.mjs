import test from 'node:test';
import assert from 'node:assert/strict';
import { implodeDecompress } from '@precisa-saude/datasus-dbc';
import {
  __huffmanTablesForTest,
  implodeDecompressChunks,
} from '../dist/packages/acquisition/src/implode-stream.js';

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

test('a tabela rápida responde o mesmo que o percurso bit a bit, em todo padrão possível', () => {
  // A tabela é construída EXECUTANDO o percurso canônico, então a igualdade é
  // por construção — mas construção por construção já deu errado antes. Aqui
  // ela é conferida: para cada padrão de bits que a tabela resolve, o símbolo
  // e o número de bits consumidos têm que bater com a árvore.
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

/**
 * Um codificador DCL mínimo, para FABRICAR os casos que o vetor do blast.c não
 * contém.
 *
 * Existe porque a cópia de casamento passou a ter dois ramos — `copyWithin`
 * quando não há sobreposição e o laço byte a byte quando a cópia lê o que
 * acabou de escrever — e sem escrever o fluxo não há como exercitar os dois
 * fora de um `.dbc` real, que é ativo privado e não entra neste repositório.
 *
 * A tabela canônica não é reinventada aqui: é derivada das MESMAS contagens
 * que o decodificador usa. E o resultado é conferido contra
 * `implodeDecompress`, que é outra implementação, de outra gente — se as duas
 * concordarem, não é o meu erro concordando comigo mesmo.
 */
function codigosCanonicos(tabela) {
  const mapa = new Map();
  let indice = 0;
  let primeiro = 0;
  for (let comprimento = 1; comprimento <= 13; comprimento++) {
    const quantos = tabela.count[comprimento];
    for (let i = 0; i < quantos; i++) {
      mapa.set(tabela.symbol[indice + i], { codigo: primeiro + i, comprimento });
    }
    indice += quantos;
    primeiro = (primeiro + quantos) << 1;
  }
  return mapa;
}

const BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

class FluxoImplode {
  constructor(bitsDeDicionario = 6) {
    this.bytes = [];
    this.atual = 0;
    this.ocupados = 0;
    this.saida = [];
    this.bitsDeDicionario = bitsDeDicionario;
    this.runs = codigosCanonicos(__huffmanTablesForTest.run);
    this.distancias = codigosCanonicos(__huffmanTablesForTest.distance);
    // Cabeçalho: literais crus (modo 0) e o tamanho do dicionário.
    this.crus(0, 8);
    this.crus(bitsDeDicionario, 8);
  }

  bit(valor) {
    this.atual |= (valor & 1) << this.ocupados;
    if (++this.ocupados === 8) { this.bytes.push(this.atual); this.atual = 0; this.ocupados = 0; }
  }

  /** O decodificador lê `bits(n)` do bit menos significativo para cima. */
  crus(valor, quantos) { for (let i = 0; i < quantos; i++) this.bit((valor >> i) & 1); }

  /**
   * O primeiro bit do fluxo vira o bit MAIS significativo do código, e cada bit
   * entra invertido — a convenção do blast.c que o percurso canônico assume.
   */
  huffman({ codigo, comprimento }) {
    for (let j = 1; j <= comprimento; j++) this.bit(((codigo >> (comprimento - j)) & 1) ^ 1);
  }

  literal(byte) {
    this.bit(0);
    this.crus(byte, 8);
    this.saida.push(byte);
  }

  casamento(comprimento, distancia) {
    let simbolo = -1;
    for (let s = 0; s < BASE.length; s++) {
      if (comprimento >= BASE[s] && comprimento < BASE[s] + (1 << EXTRA[s])) { simbolo = s; break; }
    }
    if (simbolo < 0) throw new Error(`comprimento ${comprimento} não é codificável`);
    this.bit(1);
    this.huffman(this.runs.get(simbolo));
    this.crus(comprimento - BASE[simbolo], EXTRA[simbolo]);
    const deslocamento = comprimento === 2 ? 2 : this.bitsDeDicionario;
    this.huffman(this.distancias.get((distancia - 1) >> deslocamento));
    this.crus((distancia - 1) & ((1 << deslocamento) - 1), deslocamento);
    for (let i = 0; i < comprimento; i++) this.saida.push(this.saida[this.saida.length - distancia]);
  }

  encerrar() {
    this.bit(1);
    this.huffman(this.runs.get(15));
    this.crus(519 - 264, 8);
    const bytes = [...this.bytes];
    if (this.ocupados) bytes.push(this.atual);
    return { comprimido: Uint8Array.from(bytes), esperado: Uint8Array.from(this.saida) };
  }
}

/**
 * Bytes sem período curto.
 *
 * A primeira versão destes testes usava `(i * 3) & 255`, que se repete a cada
 * 256 bytes — e 4096 é múltiplo de 256, então TODA janela ficava com o mesmo
 * conteúdo e o modo de vista passava por coincidência. O teste não pegava a
 * regressão que existe para pegar. Aqui a sequência tem período longo, e a
 * janela nunca se repete.
 */
/**
 * Compara os bytes dizendo ONDE difere.
 *
 * `deepEqual` sobre nove mil bytes gasta seis segundos montando um diff que
 * ninguém consegue ler. O índice do primeiro byte diferente diz mais e custa
 * quase nada.
 */
function assertBytesIguais(recebido, esperado, mensagem) {
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length === b.length && a.compare(b) === 0) return;
  let divergencia = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) { divergencia = i; break; }
  }
  assert.fail(
    `${mensagem}: ${a.length} bytes contra ${b.length} esperados`
    + (divergencia >= 0
      ? `; primeiro byte diferente no índice ${divergencia} (${a[divergencia]} != ${b[divergencia]})`
      : '; o prefixo bate e o tamanho não'),
  );
}

function bytesSemPeriodo(quantos) {
  let semente = 0x2545f491;
  const saida = new Uint8Array(quantos);
  for (let i = 0; i < quantos; i++) {
    semente ^= semente << 13; semente >>>= 0;
    semente ^= semente >>> 17;
    semente ^= semente << 5; semente >>>= 0;
    saida[i] = semente & 255;
  }
  return saida;
}

function decodificar(comprimido, tamanho, opcoes = {}) {
  const partes = [];
  implodeDecompressChunks(comprimido, tamanho, (chunk) => {
    // Em modo de vista o bloco vale só durante a chamada; copiar aqui é o que
    // um consumidor honesto faz, e é o que prova que os bytes estão certos NA
    // hora em que chegam.
    partes.push(Uint8Array.from(chunk));
  }, opcoes);
  return Buffer.concat(partes);
}

test('o codificador do teste concorda com o decodificador publicado', () => {
  // Se o fluxo que eu escrevo não for DCL de verdade, todos os casos abaixo
  // testam uma fantasia. Este é o teste do instrumento, antes dos casos.
  const fluxo = new FluxoImplode();
  for (const byte of Buffer.from('TABWIN WEB, dados publicos do DATASUS. ')) fluxo.literal(byte);
  fluxo.casamento(20, 39);
  const { comprimido, esperado } = fluxo.encerrar();
  assertBytesIguais(implodeDecompress(comprimido, esperado.length), esperado, 'decodificador publicado');
});

test('cópia longa sem sobreposição e corrida auto-referente saem iguais à referência', () => {
  const fluxo = new FluxoImplode();
  // Dicionário inicial, para que as distâncias adiante existam de fato.
  for (let i = 0; i < 400; i++) fluxo.literal(65 + (i % 26));
  // Sem sobreposição e acima do limite de 20 bytes: este é o `copyWithin`.
  fluxo.casamento(200, 300);
  // Auto-referente puro, uma corrida de um byte só. Se alguém trocar isto por
  // `copyWithin`, o resultado deixa de repetir e vira lixo — em silêncio.
  fluxo.literal(35);
  fluxo.casamento(300, 1);
  // Auto-referente de período 3, longo o bastante para passar do limite.
  fluxo.literal(1);
  fluxo.literal(2);
  fluxo.literal(3);
  fluxo.casamento(120, 3);
  // Curto e sem sobreposição: continua no laço byte a byte.
  fluxo.casamento(4, 50);
  const { comprimido, esperado } = fluxo.encerrar();

  // Oráculo independente: o decodificador publicado, que não é meu.
  assertBytesIguais(implodeDecompress(comprimido, esperado.length), esperado, 'decodificador publicado');
  assertBytesIguais(decodificar(comprimido, esperado.length), esperado, 'caminho rápido');
  assertBytesIguais(decodificar(comprimido, esperado.length, { forceSlowPath: true }), esperado, 'caminho lento');
});

test('a vista da janela entrega os mesmos bytes que a cópia, através de várias janelas', () => {
  // A vista só poderia divergir DEPOIS da primeira janela de 4 KiB, quando ela
  // passa a ser reescrita. Um caso pequeno não provaria nada.
  const fluxo = new FluxoImplode();
  const ruido = bytesSemPeriodo(10_000);
  for (let i = 0; i < 5000; i++) fluxo.literal(ruido[i]);
  fluxo.casamento(500, 4096);
  fluxo.casamento(64, 1);
  for (let i = 5000; i < 10_000; i++) fluxo.literal(ruido[i]);
  fluxo.casamento(300, 2048);
  const { comprimido, esperado } = fluxo.encerrar();
  assert.ok(esperado.length > 4096 * 2, 'o caso precisa dar a volta na janela mais de uma vez');

  assertBytesIguais(implodeDecompress(comprimido, esperado.length), esperado, 'decodificador publicado');
  assertBytesIguais(decodificar(comprimido, esperado.length), esperado, 'caminho rápido');
  assertBytesIguais(decodificar(comprimido, esperado.length, { reuseWindowBuffer: true }), esperado, 'modo de vista');
});

test('sem a opção, o bloco entregue continua sendo uma cópia que se pode guardar', () => {
  // O padrão é a cópia porque o modo de falha da vista é o pior que existe:
  // dado silenciosamente errado. Quem guardar o bloco sem pedir a vista tem
  // que continuar certo.
  const fluxo = new FluxoImplode();
  for (const byte of bytesSemPeriodo(9000)) fluxo.literal(byte);
  const { comprimido, esperado } = fluxo.encerrar();

  const guardados = [];
  implodeDecompressChunks(comprimido, esperado.length, (chunk) => guardados.push(chunk));
  assert.ok(guardados.length > 2, 'precisa de mais de uma janela para a pergunta fazer sentido');
  assertBytesIguais(Buffer.concat(guardados), esperado, 'blocos guardados até o fim');

  const vistas = [];
  implodeDecompressChunks(comprimido, esperado.length, (chunk) => vistas.push(chunk), { reuseWindowBuffer: true });
  assert.ok(
    vistas[0].buffer === vistas[1].buffer,
    'em modo de vista os blocos compartilham a mesma janela — é isso que o nome promete',
  );
});
