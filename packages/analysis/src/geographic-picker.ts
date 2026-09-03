/**
 * O filtro geográfico, do lado das decisões.
 *
 * O problema que ele resolve: hoje, filtrar por município exige saber que
 * Belém é `150140`. Ninguém sabe. Quem estuda dado do SUS acaba consultando
 * uma tabela do IBGE à parte, copiando código, e errando — e um código errado
 * não dá erro nenhum, dá uma tabela vazia ou, pior, a do município vizinho.
 *
 * Aqui o nome é rótulo e o código é o que vale. O filtro guarda **sempre o
 * código**, porque nome de município repete entre estados: há Bom Jesus em
 * nove deles.
 *
 * A lista sai dos **dados**, nunca da lista completa do IBGE. Oferecer um
 * município sem um único registro produz uma tabela vazia que parece defeito
 * do aplicativo, e some no meio de 5.570 opções.
 */

import { ufCodeOf } from './geographic-fields.js';

/** Nomes vindos de `geografia.json`, gerado dos mapas incluídos. */
export interface GeographyNames {
  ufs: Record<string, { sigla: string; nome: string }>;
  municipios: Record<string, string>;
}

export interface PickerMunicipality {
  code: string;
  name: string;
  /** Registros deste município no recorte atual. */
  count: number;
}

export interface PickerState {
  code: string;
  name: string;
  sigla: string;
  count: number;
  municipalities: PickerMunicipality[];
}

export interface GeographicPicker {
  states: PickerState[];
  /** Códigos que não casaram com nenhum nome conhecido. */
  unknownCodes: string[];
  /** Registros em códigos desconhecidos, para a tela poder declarar a perda. */
  unknownCount: number;
}

/**
 * Monta a árvore estado → município a partir das contagens observadas.
 *
 * `counts` vem de uma tabulação pelo campo geográfico: código do IBGE para
 * número de registros.
 *
 * Ordenação: estados e municípios por **nome**, não por código nem por
 * contagem. Por código, a lista fica em ordem de região e ninguém acha o que
 * procura; por contagem, ela muda de ordem a cada filtro aplicado, e o item
 * que a pessoa ia clicar sai do lugar debaixo do cursor.
 */
export function buildGeographicPicker(
  counts: ReadonlyMap<string, number>,
  names: GeographyNames,
): GeographicPicker {
  const porUf = new Map<string, PickerMunicipality[]>();
  const unknownCodes: string[] = [];
  let unknownCount = 0;

  for (const [codigoBruto, count] of counts) {
    const code = String(codigoBruto ?? '').trim();
    const uf = ufCodeOf(code);
    const name = names.municipios[code];
    // Sem UF plausível ou sem nome conhecido, o código não vira opção — mas
    // também não é descartado em silêncio: ele é contado e declarado.
    if (!uf || !name) {
      if (code) unknownCodes.push(code);
      unknownCount += count;
      continue;
    }
    const lista = porUf.get(uf) ?? [];
    lista.push({ code, name, count });
    porUf.set(uf, lista);
  }

  const emPortugues = new Intl.Collator('pt-BR', { sensitivity: 'base' });
  const states: PickerState[] = [...porUf.entries()]
    .map(([code, municipalities]) => {
      const conhecido = names.ufs[code];
      return {
        code,
        name: conhecido?.nome ?? `UF ${code}`,
        sigla: conhecido?.sigla ?? code,
        count: municipalities.reduce((soma, item) => soma + item.count, 0),
        municipalities: municipalities.sort((a, b) => emPortugues.compare(a.name, b.name)),
      };
    })
    .sort((a, b) => emPortugues.compare(a.name, b.name));

  return { states, unknownCodes: unknownCodes.sort(), unknownCount };
}

/**
 * Os códigos que o filtro deve aceitar para uma escolha.
 *
 * Escolher um estado inteiro não vira um filtro por "UF igual a 15" — o campo
 * do arquivo é de município, e não existe campo de UF para comparar. Vira a
 * lista dos municípios daquele estado **que aparecem nos dados**. É a mesma
 * coisa para o motor, e evita inventar um campo que o arquivo não tem.
 */
export function codesForSelection(
  picker: GeographicPicker,
  selection: { states: readonly string[]; municipalities: readonly string[] },
): string[] {
  const escolhidos = new Set<string>();
  const estadosEscolhidos = new Set(selection.states);

  for (const estado of picker.states) {
    if (!estadosEscolhidos.has(estado.code)) continue;
    for (const municipio of estado.municipalities) escolhidos.add(municipio.code);
  }
  for (const code of selection.municipalities) escolhidos.add(code);

  return [...escolhidos].sort();
}

/**
 * Filtra a árvore por um texto digitado.
 *
 * Compara sem acento e sem caixa, porque quem digita "sao paulo" quer achar
 * "São Paulo" — exigir o acento certo num campo de busca é transformar a
 * ferramenta em prova de digitação.
 *
 * Um estado casa pelo próprio nome ou pela sigla, e nesse caso vem inteiro;
 * senão, vem só com os municípios que casaram.
 */
export function filterPicker(picker: GeographicPicker, query: string): GeographicPicker {
  const alvo = normalizeForSearch(query);
  if (!alvo) return picker;

  const states: PickerState[] = [];
  for (const estado of picker.states) {
    const estadoCasa = normalizeForSearch(estado.name).includes(alvo)
      || normalizeForSearch(estado.sigla) === alvo;
    if (estadoCasa) {
      states.push(estado);
      continue;
    }
    const municipalities = estado.municipalities
      .filter((item) => normalizeForSearch(item.name).includes(alvo));
    if (municipalities.length) states.push({ ...estado, municipalities });
  }
  return { ...picker, states };
}

/** Sem acento, sem caixa, sem espaço sobrando. */
export function normalizeForSearch(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    // Escrito em escapes, e não com os próprios acentos combinantes: eles são
    // invisíveis num editor e a primeira conversão de codificação os come.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
