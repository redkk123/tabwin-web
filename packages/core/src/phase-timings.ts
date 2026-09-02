/**
 * Cronômetro por fase, para o programa saber dizer onde o tempo foi.
 *
 * Existe porque "demorou" não é um diagnóstico. Um arquivo do DATASUS passa
 * por etapas de custo muito diferente — o portal montando o pacote, a rede, a
 * descompressão, a tabulação — e cada uma se conserta de um jeito. Sem a
 * separação, otimiza-se no escuro; com ela, dá para comparar com outra
 * ferramenta fase a fase, em vez de número contra número.
 *
 * Guarda soma e contagem por fase: um lote de arquivos repete as mesmas
 * etapas, e o que interessa é o total gasto em cada uma.
 */

export interface PhaseSample {
  phase: string;
  totalMs: number;
  count: number;
}

export interface PhaseTimings {
  /** Mede a duração de `run` e credita à fase. Erros também são creditados. */
  measure<T>(phase: string, run: () => Promise<T>): Promise<T>;
  /** Credita uma duração já medida, para trechos que não cabem num callback. */
  add(phase: string, ms: number): void;
  /** As fases na ordem em que apareceram, que é a ordem em que aconteceram. */
  samples(): PhaseSample[];
  reset(): void;
}

export function createPhaseTimings(now: () => number = () => performance.now()): PhaseTimings {
  // Map preserva a ordem de inserção, que aqui é a ordem cronológica — e é
  // como a pessoa espera ler um relatório de etapas.
  const totals = new Map<string, { totalMs: number; count: number }>();

  const add = (phase: string, ms: number): void => {
    if (!Number.isFinite(ms) || ms < 0) return;
    const atual = totals.get(phase) ?? { totalMs: 0, count: 0 };
    atual.totalMs += ms;
    atual.count += 1;
    totals.set(phase, atual);
  };

  return {
    add,
    async measure(phase, run) {
      const inicio = now();
      try {
        return await run();
      } finally {
        // No `finally` de propósito: uma fase que falhou consumiu tempo, e
        // esconder isso faria o relatório de uma falha não fechar a conta.
        add(phase, now() - inicio);
      }
    },
    samples() {
      return [...totals].map(([phase, { totalMs, count }]) => ({ phase, totalMs, count }));
    },
    reset() {
      totals.clear();
    },
  };
}

/** Uma linha legível por fase, com a fatia de cada uma sobre o total. */
export function describePhaseTimings(samples: readonly PhaseSample[]): string[] {
  const total = samples.reduce((soma, { totalMs }) => soma + totalMs, 0);
  if (total <= 0) return [];
  return samples.map(({ phase, totalMs, count }) => {
    const fatia = Math.round(totalMs / total * 100);
    const vezes = count > 1 ? ` · ${count}x` : '';
    return `${phase}: ${(totalMs / 1000).toFixed(2)}s (${fatia}%${vezes})`;
  });
}
