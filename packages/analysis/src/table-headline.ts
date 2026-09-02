/**
 * A manchete de uma tabela: o número que se cita, e as duas categorias que
 * dominam.
 *
 * Uma tabela de contingência está certa e é ilegível de relance. Quem lê
 * epidemiologia sabe percorrê-la; quem precisa do dado para uma reunião, uma
 * matéria ou um parágrafo de introdução quer "2.537.576 nascidos vivos, 56%
 * pardos". Hoje o programa entrega o rigor e deixa a leitura por conta de quem
 * lê — e isso é lacuna de apresentação, não de cálculo.
 *
 * O que este módulo NÃO faz, de propósito: inventar denominador, anualizar,
 * comparar com outro período, ou chamar de taxa o que é proporção. Cada uma
 * dessas exige uma decisão de quem conhece o dado, e uma manchete que decide
 * por ela seria pior que manchete nenhuma.
 */

export interface HeadlineShare {
  label: string;
  value: number;
  /** Fração do total, de 0 a 1. Ausente quando o total é zero ou negativo. */
  share?: number;
}

export interface TableHeadline {
  /** Soma de todas as células, que é o número que se cita. */
  total: number;
  /** Como a medida se chama, para a manchete não dizer "total" e mentir. */
  measureLabel: string;
  /** As categorias de linha com maior peso, já ordenadas. */
  top: HeadlineShare[];
  /** Quantas categorias existem ao todo, para o "de N" da frase. */
  categories: number;
  /** Registros que entraram na conta e registros lidos, quando conhecidos. */
  recordsAccepted?: number;
  recordsSeen?: number;
}

export interface HeadlineSource {
  rows: readonly { label: string }[];
  cells: readonly (readonly number[])[];
  measureLabel?: string;
  recordsAccepted?: number;
  recordsSeen?: number;
}

const somar = (valores: readonly number[]): number =>
  valores.reduce((soma, valor) => (Number.isFinite(valor) ? soma + valor : soma), 0);

export function summarizeTable(source: HeadlineSource, topCount = 3): TableHeadline {
  const pesos = source.rows.map((row, index) => ({
    label: row.label,
    value: somar(source.cells[index] ?? []),
  }));
  const total = somar(pesos.map((peso) => peso.value));

  // Proporção só existe com total positivo. Numa medida que soma valores com
  // sinal — saldo, variação — a fração não significaria nada, e omiti-la é
  // mais honesto do que exibir um número sem sentido.
  const comFracao = total > 0;

  const top = [...pesos]
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, topCount))
    .map((peso): HeadlineShare => ({
      label: peso.label,
      value: peso.value,
      ...(comFracao ? { share: peso.value / total } : {}),
    }));

  return {
    total,
    measureLabel: source.measureLabel?.trim() || 'Total',
    top,
    categories: source.rows.length,
    ...(source.recordsAccepted !== undefined ? { recordsAccepted: source.recordsAccepted } : {}),
    ...(source.recordsSeen !== undefined ? { recordsSeen: source.recordsSeen } : {}),
  };
}

export interface HeadlineFormatters {
  integer: (value: number) => string;
  percent: (fraction: number) => string;
}

/**
 * A frase que acompanha o número grande.
 *
 * Cita a maior categoria, e a segunda só quando ela ainda pesa: abaixo de 10%
 * a segunda vira ruído e alonga a frase sem informar.
 */
export function describeHeadline(
  headline: TableHeadline,
  format: HeadlineFormatters,
): string {
  if (!headline.top.length || headline.total <= 0) {
    return `${headline.categories} categoria(s), sem valor a destacar`;
  }

  const partes = headline.top
    .filter((item, index) => index === 0 || (item.share ?? 0) >= .1)
    .slice(0, 2)
    .map((item) => (item.share === undefined
      ? item.label
      : `${format.percent(item.share)} ${item.label}`));

  const cauda = headline.categories > partes.length
    ? ` · ${format.integer(headline.categories)} categorias ao todo`
    : '';
  return `${partes.join(' · ')}${cauda}`;
}

/**
 * A linha de procedência: quantos registros entraram na conta.
 *
 * Aparece só quando algum registro foi descartado. Dizer "32.017 de 32.017"
 * seria ruído; dizer "31.104 de 32.017" é informação — e é justamente onde a
 * pessoa deve olhar duas vezes.
 */
export function describeRecordBasis(
  headline: TableHeadline,
  format: HeadlineFormatters,
): string | null {
  const { recordsAccepted, recordsSeen } = headline;
  if (recordsAccepted === undefined || recordsSeen === undefined) return null;
  if (recordsAccepted >= recordsSeen) return null;
  const descartados = recordsSeen - recordsAccepted;
  return `${format.integer(recordsAccepted)} de ${format.integer(recordsSeen)} registros`
    + ` · ${format.integer(descartados)} fora dos filtros`;
}
