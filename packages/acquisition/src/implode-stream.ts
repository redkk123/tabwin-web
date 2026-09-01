/**
 * Bounded-output PKWARE DCL Implode decoder for DATASUS DBC records.
 *
 * Algorithm adapted from @precisa-saude/datasus-dbc (Apache-2.0), itself a
 * TypeScript port of Mark Adler's blast.c. Unlike that package's materialized
 * API, this implementation emits the 4 KiB sliding window as it fills and never
 * allocates an output buffer proportional to the decoded file size.
 *
 * Por padrão cada janela sai como CÓPIA, que o consumidor pode guardar; quem
 * consome na hora pode pedir a vista com `reuseWindowBuffer` e economizar a
 * cópia. Ver a opção para o que isso exige de quem recebe.
 */

const MAX_BITS = 13;
const WINDOW_SIZE = 4096;
const END_CODE = 519;
const DEFAULT_MAX_STREAMED_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * A partir de quantos bytes vale chamar `copyWithin` em vez de copiar na mão.
 *
 * Medido nesta máquina, copiando dentro de uma janela de 4 KiB: 2 bytes 0,37x
 * (a chamada custa mais que o laço), 16 bytes 0,90x, 24 bytes 1,76x, 64 bytes
 * 4,2x, 256 bytes 16,5x. O ponto de virada fica em torno de 20.
 */
const NATIVE_COPY_MIN_BYTES = 20;

const LITERAL_LENGTHS = [
  11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8,
  23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11,
  8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253,
  253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173,
] as const;
const RUN_LENGTHS = [2, 35, 36, 53, 38, 23] as const;
const DISTANCE_LENGTHS = [2, 20, 53, 230, 247, 151, 248] as const;
const BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264] as const;
const EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

interface HuffmanTable {
  count: Int32Array;
  symbol: Int32Array;
}

function construct(encodedLengths: readonly number[]): HuffmanTable {
  const lengths = new Array<number>(256);
  let symbolCount = 0;
  for (const encoded of encodedLengths) {
    const length = encoded & 15;
    let repeats = (encoded >> 4) + 1;
    while (repeats-- > 0) lengths[symbolCount++] = length;
  }
  const count = new Array<number>(MAX_BITS + 1).fill(0);
  const symbols = new Array<number>(symbolCount);
  for (let symbol = 0; symbol < symbolCount; symbol++) count[lengths[symbol]!]!++;
  let left = 1;
  for (let length = 1; length <= MAX_BITS; length++) {
    left = (left << 1) - count[length]!;
    if (left < 0) throw new Error(`DCL Implode: conjunto Huffman sobrescrito no comprimento ${length}`);
  }
  const offsets = new Array<number>(MAX_BITS + 1).fill(0);
  for (let length = 1; length < MAX_BITS; length++) offsets[length + 1] = offsets[length]! + count[length]!;
  for (let symbol = 0; symbol < symbolCount; symbol++) {
    const length = lengths[symbol]!;
    if (length) symbols[offsets[length]!] = symbol, offsets[length]!++;
  }
  // Typed arrays: estas duas tabelas são lidas A CADA BIT do fluxo. Com
  // Array comum, o motor precisa checar tipo e buraco em cada acesso; com
  // Int32Array ele sabe o formato de antemão.
  return { count: Int32Array.from(count), symbol: Int32Array.from(symbols) };
}

/**
 * Quantos bits a tabela rápida resolve de uma vez.
 *
 * Nove cobre a esmagadora maioria dos símbolos do DCL num acesso só. Subir
 * dobra a memória da tabela a cada bit e rende cada vez menos; descer joga
 * mais símbolos no caminho lento.
 */
const FAST_BITS = 9;
const FAST_SIZE = 1 << FAST_BITS;

interface FastHuffmanTable extends HuffmanTable {
  /** Símbolo para cada padrão de `FAST_BITS` bits, ou -1 quando não resolve. */
  fastSymbol: Int32Array;
  /** Quantos bits consumir naquele acerto. */
  fastLength: Int32Array;
}

