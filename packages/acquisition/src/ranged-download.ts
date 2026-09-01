/**
 * Política de download em partes paralelas.
 *
 * ## O problema
 *
 * Baixar um DBC do DATASUS é a etapa mais lenta e mais frustrante do fluxo:
 * dezenas de MB por uma conexão só, num servidor que oscila e às vezes devolve
 * 504. A decodificação, que já foi o gargalo, hoje custa segundos; o download
 * custa minutos.
 *
 * ## A ideia, e o que ela NÃO resolve
 *
 * Pedir faixas de bytes (`Range`) em paralelo pode multiplicar a banda quando o
 * limite é por conexão. Duas coisas que isso **não** melhora, e que é preciso
 * dizer para ninguém esperar demais:
 *
 * - **A descompressão continua sequencial.** O DBC é um fluxo PKWARE implode:
 *   não dá para descomprimir a segunda metade sem a primeira. Paralelizar o
 *   download não paraleliza a leitura.
 * - **Se o servidor está sobrecarregado**, mais conexões podem piorar. Por isso
 *   o número de partes é pequeno e configurável, não "quanto mais melhor".
 *
 * ## Por que tudo aqui é cauteloso
 *
 * Esta é uma otimização. Ela nunca pode ser o motivo de um download falhar.
 * Toda decisão abaixo tem um caminho de volta para o download simples, e a
 * montagem só é aceita se os bytes conferirem com o tamanho declarado.
 */

/**
 * Abaixo disto, paralelizar custa mais em requisição do que economiza.
 *
 * Medido contra o DATASUS real: um arquivo de 3,2 MB baixou em 1.172 ms por
 * uma conexão e em 2.842 ms em quatro partes — **2,4x mais lento**. O custo de
 * abrir quatro conexões domina quando há pouco byte para dividir. O limite
 * existe por causa dessa medição, não por precaução genérica.
 */
export const MIN_BYTES_FOR_RANGED_DOWNLOAD = 8 * 1024 * 1024;

/**
 * Teto de partes simultâneas.
 *
 * Medido contra o DATASUS real, com um arquivo de 25,5 MB:
 *
 * | conexão única | 4.245 ms |
 * | 2 partes      | 3.455 ms |
 * | 4 partes      | 3.397 ms |
 * | 8 partes      | 5.013 ms |
 *
 * Quatro é o ponto de melhor retorno, e **oito é pior que não paralelizar** —
 * o servidor deixa de colaborar com conexões demais. Subir este número sem
 * repetir a medição seria trocar ganho por perda.
 */
export const MAX_RANGE_PARTS = 4;

/** Nenhuma parte menor que isto, para não trocar banda por ida e volta. */
export const MIN_PART_BYTES = 2 * 1024 * 1024;

export interface ByteRange {
  /** Primeiro byte, inclusivo. */
  start: number;
  /** Último byte, inclusivo — é assim que o cabeçalho `Range` fala. */
  end: number;
}

/**
 * Divide um tamanho total em partes contíguas.
 *
 * Devolve lista vazia quando não vale a pena dividir, e o chamador entende
 * isso como "baixe do jeito simples". As partes cobrem exatamente o intervalo
 * `[0, totalBytes)`, sem furo e sem sobreposição — um furo viraria arquivo
 * corrompido que só apareceria na hora de descomprimir.
 */
export function planByteRanges(
  totalBytes: number,
  maxParts = MAX_RANGE_PARTS,
): ByteRange[] {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return [];
  if (totalBytes < MIN_BYTES_FOR_RANGED_DOWNLOAD) return [];

  const wanted = Math.max(1, Math.min(maxParts, MAX_RANGE_PARTS));
  const parts = Math.max(1, Math.min(wanted, Math.floor(totalBytes / MIN_PART_BYTES)));
  if (parts < 2) return [];

  const size = Math.ceil(totalBytes / parts);
  const ranges: ByteRange[] = [];
  for (let start = 0; start < totalBytes; start += size) {
    ranges.push({ start, end: Math.min(start + size, totalBytes) - 1 });
  }
  return ranges;
}

