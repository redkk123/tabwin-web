/**
 * Espera o DATASUS terminar de montar um pacote preparado.
 *
 * O endpoint de preparo responde com o endereço do ZIP antes de terminar de
 * escrevê-lo. Quem baixa cedo demais recebe 404, ou — pior — um pacote pela
 * metade, que só se revela quebrado depois de minutos de download. Observado
 * em 2026-09-02 com DNBR2025, 108 MB: o preparo leva cerca de 11 segundos.
 *
 * Uma sondagem de dois bytes custa quase nada e transforma os dois casos em
 * espera. A sondagem nunca pode ser o motivo de um download não acontecer: se
 * ela não conclui, a função devolve e o download segue. Quem valida de verdade
 * é a checagem do ZIP completo, no fim.
 */

export const PREPARED_READY_TIMEOUT_MS = 45_000;
export const PREPARED_READY_INTERVAL_MS = 2_000;

export interface WaitForPreparedArchiveOptions {
  url: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  /** Chamado a cada espera, com os milissegundos decorridos até ali. */
  onWait?: (elapsedMs: number) => void;
  timeoutMs?: number;
  intervalMs?: number;
  /** Injetável para o teste não gastar o tempo de parede da espera real. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PreparedArchiveWait {
  /** Quantas sondagens foram feitas, incluindo a que encerrou a espera. */
  probes: number;
  /** Por que a espera terminou. */
  outcome: 'ready' | 'timed-out' | 'probe-failed';
  waitedMs: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForPreparedArchive(
  options: WaitForPreparedArchiveOptions,
): Promise<PreparedArchiveWait> {
  const {
    url, fetchImpl, signal, onWait,
    timeoutMs = PREPARED_READY_TIMEOUT_MS,
    intervalMs = PREPARED_READY_INTERVAL_MS,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  const started = now();
  const deadline = started + timeoutMs;
  let probes = 0;

  for (;;) {
    probes++;
    let status: number;
    try {
      const response = await fetchImpl(url, {
        headers: { Range: 'bytes=0-1' },
        ...(signal ? { signal } : {}),
      });
      // O corpo não interessa; soltar evita segurar a conexão aberta.
      await response.body?.cancel();
      status = response.status;
    } catch (error) {
      if (signal?.aborted) throw error;
      return { probes, outcome: 'probe-failed', waitedMs: now() - started };
    }

    // 404 é "ainda não escreveu". Qualquer outra resposta — pronta, ou com um
    // problema real — é assunto do download, que sabe relatá-lo melhor.
    if (status !== 404) return { probes, outcome: 'ready', waitedMs: now() - started };

    if (now() + intervalMs >= deadline) {
      return { probes, outcome: 'timed-out', waitedMs: now() - started };
    }
    onWait?.(now() - started);
    await sleep(intervalMs);
  }
}
