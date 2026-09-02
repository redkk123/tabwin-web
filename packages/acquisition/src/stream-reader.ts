/**
 * Leitura de corpo HTTP com prazo de OCIOSIDADE, não de duração.
 *
 * Terceira vez que este projeto tropeça no mesmo erro, em três camadas
 * diferentes: o proxy cortava o corpo em 180 s, a interface abortava o fluxo
 * inteiro em 120 s, e o caminho de quatro faixas materializava cada parte com
 * `arrayBuffer()` — então o vigia de 90 s só era renovado quando uma parte
 * INTEIRA terminava. A 0,8 MB/s agregados, cada faixa de 30 MB leva uns 152 s,
 * e o vigia matava um download que estava recebendo bytes o tempo todo.
 *
 * A lição, agora escrita num lugar só: o que distingue "travado" de "lento" é
 * silêncio, e silêncio só se mede enquanto se está esperando. Aqui o relógio é
 * armado imediatamente antes de cada `read()` e desarmado assim que ele
 * responde. Enquanto chegam pedaços, por menores que sejam, o prazo nunca
 * vence.
 *
 * E o relógio mede SÓ a rede. SHA-256, IndexedDB, extração do ZIP e montagem
 * dos registros não passam por aqui — medir CPU com relógio de rede foi o que
 * permitiu a interface abortar um controlador que nenhuma dessas etapas
 * observa, e ainda assim terminar como sucesso.
 */

/** Silêncio da origem além do tolerado. Distinto de cancelamento humano. */
export class StreamIdleTimeoutError extends Error {
  readonly idleMs: number;
  constructor(idleMs: number) {
    super(`A origem parou de enviar dados por ${Math.round(idleMs / 1000)} segundos`);
    this.name = 'StreamIdleTimeoutError';
    this.idleMs = idleMs;
  }
}

/** Prazo padrão de silêncio numa leitura de rede. */
export const DEFAULT_READ_IDLE_MS = 90_000;

/** Prazo para a resposta CHEGAR, antes de haver corpo para medir ociosidade. */
export const DEFAULT_HEADER_TIMEOUT_MS = 30_000;

/** O servidor aceitou a conexão e não mandou a resposta. */
export class HeaderTimeoutError extends Error {
  readonly headerMs: number;
  constructor(headerMs: number) {
    super(`O servidor não respondeu em ${Math.round(headerMs / 1000)} segundos`);
    this.name = 'HeaderTimeoutError';
    this.headerMs = headerMs;
  }
}

/**
 * `fetch` com prazo para os CABEÇALHOS, não para o corpo.
 *
 * O relógio de ociosidade só começa a valer quando existe um corpo para ler.
 * Antes disso havia um buraco apontado por auditoria externa: um servidor que
 * aceita a conexão e nunca responde deixava a promessa pendente para sempre.
 * Na interface o vigia de parada acabava pegando, mas por acidente — e o
 * transporte é quem deve ser dono do prazo de rede.
 *
 * O relógio é desarmado assim que a resposta chega. Deixá-lo armado abortaria
 * o corpo no meio, que é justamente o defeito que este projeto já cometeu em
 * três camadas diferentes.
 */
export async function fetchWithHeaderTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: { headerMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const headerMs = options.headerMs ?? DEFAULT_HEADER_TIMEOUT_MS;
  if (!Number.isFinite(headerMs) || headerMs <= 0) {
    throw new Error(`Prazo de cabeçalho precisa ser positivo, recebeu ${headerMs}`);
  }
  const local = new AbortController();
  let expirou = false;
  let dispararPrazo: (erro: Error) => void = () => {};
  // Corrida em vez de confiar só no abort. Um `fetch` que ignora o sinal
  // deixaria a promessa pendente para sempre, e o prazo existe justamente
  // para que nada fique pendente para sempre. O abort continua sendo enviado,
  // porque libera a conexão do outro lado.
  const prazo = new Promise<never>((_resolve, reject) => { dispararPrazo = reject; });
  const timer = setTimeout(() => {
    expirou = true;
    local.abort(new HeaderTimeoutError(headerMs));
    dispararPrazo(new HeaderTimeoutError(headerMs));
  }, headerMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, local.signal])
    : local.signal;
  try {
    return await Promise.race([fetchImpl(url, { ...init, signal }), prazo]);
  } catch (error) {
    // Distinguir "eu cortei por prazo" de "o usuário cancelou" importa: a
    // primeira é transitória e merece nova tentativa, a segunda não.
    if (expirou) throw new HeaderTimeoutError(headerMs);
    throw error;
  } finally {
    clearTimeout(timer);
    // Sem isto, uma promessa de prazo que nunca é observada vira rejeição não
    // tratada quando o `fetch` ganha a corrida.
    prazo.catch(() => {});
  }
}

export interface ReadStreamOptions {
  idleMs?: number;
  /** Recebe cada pedaço na ordem em que chega. Pode lançar para interromper. */
  onChunk: (chunk: Uint8Array) => void;
  /** Cancelamento externo — humano ou do grupo de faixas. */
  signal?: AbortSignal;
  /** Injetáveis para o teste controlar o tempo sem esperar de verdade. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Consome o corpo inteiro, pedaço a pedaço, e devolve quantos bytes leu.
 *
 * Lança `StreamIdleTimeoutError` quando a origem cala além do prazo, e
 * propaga o erro de cancelamento quando o sinal externo dispara. São coisas
 * diferentes e a interface precisa poder dizer qual foi: uma é problema do
 * servidor, a outra foi o usuário clicando em cancelar.
 */
export async function readStreamWithIdleTimeout(
  body: ReadableStream<Uint8Array>,
  options: ReadStreamOptions,
): Promise<number> {
  const idleMs = options.idleMs ?? DEFAULT_READ_IDLE_MS;
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new Error(`Prazo de ociosidade precisa ser positivo, recebeu ${idleMs}`);
  }
  const setTimer = options.setTimer
    ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer = options.clearTimer
    ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  const reader = body.getReader();
  let received = 0;
  let ocioso: unknown = null;
  let expirou = false;

  const cancelarPorSinal = (): void => {
    void reader.cancel(options.signal?.reason ?? new Error('cancelado'));
  };
  options.signal?.addEventListener('abort', cancelarPorSinal, { once: true });

  try {
    for (;;) {
      options.signal?.throwIfAborted();
      // O relógio existe apenas enquanto há uma leitura pendente. Fora daqui
      // não há o que medir: ninguém está esperando a rede.
      expirou = false;
      ocioso = setTimer(() => {
        expirou = true;
        void reader.cancel(new StreamIdleTimeoutError(idleMs));
      }, idleMs);
      let leitura: ReadableStreamReadResult<Uint8Array>;
      try {
        leitura = await reader.read();
      } finally {
        clearTimer(ocioso);
        ocioso = null;
      }
      // `cancel()` faz a leitura pendente resolver com `done`, sem erro. Sem
      // esta checagem um fluxo travado terminaria como sucesso truncado.
      if (expirou) throw new StreamIdleTimeoutError(idleMs);
      if (leitura.done) break;
      const chunk = leitura.value;
      if (!chunk || chunk.byteLength === 0) continue;
      received += chunk.byteLength;
      options.onChunk(chunk);
    }
    options.signal?.throwIfAborted();
    return received;
  } finally {
    if (ocioso !== null) clearTimer(ocioso);
    options.signal?.removeEventListener('abort', cancelarPorSinal);
    reader.releaseLock();
  }
}