/**
 * Caminha a árvore canônica bit a bit, exatamente como `decode` faz.
 *
 * Existe só para alimentar a tabela rápida. É a MESMA lógica do caminho lento,
 * escrita uma vez aqui — por isso a tabela não pode divergir dele: ela é
 * literalmente a resposta que ele daria.
 */
function walkCanonical(table: HuffmanTable, pattern: number, available: number): { symbol: number; length: number } | null {
  let code = 0;
  let first = 0;
  let index = 0;
  let nextIndex = 1;
  for (let length = 1; length <= available; length++) {
    code |= ((pattern >> (length - 1)) & 1) ^ 1;
    const count = table.count[nextIndex++]!;
    if (code < first + count) {
      return { symbol: table.symbol[index + code - first]!, length };
    }
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  return null;
}

/**
 * Tabela indexada pelos próximos `FAST_BITS` bits.
 *
 * A ideia é a mesma do `inflate_fast` do zlib: em vez de descer a árvore um
 * bit por vez — e a descompressão DCL era 95% do tempo de abrir um arquivo —,
 * olha vários bits de uma vez e resolve o símbolo num acesso.
 *
 * A tabela é construída EXECUTANDO o percurso canônico sobre todos os padrões
 * possíveis, em vez de re-derivar os códigos. Assim ela não pode discordar do
 * caminho lento: ela é o que o caminho lento responderia. Padrões que exigem
 * mais bits ficam com -1 e caem no caminho lento, que continua ali intacto.
 */
function withFastTable(table: HuffmanTable): FastHuffmanTable {
  const fastSymbol = new Int32Array(FAST_SIZE).fill(-1);
  const fastLength = new Int32Array(FAST_SIZE);
  for (let pattern = 0; pattern < FAST_SIZE; pattern++) {
    const hit = walkCanonical(table, pattern, FAST_BITS);
    if (!hit) continue;
    fastSymbol[pattern] = hit.symbol;
    fastLength[pattern] = hit.length;
  }
  return { ...table, fastSymbol, fastLength };
}

const LITERAL_CODE = withFastTable(construct(LITERAL_LENGTHS));
const RUN_CODE = withFastTable(construct(RUN_LENGTHS));
const DISTANCE_CODE = withFastTable(construct(DISTANCE_LENGTHS));

/**
 * As tabelas, expostas para o teste conferir contra o percurso da árvore.
 *
 * Elas são construídas a partir do caminho lento, então a igualdade é por
 * construção — e é exatamente por isso que vale conferir: "por construção" já
 * deu errado neste projeto antes.
 */
export const __huffmanTablesForTest = {
  literal: LITERAL_CODE,
  run: RUN_CODE,
  distance: DISTANCE_CODE,
} as const;

export interface ImplodeStreamOptions {
  maxOutputBytes?: number;
  /** DBC record streams may omit their declared final DBF EOF byte (0x1a). */
  allowMissingFinalByte?: boolean;
  /**
   * Desliga a tabela rápida, forçando todo símbolo pelo percurso bit a bit.
   *
   * Existe para o teste poder exercitar o caminho lento sobre dados reais. Ele
   * ficou sem cobertura uma vez e o defeito só apareceu em uso: a tabela
   * rápida resolvia quase tudo, então o caminho lento raramente rodava — e
   * quando rodava, saía de alinhamento.
   */
  forceSlowPath?: boolean;
  /**
   * Entrega o bloco como VISTA da janela interna, em vez de uma cópia.
   *
   * A cópia de 4 KiB por janela custava 19% do tempo de descompressão (medido
   * em perfil sobre SPAC2401) e não servia a ninguém que consome o bloco na
   * hora. Com a vista, quem recebe precisa ter terminado com os bytes ANTES de
   * devolver: a janela é reescrita na sequência.
   *
   * Fica desligado por padrão porque o modo de falha é o pior que existe —
   * dado silenciosamente errado, e só em arquivo grande o bastante para dar a
   * volta na janela. Quem liga precisa saber que consome na hora.
   */
  reuseWindowBuffer?: boolean;
}

export type ImplodeChunkConsumer = (chunk: Uint8Array, decodedOffset: number) => void;

class ImplodeStreamDecoder {
  private inputOffset = 0;
  private bitBuffer = 0;
  private bitCount = 0;
  private readonly window = new Uint8Array(WINDOW_SIZE);
  private next = 0;
  private firstWindow = true;
  private produced = 0;

  constructor(
    private readonly compressed: Uint8Array,
    private readonly expectedLength: number,
    private readonly consume: ImplodeChunkConsumer,
    private readonly allowMissingFinalByte: boolean,
    private readonly forceSlowPath = false,
    private readonly reuseWindowBuffer = false,
  ) {}

  private inputByte(): number {
    const value = this.compressed[this.inputOffset++];
    if (value === undefined) throw new Error('DCL Implode: fluxo comprimido terminou inesperadamente');
    return value;
  }

  private bits(needed: number): number {
    let value = this.bitBuffer;
    while (this.bitCount < needed) {
      value |= this.inputByte() << this.bitCount;
      this.bitCount += 8;
    }
    this.bitBuffer = value >> needed;
    this.bitCount -= needed;
    return value & ((1 << needed) - 1);
  }

  /**
   * Enche o buffer de bits sem consumir, para a tabela rápida poder espiar.
   *
   * Devolve quantos bits estão disponíveis. Perto do fim do fluxo pode haver
   * menos que o pedido, e aí o caminho lento assume — ele é quem sabe tratar
   * o fim do arquivo.
   */
  private peekBits(wanted: number): number {
    while (this.bitCount < wanted) {
      const value = this.compressed[this.inputOffset];
      if (value === undefined) return this.bitCount;
      this.inputOffset++;
      this.bitBuffer |= value << this.bitCount;
      this.bitCount += 8;
    }
    return this.bitCount;
  }

  private decode(table: FastHuffmanTable): number {
    // Caminho rápido: um acesso resolve o símbolo, em vez de descer a árvore
    // um bit por vez. A tabela foi construída a partir do caminho lento
    // abaixo, então as duas respostas são a mesma por construção.
    if (!this.forceSlowPath && this.peekBits(FAST_BITS) >= FAST_BITS) {
      const pattern = this.bitBuffer & (FAST_SIZE - 1);
      const symbol = table.fastSymbol[pattern]!;
      if (symbol >= 0) {
        const length = table.fastLength[pattern]!;
        this.bitBuffer >>>= length;
        this.bitCount -= length;
        return symbol;
      }
    }
    return this.decodeSlow(table);
  }

  /** O percurso canônico bit a bit. Continua sendo a referência. */
  /**
   * Percurso canônico bit a bit. É a referência de correção.
   *
   * Foi reescrito por causa de um defeito real: a versão herdada do `blast.c`
   * terminava com `this.bitCount = (this.bitCount - length) & 7`, o que só
   * está certo se o buffer tem menos de 8 bits na entrada — premissa que valia
   * quando só `bits()` o enchia. Com a tabela rápida espiando 9 bits, o buffer
   * pode chegar aqui com até 15, e o `& 7` PERDIA a contagem: o fluxo saía de
   * alinhamento e o arquivo falhava no meio da leitura.
   *
   * Esta versão não faz suposição sobre quantos bits há no buffer. Consome um
   * bit por vez e pede byte só quando acaba.
   */
  private decodeSlow(table: HuffmanTable): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length <= MAX_BITS; length++) {
      if (this.bitCount === 0) {
        this.bitBuffer = this.inputByte();
        this.bitCount = 8;
      }
      code |= (this.bitBuffer & 1) ^ 1;
      this.bitBuffer >>>= 1;
      this.bitCount--;

      const count = table.count[length]!;
      if (code < first + count) return table.symbol[index + code - first]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    return -9;
  }

  private flush(): void {
    if (!this.next) return;
    if (this.produced + this.next > this.expectedLength) throw new Error('DCL Implode: saída excedeu o tamanho declarado');
    const length = this.next;
    const chunk = this.reuseWindowBuffer
      ? this.window.subarray(0, length)
      : this.window.slice(0, length);
    this.consume(chunk, this.produced);
    this.produced += length;
    this.next = 0;
    this.firstWindow = false;
  }

  run(): number {
    const literalMode = this.bits(8);
    if (literalMode > 1) throw new Error(`DCL Implode: indicador literal inválido ${literalMode}`);
    const dictionaryBits = this.bits(8);
    if (dictionaryBits < 4 || dictionaryBits > 6) throw new Error(`DCL Implode: dicionário inválido ${dictionaryBits}`);
    while (true) {
      if (this.bits(1)) {
        const lengthSymbol = this.decode(RUN_CODE);
        if (lengthSymbol < 0) throw new Error('DCL Implode: código de comprimento inválido');
        let length = BASE[lengthSymbol]! + this.bits(EXTRA[lengthSymbol]!);
        if (length === END_CODE) break;
        const distanceShift = length === 2 ? 2 : dictionaryBits;
        const distanceSymbol = this.decode(DISTANCE_CODE);
        if (distanceSymbol < 0) throw new Error('DCL Implode: código de distância inválido');
        const distance = (distanceSymbol << distanceShift) + this.bits(distanceShift) + 1;
        if (this.firstWindow && distance > this.next) throw new Error(`DCL Implode: distância ${distance} excede a saída disponível`);
        do {
          let destination = this.next;
          let source = destination - distance;
          let copy = WINDOW_SIZE;
          if (this.next < distance) {
            source += copy;
            copy = distance;
          }
          copy -= this.next;
          if (copy > length) copy = length;
          length -= copy;
          this.next += copy;
          // Medido em DBC reais: 97% dos bytes de saída vêm de casamento, e só
          // 0,6% dos casamentos são auto-referentes — aqueles em que a
          // distância é menor que o comprimento e o laço precisa ler o que
          // acabou de escrever (uma corrida de espaços, por exemplo). Fora
          // desse caso isto é um memmove, e `copyWithin` copia por palavra.
          //
          // `gap <= 0` é a janela circular: a origem ficou ACIMA do destino,
          // então nenhuma escrita alcança um byte que ainda será lido.
          // `gap >= copy` é o caso sem sobreposição alguma.
          const gap = destination - source;
          if (copy >= NATIVE_COPY_MIN_BYTES && (gap <= 0 || gap >= copy)) {
            this.window.copyWithin(destination, source, source + copy);
          } else {
            do this.window[destination++] = this.window[source++]!; while (--copy);
          }
          if (this.next === WINDOW_SIZE) this.flush();
        } while (length !== 0);
      } else {
        const symbol = literalMode ? this.decode(LITERAL_CODE) : this.bits(8);
        if (symbol < 0) throw new Error('DCL Implode: código literal inválido');
        this.window[this.next++] = symbol;
        if (this.next === WINDOW_SIZE) this.flush();
      }
    }
    this.flush();
    if (this.produced !== this.expectedLength && !(this.allowMissingFinalByte && this.produced === this.expectedLength - 1)) {
      throw new Error(`DCL Implode: saída produziu ${this.produced} bytes; esperado ${this.expectedLength}`);
    }
    return this.produced;
  }
}

export function implodeDecompressChunks(
  compressed: Uint8Array,
  expectedLength: number,
  consume: ImplodeChunkConsumer,
  options: ImplodeStreamOptions = {},
): number {
  const maximum = options.maxOutputBytes ?? DEFAULT_MAX_STREAMED_OUTPUT_BYTES;
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > maximum) {
    throw new Error(`DCL Implode: tamanho de saída inválido ou acima do limite (${expectedLength})`);
  }
  return new ImplodeStreamDecoder(
    compressed,
    expectedLength,
    consume,
    options.allowMissingFinalByte ?? false,
    options.forceSlowPath ?? false,
    options.reuseWindowBuffer ?? false,
  ).run();
}
