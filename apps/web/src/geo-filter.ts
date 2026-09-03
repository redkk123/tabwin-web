/**
 * O recorte geográfico, do lado da tela.
 *
 * Ele existe porque filtrar por lugar era, até aqui, a operação simples que
 * parecia trabalho de perito: era preciso descobrir o campo certo entre 87,
 * saber que Belém é `150140`, e digitar o código sem errar — e um código
 * errado não dá erro, dá a tabela do município vizinho.
 *
 * Aqui a pessoa lê nomes e vai marcando. O que vai para o motor é um filtro de
 * categorias comum, com os códigos dentro: o recorte não é um caminho paralelo
 * de execução, é o mesmo filtro que ela poderia ter montado à mão.
 */
import {
  buildGeographicPicker,
  codesForSelection,
  filterPicker,
  type GeographicPicker,
  type GeographyNames,
} from '../../../packages/analysis/src/geographic-picker.ts';

const NOMES_URL = './geografia.json';

let nomesCarregados: Promise<GeographyNames | null> | undefined;

/**
 * Lê os nomes uma vez por sessão.
 *
 * A ausência é tratada como "sem recorte geográfico", nunca como erro: são
 * 132 kB de conveniência, e um aplicativo que se recusa a abrir um arquivo
 * porque a lista de municípios não baixou seria pior do que um sem a lista.
 */
export function loadGeographyNames(): Promise<GeographyNames | null> {
  nomesCarregados ??= (async () => {
    try {
      const resposta = await fetch(NOMES_URL, { cache: 'force-cache' });
      if (!resposta.ok) return null;
      const dados = await resposta.json() as Partial<GeographyNames>;
      // Conferência mínima de forma: um JSON que não é este arquivo produziria
      // uma lista vazia silenciosa, indistinguível de "o arquivo não tem
      // geografia".
      if (!dados || typeof dados.municipios !== 'object' || typeof dados.ufs !== 'object') return null;
      return { ufs: dados.ufs, municipios: dados.municipios } as GeographyNames;
    } catch {
      return null;
    }
  })();
  return nomesCarregados;
}

export interface GeoSelection {
  states: string[];
  municipalities: string[];
}

export const EMPTY_SELECTION: GeoSelection = { states: [], municipalities: [] };

/** Monta a árvore a partir das contagens por código, ou `null` sem nomes. */
export async function buildPicker(
  counts: ReadonlyMap<string, number>,
): Promise<GeographicPicker | null> {
  const nomes = await loadGeographyNames();
  if (!nomes) return null;
  const picker = buildGeographicPicker(counts, nomes);
  return picker.states.length ? picker : null;
}

/** Quantos registros a escolha atual cobre, para a tela dizer antes de aplicar. */
export function countSelected(picker: GeographicPicker, selection: GeoSelection): number {
  const escolhidos = new Set(codesForSelection(picker, selection));
  let total = 0;
  for (const estado of picker.states) {
    for (const municipio of estado.municipalities) {
      if (escolhidos.has(municipio.code)) total += municipio.count;
    }
  }
  return total;
}

/**
 * Desenha a lista de estados, cada um abrindo nos seus municípios.
 *
 * `<details>` por estado, e não tudo aberto: com 5.570 municípios uma lista
 * plana é impossível de percorrer, e o Brasil inteiro aberto de uma vez
 * trava a rolagem no celular.
 */
export function renderPicker(
  container: HTMLElement,
  picker: GeographicPicker,
  selection: GeoSelection,
  query: string,
  onChange: () => void,
): void {
  const visivel = filterPicker(picker, query);
  container.replaceChildren();

  if (!visivel.states.length) {
    const vazio = document.createElement('p');
    vazio.className = 'filter-info';
    vazio.textContent = 'Nenhum estado ou município com esse nome nos dados abertos.';
    container.append(vazio);
    return;
  }

  const numero = new Intl.NumberFormat('pt-BR');
  const buscando = query.trim().length > 0;

  for (const estado of visivel.states) {
    const bloco = document.createElement('details');
    bloco.className = 'geo-state';
    // Buscando, os estados vêm abertos: o resultado que a pessoa procurou está
    // dentro deles, e obrigá-la a clicar de novo esconde o que ela pediu.
    bloco.open = buscando;

    const cabecalho = document.createElement('summary');
    const marca = document.createElement('input');
    marca.type = 'checkbox';
    marca.checked = selection.states.includes(estado.code);
    marca.setAttribute('aria-label', `Incluir ${estado.name} inteiro`);
    marca.addEventListener('click', (evento) => evento.stopPropagation());
    marca.addEventListener('change', () => {
      const outros = selection.states.filter((code) => code !== estado.code);
      selection.states = marca.checked ? [...outros, estado.code] : outros;
      // Marcar o estado inteiro dispensa as escolhas soltas dentro dele, que
      // já estão contempladas e só confundiriam a contagem.
      if (marca.checked) {
        const dentro = new Set(estado.municipalities.map((m) => m.code));
        selection.municipalities = selection.municipalities.filter((code) => !dentro.has(code));
      }
      onChange();
    });

    const rotulo = document.createElement('span');
    rotulo.className = 'geo-state-name';
    rotulo.textContent = `${estado.name} (${estado.sigla})`;
    const contagem = document.createElement('small');
    contagem.textContent = `${numero.format(estado.count)} · ${numero.format(estado.municipalities.length)} municípios`;
    cabecalho.append(marca, rotulo, contagem);
    bloco.append(cabecalho);

    const lista = document.createElement('div');
    lista.className = 'geo-municipality-list';
    for (const municipio of estado.municipalities) {
      const linha = document.createElement('label');
      linha.className = 'geo-municipality';
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.checked = selection.municipalities.includes(municipio.code)
        || selection.states.includes(estado.code);
      // Com o estado inteiro marcado, o município aparece marcado e travado:
      // desmarcá-lo daria uma escolha contraditória com a do estado.
      caixa.disabled = selection.states.includes(estado.code);
      caixa.addEventListener('change', () => {
        const outros = selection.municipalities.filter((code) => code !== municipio.code);
        selection.municipalities = caixa.checked ? [...outros, municipio.code] : outros;
        onChange();
      });
      const nome = document.createElement('span');
      nome.textContent = municipio.name;
      const quantos = document.createElement('small');
      quantos.textContent = numero.format(municipio.count);
      linha.append(caixa, nome, quantos);
      lista.append(linha);
    }
    bloco.append(lista);
    container.append(bloco);
  }
}

/** Resumo curto do que está escolhido, para o cabeçalho do painel. */
export function describeSelection(picker: GeographicPicker, selection: GeoSelection): string {
  const numero = new Intl.NumberFormat('pt-BR');
  if (!selection.states.length && !selection.municipalities.length) return 'todo o Brasil';

  const nomesDeEstado = picker.states
    .filter((estado) => selection.states.includes(estado.code))
    .map((estado) => estado.name);
  const partes: string[] = [];
  if (nomesDeEstado.length === 1) partes.push(nomesDeEstado[0]!);
  else if (nomesDeEstado.length > 1) partes.push(`${nomesDeEstado.length} estados`);
  if (selection.municipalities.length === 1) {
    const achado = picker.states
      .flatMap((estado) => estado.municipalities)
      .find((municipio) => municipio.code === selection.municipalities[0]);
    if (achado) partes.push(achado.name);
  } else if (selection.municipalities.length > 1) {
    partes.push(`${selection.municipalities.length} municípios`);
  }
  return `${partes.join(' · ')} — ${numero.format(countSelected(picker, selection))} registros`;
}

export { codesForSelection };
