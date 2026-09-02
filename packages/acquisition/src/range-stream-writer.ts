import type { ByteRange } from './ranged-download.js';

export interface RangeStreamWriteProgress {
  chunkBytes: number;
  partReceivedBytes: number;
  partExpectedBytes: number;
}

export interface RangeStreamWriter {
  push(chunk: Uint8Array): void;
  finish(): void;
  readonly receivedBytes: number;
  readonly expectedBytes: number;
}

/**
 * Escreve chunks de uma resposta Range diretamente no buffer final.
 *
 * Além de evitar `partes + montagem`, este objeto cria o ponto correto para
 * progresso: todo chunk recebido, não apenas a parte inteira materializada.
 */
export function createRangeStreamWriter(
  destination: Uint8Array,
  range: ByteRange,
  onProgress?: (progress: RangeStreamWriteProgress) => void,
): RangeStreamWriter {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
      || range.start < 0 || range.start > range.end || range.end >= destination.byteLength) {
    throw new Error(`Faixa ${range.start}-${range.end} não cabe no destino de ${destination.byteLength} bytes`);
  }

  const expectedBytes = range.end - range.start + 1;
  let receivedBytes = 0;
  let finished = false;

  return {
    push(chunk): void {
      if (finished) throw new Error(`Faixa ${range.start}-${range.end} já foi encerrada`);
      if (!(chunk instanceof Uint8Array)) throw new TypeError('Chunk Range precisa ser Uint8Array');
      if (!chunk.byteLength) return;
      if (receivedBytes + chunk.byteLength > expectedBytes) {
        throw new Error(
          `Faixa ${range.start}-${range.end} ultrapassou ${expectedBytes} bytes declarados`,
        );
      }
      destination.set(chunk, range.start + receivedBytes);
      receivedBytes += chunk.byteLength;
      onProgress?.({ chunkBytes: chunk.byteLength, partReceivedBytes: receivedBytes, partExpectedBytes: expectedBytes });
    },
    finish(): void {
      if (finished) return;
      if (receivedBytes !== expectedBytes) {
        throw new Error(
          `Faixa ${range.start}-${range.end} terminou com ${receivedBytes} de ${expectedBytes} bytes`,
        );
      }
      finished = true;
    },
    get receivedBytes(): number { return receivedBytes; },
    get expectedBytes(): number { return expectedBytes; },
  };
}

