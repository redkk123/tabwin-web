/**
 * Vigia de parada: corta o que travou, sem punir quem está lento.
 *
 * Existe por um defeito real e caro. A abertura de um arquivo oficial armava um
 * `setTimeout` de 120 s sobre o fluxo inteiro — auxiliares, preparação,
 * download, extração e abertura. É um relógio de parede: ele mede quanto tempo
 * passou, não se alguma coisa está acontecendo. Numa conexão de 0,8 MB/s isso
 * dá um teto de cerca de 96 MB, e um arquivo nacional de 121 MB precisa de uns
 * 152 s só para chegar. O download morria sempre, e a mensagem dizia que o
 * DATASUS tinha demorado — culpando o servidor por um limite nosso.
 *
 * A distinção que importa não é "quanto tempo levou" e sim "está progredindo".
 * Aqui o relógio reinicia a cada sinal de vida: cada pedaço de bytes que chega,
 * cada etapa que termina. Só dispara quando o silêncio dura mais que o
 * permitido — que é o que "travou" quer dizer de verdade.
 *
 * É o mesmo raciocínio do relógio de ociosidade do proxy, do outro lado da
 * mesma ligação.
 */

/** Silêncio tolerado antes de considerar que travou. */
export const DEFAULT_STALL_MS = 90_000;

export interface StallWatchdog {
  /** Sinal de vida: reinicia a contagem. Barato o bastante para chamar por bloco. */
  nudge(): void;
  /** Encerra o vigia. Idempotente. */
  dispose(): void;
  /** Se ele chegou a disparar — para a interface poder dizer a verdade. */
  readonly stalled: boolean;
  /** Quanto tempo de silêncio dispara, para a mensagem não precisar adivinhar. */
  readonly idleMs: number;
}

export interface StallWatchdogOptions {
  idleMs?: number;
  onStall: () => void;
  /** Injetáveis para o teste poder controlar o tempo sem esperar de verdade. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createStallWatchdog(options: StallWatchdogOptions): StallWatchdog {
  const idleMs = options.idleMs ?? DEFAULT_STALL_MS;
  if (!Number.isFinite(idleMs) || idleMs <= 0) {
    throw new Error(`Vigia de parada exige um limite positivo, recebeu ${idleMs}`);
  }
  const setTimer = options.setTimer
    ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer = options.clearTimer
    ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let handle: unknown = null;
  let stalled = false;
  let disposed = false;

  const arm = (): void => {
    handle = setTimer(() => {
      handle = null;
      // Disparar depois de encerrado seria abortar um trabalho que já terminou.
      if (disposed) return;
      stalled = true;
      options.onStall();
    }, idleMs);
  };

  const disarm = (): void => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  arm();

  return {
    nudge(): void {
      // Depois de disparar, um sinal de vida atrasado não ressuscita o vigia:
      // o cancelamento já foi para quem estava esperando.
      if (disposed || stalled) return;
      disarm();
      arm();
    },
    dispose(): void {
      disposed = true;
      disarm();
    },
    get stalled(): boolean { return stalled; },
    get idleMs(): number { return idleMs; },
  };
}