/** O valor do cabeçalho `Range` para uma parte. */
export function rangeHeaderValue(range: ByteRange): string {
  return `bytes=${range.start}-${range.end}`;
}

export interface ContentRange {
  start: number;
  end: number;
  totalBytes: number;
}

/**
 * Lê o `Content-Range` que a resposta 206 traz.
 *
 * Devolve `null` para qualquer coisa fora do formato. Um cabeçalho que não dá
 * para ler é motivo para desistir da paralelização, nunca para adivinhar: o
 * palpite errado aqui monta um arquivo com bytes trocados de lugar.
 */
export function parseContentRange(value: string | null): ContentRange | null {
  if (!value) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const totalBytes = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(totalBytes)) return null;
  if (start > end || end >= totalBytes) return null;
  return { start, end, totalBytes };
}

export type RangeSupport =
  | { supported: true; totalBytes: number }
  | { supported: false; reason: string };

/**
 * Decide, a partir da resposta de uma sondagem, se dá para paralelizar.
 *
 * A sondagem pede um byte só. Uma resposta `206` com `Content-Range` coerente
 * é a única evidência aceita — `Accept-Ranges` sozinho é promessa, e há
 * servidor que promete e não cumpre.
 */
export function readRangeSupport(
  status: number,
  contentRange: string | null,
  expected: ByteRange,
): RangeSupport {
  if (status !== 206) {
    return { supported: false, reason: `o servidor respondeu ${status} em vez de 206` };
  }
  const parsed = parseContentRange(contentRange);
  if (!parsed) {
    return { supported: false, reason: 'a resposta não trouxe um Content-Range legível' };
  }
  if (parsed.start !== expected.start || parsed.end !== expected.end) {
    // Devolveu faixa diferente da pedida: não dá para confiar no resto.
    return {
      supported: false,
      reason: `o servidor devolveu bytes ${parsed.start}-${parsed.end} em vez de ${expected.start}-${expected.end}`,
    };
  }
  return { supported: true, totalBytes: parsed.totalBytes };
}

export interface AssembledPart {
  range: ByteRange;
  bytes: Uint8Array;
}

/**
 * Junta as partes na ordem, conferindo que formam exatamente o arquivo.
 *
 * Lança em vez de devolver algo parcial. Um arquivo montado errado não falha
 * na hora: ele falha depois, na descompressão, com uma mensagem que não aponta
 * para a causa — ou pior, decodifica lixo que parece dado.
 */
export function assembleRangedParts(parts: readonly AssembledPart[], totalBytes: number): Uint8Array {
  if (!parts.length) throw new Error('nenhuma parte para montar');
  const ordered = [...parts].sort((left, right) => left.range.start - right.range.start);

  let expectedStart = 0;
  for (const part of ordered) {
    if (part.range.start !== expectedStart) {
      throw new Error(`faixa fora de sequência: esperava começar em ${expectedStart}, veio ${part.range.start}`);
    }
    const declared = part.range.end - part.range.start + 1;
    if (part.bytes.byteLength !== declared) {
      throw new Error(`a parte ${part.range.start}-${part.range.end} veio com ${part.bytes.byteLength} bytes, não ${declared}`);
    }
    expectedStart = part.range.end + 1;
  }
  if (expectedStart !== totalBytes) {
    throw new Error(`as partes somam ${expectedStart} bytes, mas o arquivo tem ${totalBytes}`);
  }

  const assembled = new Uint8Array(totalBytes);
  for (const part of ordered) assembled.set(part.bytes, part.range.start);
  return assembled;
}

/** Como o arquivo foi obtido, para a interface dizer sem inventar. */
export type DownloadStrategy = 'única conexão' | 'partes paralelas';

export function describeDownloadStrategy(
  strategy: DownloadStrategy,
  parts: number,
  fallbackReason?: string,
): string {
  if (strategy === 'partes paralelas') {
    return `Baixado em ${parts} partes paralelas.`;
  }
  return fallbackReason
    ? `Baixado por uma conexão só — ${fallbackReason}.`
    : 'Baixado por uma conexão só.';
}
