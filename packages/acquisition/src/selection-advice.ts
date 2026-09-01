/**
 * Conselhos sobre a seleção do catálogo, antes de ela virar espera.
 *
 * Existe por um caso real: no SINASC, escolher "todas as UFs" e "todos os anos"
 * produz 868 consultas ao catálogo e centenas de downloads — quando o arquivo
 * **nacional** do mesmo ano já contém as 27 UFs, e a UF é uma coluna que se
 * filtra depois de abrir. São aproximadamente os mesmos bytes por 1/27 das
 * requisições.
 *
 * A dica sobre isso já existia na interface, mas era passiva e não impediu
 * ninguém de pegar o caminho caro. Aqui ela vira um aviso com número, ligado à
 * escolha que a pessoa acabou de fazer.
 *
 * Nada aqui decide pelo usuário: pode haver motivo para querer o arquivo
 * estadual — ele é menor, e quem só precisa de uma UF não deve baixar o país.
 * O que muda é que a escolha passa a ser informada.
 */

/** Acima disto, uma consulta ao catálogo deixa de ser instantânea e vira espera. */
export const LARGE_SELECTION_QUERIES = 200;

/** Segundos por consulta ao catálogo, medido contra o DATASUS real. */
const SECONDS_PER_QUERY = 0.35;

/** Consultas em paralelo — precisa acompanhar a concorrência do cliente. */
const QUERY_CONCURRENCY = 6;

export interface NationalFileAdvice {
  /** Quantas UFs a pessoa escolheu. */
  ufsSelected: number;
  /** Quantas consultas some ao trocar para o arquivo nacional. */
  queriesSaved: number;
  message: string;
}

/**
 * Sugere o arquivo nacional quando ele existe e a escolha por UF sai cara.
 *
 * Devolve `null` quando não há o que dizer — uma UF só, ou sistema que não
 * publica arquivo nacional. Aviso que aparece sempre vira ruído e some da
 * atenção junto com os que importam.
 */
export function adviseNationalFile(input: {
  nationalAvailable: boolean;
  selectedUfs: readonly string[];
  periods: number;
}): NationalFileAdvice | null {
  if (!input.nationalAvailable) return null;
  const ufs = input.selectedUfs.filter((uf) => uf.toUpperCase() !== 'BR');
  // Duas UFs ainda podem ser deliberado e barato. A partir de três, a conta
  // já pende claramente para o nacional.
  if (ufs.length < 3) return null;

  const periods = Math.max(1, input.periods);
  const queriesSaved = (ufs.length - 1) * periods;
  return {
    ufsSelected: ufs.length,
    queriesSaved,
    message: `O arquivo nacional já traz as ${ufs.length} UFs que você escolheu — a UF vira um `
      + 'filtro depois de abrir. São aproximadamente os mesmos dados em '
      + `${periods} download(s) em vez de ${ufs.length * periods}.`,
  };
}

export interface SelectionCost {
  queries: number;
  /** Estimativa em segundos, considerando as consultas em paralelo. */
  estimatedSeconds: number;
  /** A mesma estimativa já legível, para a interface não reformatar sozinha. */
  duration: string;
  /** Vale pedir confirmação antes de começar. */
  needsConfirmation: boolean;
  summary: string;
}

function humanDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`;
}

/**
 * O custo da seleção, em consultas e em tempo.
 *
 * A estimativa é do catálogo apenas — o download vem depois e é muito maior.
 * Dizer isso importa: alguém que aceita "2 minutos de consulta" precisa saber
 * que o download não está nesse número.
 */
export function describeSelectionCost(queries: number): SelectionCost {
  const estimatedSeconds = (queries * SECONDS_PER_QUERY) / QUERY_CONCURRENCY;
  const needsConfirmation = queries > LARGE_SELECTION_QUERIES;
  return {
    queries,
    estimatedSeconds,
    duration: humanDuration(estimatedSeconds),
    needsConfirmation,
    summary: `${queries} combinação(ões), cerca de ${humanDuration(estimatedSeconds)} só para consultar `
      + '— o download dos arquivos vem depois e demora bem mais.',
  };
}
