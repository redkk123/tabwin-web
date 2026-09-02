/**
 * Lembrar o que o catálogo oficial já respondeu — inclusive quando a resposta
 * foi "não existe".
 *
 * A busca de uma série longa faz uma consulta por combinação. No caso real
 * medido, 48 consultas para trazer 30 arquivos: 17 viagens completas ao
 * servidor existiram apenas para descobrir que um arquivo de 1981 não foi
 * publicado. E na busca seguinte tudo se repete, porque nada era lembrado.
 *
 * Guardar só o que existe resolve metade do problema. A metade cara é a outra:
 * um arquivo de 1996 não vai deixar de ter sido publicado, e perguntar de novo
 * é gastar latência para confirmar o passado.
 *
 * O que este módulo NÃO faz é decidir sozinho que algo não existe. Ele guarda
 * uma resposta que o DATASUS deu, com a data em que deu, e um prazo de
 * validade que depende de quão assentado é aquele período. A interface precisa
 * mostrar essa data: "não encontrado" lembrado é diferente de "não encontrado"
 * perguntado agora, e o usuário tem direito de saber qual dos dois está vendo.
 */

import type { DatasusSearchQuery } from './datasus.js';

export type CatalogAnswer = 'found' | 'missing';

export interface RememberedCatalogAnswer {
  answer: CatalogAnswer;
  /** Quando o DATASUS respondeu isso, em epoch ms. */
  checkedAt: number;
  /** Nomes e endereços encontrados; vazio quando a resposta foi "não existe". */
  files: ReadonlyArray<{ name: string; address: string; source: string; modality: string }>;
}

/** Chave estável de uma combinação. A ordem dos campos não pode variar. */
export function catalogQueryKey(query: DatasusSearchQuery): string {
  return [
    query.system,
    query.fileType,
    query.year ?? '',
    query.month ?? '',
    query.uf ?? '',
  ].join('|');
}

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/**
 * Por quanto tempo vale a resposta lembrada, conforme o período consultado.
 *
 * O ano corrente ainda recebe carga: o que não existe hoje pode existir
 * semana que vem, então o prazo é curto. O ano anterior ainda sofre revisão e
 * republicação. Um ano de duas décadas atrás está fechado — e é justamente
 * ele que aparece dezenas de vezes numa busca de série histórica.
 *
 * O prazo de "encontrado" é mais longo que o de "não encontrado" pelo mesmo
 * motivo assimétrico: um arquivo publicado raramente é despublicado, mas um
 * arquivo ausente pode ser publicado a qualquer momento.
 */
export function catalogAnswerTtlMs(
  answer: CatalogAnswer,
  year: string | undefined,
  now: number = Date.now(),
): number {
  const anoConsultado = Number(year);
  if (!Number.isInteger(anoConsultado) || anoConsultado < 1900) {
    // Sem ano identificável não dá para dizer se está assentado. O prazo curto
    // é a escolha que erra para o lado de perguntar de novo.
    return answer === 'found' ? DIA : 6 * HORA;
  }
  const anoAtual = new Date(now).getUTCFullYear();
  const idade = anoAtual - anoConsultado;
  if (idade <= 0) return answer === 'found' ? 12 * HORA : 6 * HORA;
  if (idade === 1) return answer === 'found' ? 7 * DIA : 2 * DIA;
  if (idade <= 3) return answer === 'found' ? 30 * DIA : 14 * DIA;
  return answer === 'found' ? 180 * DIA : 90 * DIA;
}

/** Se a resposta lembrada ainda vale. */
export function catalogAnswerIsFresh(
  remembered: RememberedCatalogAnswer,
  query: DatasusSearchQuery,
  now: number = Date.now(),
): boolean {
  // Data no futuro significa relógio mexido ou registro corrompido; nesse caso
  // a resposta lembrada não pode ser usada.
  if (!Number.isFinite(remembered.checkedAt) || remembered.checkedAt > now) return false;
  return now - remembered.checkedAt < catalogAnswerTtlMs(remembered.answer, query.year, now);
}

export interface CatalogPlan<T> {
  /** Combinações que precisam ir ao DATASUS. */
  toFetch: T[];
  /** Combinações já respondidas, com a data da resposta. */
  remembered: Array<{ query: T; remembered: RememberedCatalogAnswer }>;
}

/**
 * Separa o que ainda precisa ser perguntado do que já se sabe.
 *
 * Devolver os dois lados, em vez de só a lista a buscar, é o que permite a
 * interface dizer quantas viagens foram evitadas e quando cada resposta foi
 * obtida.
 */
export function planCatalogLookups<T extends DatasusSearchQuery>(
  queries: readonly T[],
  memory: ReadonlyMap<string, RememberedCatalogAnswer>,
  now: number = Date.now(),
): CatalogPlan<T> {
  const toFetch: T[] = [];
  const remembered: Array<{ query: T; remembered: RememberedCatalogAnswer }> = [];
  for (const query of queries) {
    const guardado = memory.get(catalogQueryKey(query));
    if (guardado && catalogAnswerIsFresh(guardado, query, now)) {
      remembered.push({ query, remembered: guardado });
    } else {
      toFetch.push(query);
    }
  }
  return { toFetch, remembered };
}

/** Texto honesto sobre o que veio da memória, para a interface não omitir. */
export function describeCatalogMemory(usadas: number, total: number): string {
  if (!usadas) return '';
  const quando = usadas === total ? 'Todas as' : `${usadas} das ${total}`;
  return `${quando} combinações vieram de consultas anteriores ao catálogo oficial,`
    + ' guardadas neste aparelho. Use "Consultar de novo" para ignorar o que está guardado.';
}
