/**
 * Preparar o próximo arquivo enquanto o atual baixa.
 *
 * Medido contra o DATASUS real: `/prepare` — a etapa em que o servidor monta o
 * ZIP antes de qualquer byte se mover — custou 5,1 s para um arquivo de
 * 41,9 MB. Isso não depende de banda: acontece igual numa conexão de 1 Gb e
 * numa de 0,5 MB/s. Num lote de trinta anos são dois minutos e meio de espera
 * pura, em fila, sem nada trafegando.
 *
 * Os downloads são sequenciais de propósito, porque são dezenas de megabytes e
 * paralelizá-los brigaria com o download em faixas. Mas a PREPARAÇÃO do
 * próximo pode acontecer durante o download do atual: são coisas diferentes no
 * servidor, e uma não atrapalha a outra.
 *
 * O que este módulo guarda é só a decisão de quando uma URL preparada ainda
 * serve. Ela expira, e usar uma vencida troca cinco segundos de espera por um
 * download que falha.
 */

/** Quanto tempo uma URL preparada pelo DATASUS continua utilizável. */
export const PREPARED_URL_TTL_MS = 4 * 60 * 1000;

export interface PreparedDownload {
  url: string;
  preparedAt: number;
}

/**
 * Se a URL preparada ainda vale.
 *
 * Margem incluída: uma URL que vence daqui a um segundo não serve para começar
 * um download que leva minutos. Melhor pagar a preparação de novo do que
 * descobrir no meio.
 */
export function preparedUrlIsUsable(
  prepared: PreparedDownload | undefined,
  now: number = Date.now(),
  marginMs = 30_000,
): boolean {
  if (!prepared?.url) return false;
  if (!Number.isFinite(prepared.preparedAt)) return false;
  // Data no futuro é relógio mexido; não dá para calcular validade a partir
  // dela, e assumir que vale seria assumir o pior caso em silêncio.
  if (prepared.preparedAt > now) return false;
  return now - prepared.preparedAt < PREPARED_URL_TTL_MS - marginMs;
}

/**
 * Qual item preparar em seguida, dado o que está sendo baixado agora.
 *
 * Devolve `undefined` quando não há próximo, quando o próximo já tem
 * preparação válida, ou quando já existe uma preparação em andamento — disparar
 * duas para o mesmo arquivo faz o servidor montar o ZIP duas vezes.
 */
export function nextToPrepare<T>(
  items: readonly T[],
  currentIndex: number,
  preparedOf: (item: T) => PreparedDownload | undefined,
  inFlight: ReadonlySet<number>,
  now: number = Date.now(),
): { index: number; item: T } | undefined {
  const next = currentIndex + 1;
  if (next < 0 || next >= items.length) return undefined;
  if (inFlight.has(next)) return undefined;
  const item = items[next]!;
  if (preparedUrlIsUsable(preparedOf(item), now)) return undefined;
  return { index: next, item };
}
