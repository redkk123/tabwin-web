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
  /**
   * Identidade da representação, de `readRepresentationTag`. Vai em
   * `If-Range` para o servidor recusar servir faixa de um arquivo diferente
   * daquele que a sondagem viu.
   */
  representationTag?: string;
  /** Tentativas por faixa, contando a primeira. Padrão 3. */
  attemptsPerRange?: number;
  /** Injetável para o teste não gastar o tempo de parede da espera. */
  sleep?: (ms: number) => Promise<void>;
  /** Injetável para o teste não depender do jitter aleatório. */
  random?: () => number;
  onProgress?: (progress: RangedDownloadProgress) => void;
}

/**
 * Baixa todas as faixas em paralelo, escrevendo direto no buffer final.
 *
 * Três invariantes que os testes exigem, e que existem por motivo:
 *
 * 1. Uma faixa que ESGOTA as tentativas aborta as irmãs antes de propagar o
 *    erro. Sem isso, o chamador começa o download integral enquanto as
 *    requisições antigas ainda disputam a mesma banda — e a rota do usuário já
 *    é o gargalo. Uma falha isolada, porém, não chega aqui: a faixa se refaz
 *    sozinha, com espera crescente, em vez de derrubar o que as irmãs já
 *    trouxeram.
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

  const attempts = Math.max(1, options.attemptsPerRange ?? 3);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  /**
   * Espera antes de refazer uma faixa: crescente, com jitter.
   *
   * Sem o jitter, duas faixas que falham juntas — que é o caso comum, porque
   * costumam falhar pelo mesmo motivo — voltariam no mesmo instante e
   * repetiriam a colisão.
   */
  const backoff = (tentativa: number): number =>
    Math.round(300 * 2 ** (tentativa - 1) * (0.5 + random()));

  const baixarFaixa = async (range: ByteRange, contabilizar: (bytes: number) => void): Promise<void> => {
    // Prazo para a resposta CHEGAR. O relógio de ociosidade só passa a valer
    // quando existe corpo para ler; sem este, um servidor que aceita a conexão
    // e nunca responde deixaria a faixa pendente para sempre.
    const response = await fetchWithHeaderTimeout(fetchImpl, url, {
      headers: {
        Range: rangeHeaderValue(range),
        // Com `If-Range`, o servidor devolve 206 se a representação é a mesma
        // que a sondagem viu, e 200 com o arquivo inteiro se ela mudou. Sem
        // isto, só o tamanho total separava um arquivo do outro — e o DATASUS
        // monta um zip novo a cada `/prepare`, então dois pacotes do mesmo
        // arquivo têm exatamente o mesmo tamanho.
        ...(options.representationTag ? { 'If-Range': options.representationTag } : {}),
      },
    }, { signal: partSignal, ...(options.headerMs === undefined ? {} : { headerMs: options.headerMs }) });

    // 200 onde se pediu faixa, tendo mandado `If-Range`, não é "não suporta
    // Range": a sondagem já provou que suporta. É o servidor dizendo que o
    // arquivo mudou, e a mensagem precisa dizer isso, não outra coisa.
    if (options.representationTag && response.status === 200) {
      await response.body?.cancel();
      throw new Error(
        `parte ${range.start}-${range.end}: o arquivo mudou no servidor durante o download`,
      );
    }

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
      // A tentativa contabiliza o que ELA trouxe, para devolver ao total se
      // falhar no meio. Sem isso, a retentativa somaria os mesmos bytes duas
      // vezes e o progresso passaria de 100%.
      contabilizar(chunkBytes);
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
  };

  const pending = ranges.map(async (range) => {
    // A faixa é a unidade natural de retentativa: idempotente, escreve num
    // intervalo que só ela toca, e o `writer` recusa parte curta. Refazer uma
    // nunca corrompe as outras — e evita jogar fora o que já chegou nas irmãs.
    let ultimoErro: unknown;
    for (let tentativa = 1; tentativa <= attempts; tentativa++) {
      try {
        let daTentativa = 0;
        try {
          await baixarFaixa(range, (bytes) => { daTentativa += bytes; });
          return;
        } catch (error) {
          // Os bytes desta tentativa saem da conta: mantê-los faria o
          // progresso passar de 100% e, pior, mentir sobre o que chegou.
          receivedBytes -= daTentativa;
          options.onProgress?.({ receivedBytes, totalBytes });
          throw error;
        }
      } catch (error) {
        // Cancelamento do usuário e arquivo trocado no servidor não melhoram
        // com insistência: o primeiro é uma decisão, o segundo é definitivo.
        if (partSignal.aborted) throw error;
        if (error instanceof Error && /mudou no servidor|total mudou/.test(error.message)) throw error;
        ultimoErro = error;
        if (tentativa < attempts) await sleep(backoff(tentativa));
      }
    }
    throw ultimoErro;
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
