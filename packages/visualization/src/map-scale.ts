export type MapClassification = 'continuous' | 'equal-interval' | 'quantile' | 'manual';
export type MapPalette = 'green' | 'blue' | 'orange' | 'purple';

export interface MapClass {
  lower: number;
  upper: number;
  color: string;
}

export interface MapScale {
  min: number;
  max: number;
  classes: MapClass[];
  colorFor(value: number | undefined): string;
}

export interface MapScaleOptions {
  /**
   * Interior boundaries used only by `manual` classification. The observed
   * minimum and maximum remain the outer limits, so N breaks produce N+1
   * classes. Breaks must be finite, strictly increasing and inside [min,max].
   */
  manualBreaks?: readonly number[];
  /**
   * Lê a rampa do escuro para o claro.
   *
   * Serve para variável em que o valor alto é bom — cobertura vacinal,
   * proporção de pré-natal adequado. Sem isto a paleta pinta de escuro
   * justamente onde o indicador foi melhor, e o mapa diz o contrário do dado.
   */
  invertPalette?: boolean;
}

const RAMPS: Record<MapPalette, [string, string]> = {
  green: ['#dcefe7', '#08634f'],
  blue: ['#dcebf5', '#225ea8'],
  orange: ['#fff0d2', '#b84a12'],
  purple: ['#eee4f4', '#6a3d9a'],
};

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

/**
 * Cor de um ponto da rampa, do claro para o escuro — ou ao contrário.
 *
 * Inverter importa porque a paleta carrega um julgamento: escuro significa
 * "mais", e "mais" nem sempre é pior. Num mapa de mortalidade o escuro no
 * valor alto está certo; num de cobertura vacinal ele pinta de vermelho
 * justamente onde a vacinação foi melhor, e quem bate o olho lê o oposto do
 * que o dado diz.
 */
function rampColor(palette: MapPalette, ratio: number, inverted = false): string {
  const [claro, escuro] = RAMPS[palette];
  const [startHex, endHex] = inverted ? [escuro, claro] : [claro, escuro];
  const start = rgb(startHex);
  const end = rgb(endHex);
  const value = Math.min(1, Math.max(0, ratio));
  return `rgb(${start.map((channel, index) => Math.round(channel + ((end[index] ?? channel) - channel) * value)).join(',')})`;
}

function quantile(sorted: number[], ratio: number): number {
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const low = sorted[lower] ?? 0;
  const high = sorted[Math.min(lower + 1, sorted.length - 1)] ?? low;
  return low + (high - low) * fraction;
}

function manualThresholds(min: number, max: number, source: readonly number[] | undefined): number[] {
  if (!source?.length) throw new Error('manual map classification requires at least one break');
  const breaks = [...source];
  for (let index = 0; index < breaks.length; index++) {
    const value = breaks[index]!;
    if (!Number.isFinite(value)) throw new Error(`manual map break ${index + 1} is not finite`);
    if (value <= min || value >= max) {
      throw new Error(`manual map break ${value} must be strictly inside observed range ${min}..${max}`);
    }
    if (index > 0 && value <= breaks[index - 1]!) {
      throw new Error('manual map breaks must be strictly increasing');
    }
  }
  return [min, ...breaks, max];
}

export function createMapScale(
  source: Iterable<number>,
  classification: MapClassification,
  requestedClassCount: number,
  palette: MapPalette,
  options: MapScaleOptions = {},
): MapScale {
  const values = [...source].filter(Number.isFinite).sort((a, b) => a - b);
  const min = values[0] ?? 0;
  const max = values.at(-1) ?? min;
  const classCount = Math.min(9, Math.max(2, Math.round(requestedClassCount)));
  const thresholds = classification === 'manual'
    ? manualThresholds(min, max, options.manualBreaks)
    : Array.from({ length: classCount + 1 }, (_, index) => {
      if (classification === 'quantile') return quantile(values, index / classCount);
      return min + (max - min) * index / classCount;
    });
  const actualClassCount = Math.max(1, thresholds.length - 1);
  const classes = Array.from({ length: actualClassCount }, (_, index) => ({
    lower: thresholds[index] ?? min,
    upper: thresholds[index + 1] ?? max,
    color: rampColor(palette, actualClassCount === 1 ? 1 : index / (actualClassCount - 1), options.invertPalette),
  }));
  return {
    min,
    max,
    classes,
    colorFor(value) {
      if (value === undefined || !Number.isFinite(value)) return '#dfe8e5';
      if (classification === 'continuous') {
        const ratio = max === min ? 1 : (value - min) / (max - min);
        return rampColor(palette, Math.sqrt(Math.min(1, Math.max(0, ratio))), options.invertPalette);
      }
      const index = classes.findIndex((item, classIndex) => value <= item.upper || classIndex === classes.length - 1);
      return classes[Math.max(0, index)]?.color ?? '#dfe8e5';
    },
  };
}

/**
 * Qual coluna o mapa pinta.
 *
 * Existe por causa de um resultado silenciosamente errado: o mapa somava
 * TODAS as colunas da linha. Numa tabela com casos, população e taxa —
 * exatamente o que se monta para ver densidade — ele pintava
 * `casos + população + taxa`, um número sem significado nenhum, sem avisar.
 *
 * Somar só é correto quando há uma coluna, e aí a soma é ela mesma. Com mais
 * de uma, alguém precisa escolher; escolher sozinho e calar seria repetir o
 * defeito com outra aritmética.
 */
export interface MapColumnChoice {
  /** Índice da coluna a pintar. */
  index: number;
  /** Se a escolha foi feita pelo aplicativo, e portanto precisa ser dita. */
  automatic: boolean;
}

export function chooseMapColumn(
  columnKeys: readonly string[],
  requested: string | undefined,
): MapColumnChoice {
  if (columnKeys.length === 0) return { index: 0, automatic: true };

  const pedido = requested ? columnKeys.indexOf(requested) : -1;
  if (pedido >= 0) return { index: pedido, automatic: false };

  // Uma coluna só não é escolha: não há o que perguntar nem o que declarar.
  if (columnKeys.length === 1) return { index: 0, automatic: false };

  // Várias e nenhuma pedida: a primeira, que é a ordem de leitura da tabela.
  // Escolher a última seria adivinhar que a pessoa quer sempre a derivada, e
  // ela nem sempre está no fim.
  return { index: 0, automatic: true };
}
