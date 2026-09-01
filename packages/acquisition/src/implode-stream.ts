/**
 * Bounded-output PKWARE DCL Implode decoder for DATASUS DBC records.
 *
 * Algorithm adapted from @precisa-saude/datasus-dbc (Apache-2.0), itself a
 * TypeScript port of Mark Adler's blast.c. Unlike that package's materialized
 * API, this implementation emits copies of the 4 KiB sliding window and never
 * allocates an output buffer proportional to the decoded file size.
 */

const MAX_BITS = 13;
const WINDOW_SIZE = 4096;
const END_CODE = 519;
const DEFAULT_MAX_STREAMED_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;

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

const LITERAL_CODE = construct(LITERAL_LENGTHS);
const RUN_CODE = construct(RUN_LENGTHS);
const DISTANCE_CODE = construct(DISTANCE_LENGTHS);

export interface ImplodeStreamOptions {
  maxOutputBytes?: number;
  /** DBC record streams may omit their declared final DBF EOF byte (0x1a). */
  allowMissingFinalByte?: boolean;
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

  private decode(table: HuffmanTable): number {
    let bitBuffer = this.bitBuffer;
    let left = this.bitCount;
    let code = 0;
    let first = 0;
    let index = 0;
    let length = 1;
    let nextIndex = 1;
    while (true) {
      while (left-- > 0) {
        code |= (bitBuffer & 1) ^ 1;
        bitBuffer >>>= 1;
        const count = table.count[nextIndex++]!;
        if (code < first + count) {
          this.bitBuffer = bitBuffer;
          this.bitCount = (this.bitCount - length) & 7;
          return table.symbol[index + code - first]!;
        }
        index += count;
        first = (first + count) << 1;
        code <<= 1;
        length++;
      }
      left = MAX_BITS + 1 - length;
      if (left === 0) break;
      bitBuffer = this.inputByte();
      if (left > 8) left = 8;
    }
    return -9;
  }

  private flush(): void {
    if (!this.next) return;
    if (this.produced + this.next > this.expectedLength) throw new Error('DCL Implode: saída excedeu o tamanho declarado');
    const chunk = this.window.slice(0, this.next);
    this.consume(chunk, this.produced);
    this.produced += chunk.length;
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
          do this.window[destination++] = this.window[source++]!; while (--copy);
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
  return new ImplodeStreamDecoder(compressed, expectedLength, consume, options.allowMissingFinalByte ?? false).run();
}
