/**
 * A orquestração do download em faixas paralelas, fora do navegador.
 *
 * Estava dentro de `apps/web/src/datasus-client.ts`, que não é compilado para
 * `dist` e portanto não podia ser testado. O resultado é que a parte mais
 * delicada do download — quatro requisições concorrentes, uma falhando, o
 * cancelamento humano, a ordem do fallback — não tinha um único teste, e a
 * auditoria independente registrou isso como bloqueador de merge.
 *
 * Aqui a mesma lógica recebe o `fetch` por parâmetro. Um teste pode então
 * fabricar uma origem que entrega devagar, que trava, que devolve faixa curta
 * ou que muda de tamanho no meio — sem rede e em milissegundos.
 */

import { createRangeStreamWriter } from './range-stream-writer.js';
import { fetchWithHeaderTimeout, readStreamWithIdleTimeout } from './stream-reader.js';
import {
  rangeHeaderValue,
  readRangeSupport,
  type ByteRange,
} from './ranged-download.js';

export interface RangedDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface RangedDownloadOptions {
  url: string;
  ranges: readonly ByteRange[];
  totalBytes: number;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  idleMs?: number;
  /** Prazo para a resposta chegar, antes de haver corpo para medir. */
  headerMs?: number;
  onProgress?: (progress: RangedDownloadProgress) => void;
}

/**
 * Baixa todas as faixas em paralelo, escrevendo direto no buffer final.
 *
 * Três invariantes que os testes exigem, e que existem por motivo:
 *
 * 1. Uma faixa que falha aborta as IRMÃS antes de propagar o erro. Sem isso, o
 *    chamador começa o download integral enquanto três requisições antigas
 *    ainda disputam a mesma banda — e a rota do usuário já é o gargalo.
 * 2. O erro só é propagado depois de `allSettled`. Propagar antes devolve o
 *    controle a quem vai abrir outra conexão sem que as anteriores tenham
 *    terminado de morrer.
 * 3. Cancelamento humano não vira fallback. Quem clicou em cancelar não quer
 *    que o programa tente de novo por outro caminho.
 */
export async function downloadInRanges(options: RangedDownloadOptions): Promise<Uint8Array> {
  const { url, ranges, totalBytes, fetchImpl } = options;
  const archive = new Uint8Array(totalBytes);
  const groupController = new AbortController();
  const partSignal = options.signal
    ? AbortSignal.any([options.signal, groupController.signal])
    : groupController.signal;
  let receivedBytes = 0;

  const pending = ranges.map(async (range) => {
    // Prazo para a resposta CHEGAR. O relógio de ociosidade só passa a valer
    // quando existe corpo para ler; sem este, um servidor que aceita a conexão
    // e nunca responde deixaria a faixa pendente para sempre.
    const response = await fetchWithHeaderTimeout(fetchImpl, url, {
      headers: { Range: rangeHeaderValue(range) },
    }, { signal: partSignal, ...(options.headerMs === undefined ? {} : { headerMs: options.headerMs }) });
    const returned = readRangeSupport(
      response.status,
      response.headers.get('content-range'),
      range,
    );
    if (!returned.supported) {
      throw new Error(`parte ${range.start}-${range.end}: ${returned.reason}`);
    }
    // Tamanho que muda entre as faixas significa que o arquivo foi trocado no
    // servidor no meio do download. Montar as partes daria um arquivo que
    // nunca existiu.
    if (returned.totalBytes !== totalBytes) {
      throw new Error(
        `parte ${range.start}-${range.end}: total mudou de ${totalBytes} para ${returned.totalBytes}`,
      );
    }
    if (!response.body) throw new Error(`parte ${range.start}-${range.end}: resposta sem corpo`);

    const writer = createRangeStreamWriter(archive, range, ({ chunkBytes }) => {
      receivedBytes += chunkBytes;
      options.onProgress?.({ receivedBytes, totalBytes });
    });
    await readStreamWithIdleTimeout(response.body, {
      onChunk: (chunk) => writer.push(chunk),
      signal: partSignal,
      ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
    });
    // `finish` recusa parte curta: uma faixa que termina antes do declarado
    // deixaria um buraco de zeros no meio do arquivo montado.
    writer.finish();
  });

  try {
    await Promise.all(pending);
  } catch (error) {
    groupController.abort();
    await Promise.allSettled(pending);
    throw error;
  }
  return archive;
}
