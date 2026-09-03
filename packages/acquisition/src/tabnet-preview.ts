/**
 * Prévia agregada pelo TabNet, antes de baixar o microdado.
 *
 * O TabNet tabula no servidor do DATASUS e devolve só o resultado. Medido em
 * 2026-09-02: uma tabulação nacional do SINASC 2023, sexo por cor/raça, veio em
 * 2,5 segundos e 3.864 bytes. O mesmo pelo caminho de microdado custa ~11 s de
 * preparo mais 105 MB.
 *
 * Para que serve aqui: confirmar que a pergunta é essa **antes** de baixar. Não
 * substitui o microdado — sem ele não há filtro fora do que o DEF do TabNet
 * expõe, nem transformação, nem investigação por registro, nem auditoria em
 * nível de linha. E há um custo que precisa ficar dito na tela: a pergunta
 * viaja até um servidor do governo, enquanto o caminho normal não manda nada.
 *
 * O HTML do TabNet é de 1998 — tags em maiúsculas, `<TD>` sem fechar, latin-1,
 * números com ponto de milhar. O leitor aqui assume isso em vez de esperar
 * marcação bem formada.
 */

export interface TabnetQuery {
  /** Caminho do `.def`, ex.: `sinasc/cnv/nvuf.def`. */
  def: string;
  /** Nome exato da opção de linha, como o formulário a expõe. */
  row: string;
  column?: string;
  /** A medida. Ex.: `Nascim_p/resid.mãe`. */
  measure: string;
  /** Arquivos do período, ex.: `nvuf23.dbf`. */
  files: readonly string[];
}

export interface TabnetTable {
  title: string;
  subtitle: string;
  /** Rótulo da primeira coluna, que nomeia a dimensão das linhas. */
  rowLabel: string;
  columns: string[];
  rows: { label: string; values: number[] }[];
  /** A linha TOTAL, que o TabNet emite separada do corpo. */
  total?: { label: string; values: number[] };
  /** Fonte e notas de extração, que datam o dado. */
  notes: string[];
}

const SEM_ACENTO: Readonly<Record<string, string>> = {
  aacute: 'á', acirc: 'â', atilde: 'ã', agrave: 'à', ccedil: 'ç',
  eacute: 'é', ecirc: 'ê', iacute: 'í', oacute: 'ó', ocirc: 'ô',
  otilde: 'õ', uacute: 'ú', uuml: 'ü', nbsp: ' ', amp: '&', lt: '<', gt: '>',
  Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Ccedil: 'Ç', Eacute: 'É',
  Ecirc: 'Ê', Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú',
};

/** Desfaz as entidades HTML que o TabNet emite, e só essas. */
export function decodeTabnetText(bruto: string): string {
  return bruto
    .replace(/&([a-zA-Z]+);/g, (inteiro, nome: string) => SEM_ACENTO[nome] ?? inteiro)
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lê um número do TabNet.
 *
 * Ponto é separador de milhar, vírgula é decimal — o oposto do que
 * `Number()` assume, e trocar os dois faria 2.537.576 virar 2,5.
 */
export function parseTabnetNumber(texto: string): number {
  const limpo = decodeTabnetText(texto).replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) return Number.NaN;
  return Number(limpo);
}

/** Remove tags, preservando o texto de uma célula. */
const semTags = (html: string): string => decodeTabnetText(html.replace(/<[^>]*>/g, ' '));

/**
 * Extrai a tabela de dados da página do TabNet.
 *
 * A página traz mais de uma `<TABLE>`; a que interessa é `class="tabdados"`.
 * Procurar pela primeira daria o cabeçalho de navegação.
 */
export function parseTabnetTable(html: string): TabnetTable {
  const inicio = html.search(/<table[^>]*class\s*=\s*["']?tabdados/i);
  if (inicio < 0) throw new Error('O TabNet não devolveu uma tabela de dados');
  const fim = html.toUpperCase().indexOf('</TABLE>', inicio);
  const tabela = html.slice(inicio, fim < 0 ? undefined : fim);

  const titulo = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(tabela);
  const subtitulo = /<b>([^<]*por[^<]*segundo[^<]*)<\/b>/i.exec(tabela);

  // As linhas são separadas por <TR>; as células por <TD> ou <TH>, e o TabNet
  // não fecha nenhuma delas. Fatiar pelos abre-tags é o que funciona.
  const linhas = tabela.split(/<TR\b[^>]*>/i).slice(1);
  const celulas = (linha: string): string[] => linha
    .split(/<T[DH]\b[^>]*>/i).slice(1)
    .map((celula) => semTags(celula.split(/<\/T[DH]>/i)[0] ?? celula));

  let columns: string[] = [];
  let rowLabel = '';
  const rows: TabnetTable['rows'] = [];
  let total: TabnetTable['total'];

  for (const linha of linhas) {
    const partes = celulas(linha);
    if (partes.length < 2) continue;

    // O cabeçalho é a linha cujas células vêm de <TH>.
    if (/<TH\b/i.test(linha) && !columns.length) {
      rowLabel = partes[0] ?? '';
      columns = partes.slice(1);
      continue;
    }
    if (!columns.length) continue;

    const label = partes[0] ?? '';
    const values = partes.slice(1).map(parseTabnetNumber);
    // Uma linha sem nenhum número é rodapé ou nota, não dado.
    if (!values.some((valor) => Number.isFinite(valor))) continue;

    if (label.toUpperCase() === 'TOTAL') total = { label, values };
    else rows.push({ label, values });
  }

  if (!columns.length) throw new Error('O TabNet devolveu uma tabela sem cabeçalho reconhecível');

  const notas = [...html.matchAll(/<li>([^<]{4,200})/gi)]
    .map((match) => decodeTabnetText(match[1] ?? ''))
    .filter(Boolean);
  const fonte = /Fonte:([^<]{4,200})/i.exec(html);

  return {
    title: titulo ? semTags(titulo[1] ?? '') : '',
    subtitle: subtitulo ? decodeTabnetText(subtitulo[1] ?? '') : '',
    rowLabel,
    columns,
    rows,
    ...(total ? { total } : {}),
    notes: [...(fonte ? [`Fonte:${decodeTabnetText(fonte[1] ?? '')}`] : []), ...notas],
  };
}

/**
 * Monta o corpo do formulário que o `tabcgi.exe` espera.
 *
 * Cada dimensão não usada precisa de `S<Nome>=TODAS_AS_CATEGORIAS__`, senão o
 * TabNet filtra por nada e devolve tabela vazia. Como os nomes das dimensões
 * variam por `.def`, quem chama informa quais são.
 */
export function buildTabnetBody(
  query: TabnetQuery,
  dimensions: readonly string[] = [],
): URLSearchParams {
  const body = new URLSearchParams();
  body.append('Linha', query.row);
  body.append('Coluna', query.column ?? '--Não-Ativa--');
  body.append('Incremento', query.measure);
  for (const file of query.files) body.append('Arquivos', file);
  for (const dimension of dimensions) body.append(`S${dimension}`, 'TODAS_AS_CATEGORIAS__');
  body.append('formato', 'table');
  body.append('mostre', 'Mostra');
  return body;
}

/** Uma opção de um `<SELECT>` do formulário, como o TabNet a expõe. */
export interface TabnetOption {
  /** O que vai no corpo do POST. Vem em latin-1 e é usado byte a byte. */
  value: string;
  /** O rótulo legível, já sem entidades HTML. */
  label: string;
  selected: boolean;
}

export interface TabnetForm {
  rows: TabnetOption[];
  columns: TabnetOption[];
  measures: TabnetOption[];
  /** Períodos. O rótulo costuma ser o ano; o valor é o `.dbf` do TabNet. */
  files: TabnetOption[];
}

/**
 * Lê as opções do formulário de um `.def`.
 *
 * Existe porque cada `.def` expõe nomes próprios: o de nascidos vivos mede
 * `Nascim_p/resid.mãe`, o de mortalidade mede outra coisa, e o nome do arquivo
 * de um ano (`nvuf23.dbf`) também é específico. Fixar isso no código para os
 * seis `.def` do mapa seria chute em cinco deles. Ler o formulário troca o
 * chute por um fato, e de quebra a lista de anos passa a ser a real — quando o
 * DATASUS publica 2027, ele aparece sozinho.
 */
export function parseTabnetForm(html: string): TabnetForm {
  const bloco = (nome: string): TabnetOption[] => {
    // O `NAME` vem sem aspas em parte das páginas, e os atributos antes dele
    // variam (`class`, `scrolling`). Ancorar no nome, não na forma da tag.
    // As barras vão dobradas porque isto é uma template literal: `\b` solto
    // aqui seria o caractere de backspace, não a borda de palavra do regex.
    const abre = new RegExp(`<select\\b[^>]*\\bname\\s*=\\s*["']?${nome}["']?[^>]*>`, 'i');
    const inicio = abre.exec(html);
    if (!inicio) return [];
    const resto = html.slice(inicio.index + inicio[0].length);
    const fim = resto.search(/<\/select>/i);
    const corpo = fim < 0 ? resto : resto.slice(0, fim);

    const opcoes: TabnetOption[] = [];
    // O TabNet não fecha `<OPTION>`: o rótulo vai até a próxima tag ou o fim
    // da linha. Casar `[^<\r\n]*` é o que respeita as duas terminações.
    const padrao = /<option\b([^>]*)>([^<\r\n]*)/gi;
    for (let achou = padrao.exec(corpo); achou; achou = padrao.exec(corpo)) {
      const atributos = achou[1] ?? '';
      const valor = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(atributos);
      const bruto = valor?.[1] ?? valor?.[2] ?? valor?.[3];
      if (bruto === undefined) continue;
      opcoes.push({
        value: bruto,
        label: decodeTabnetText(achou[2] ?? '') || decodeTabnetText(bruto),
        selected: /\bselected\b/i.test(atributos),
      });
    }
    return opcoes;
  };

  return {
    rows: bloco('Linha'),
    columns: bloco('Coluna'),
    measures: bloco('Incremento'),
    files: bloco('Arquivos'),
  };
}

/**
 * Onde o TabNet publica cada conjunto que o aplicativo baixa.
 *
 * Só entram pares que foram sondados e responderam. `SIH/RD` ficou de fora de
 * propósito: `sih/cnv/niuf.def` não conectou na sondagem, e oferecer uma prévia
 * que erra é pior do que não oferecer nenhuma.
 *
 * A chave é `SISTEMA/TIPO`, o mesmo par que identifica o arquivo no catálogo.
 */
export const TABNET_DEFS: Readonly<Record<string, string>> = Object.freeze({
  'SINASC/DN': 'sinasc/cnv/nvuf.def',
  'SIM/DO': 'sim/cnv/obt10uf.def',
  'SIM/DOINF': 'sim/cnv/inf10uf.def',
  'SIM/DOMAT': 'sim/cnv/mat10uf.def',
  'SIM/DOEXT': 'sim/cnv/ext10uf.def',
  'SIASUS/PA': 'sia/cnv/qauf.def',
});

/** O `.def` do par, ou `undefined` quando o TabNet não cobre esse conjunto. */
export function findTabnetDef(system: string, fileType: string): string | undefined {
  return TABNET_DEFS[`${system.toUpperCase()}/${fileType.toUpperCase()}`];
}

/**
 * Escolhe o período pelo ano, usando os rótulos que o formulário trouxe.
 *
 * O rótulo é o ano em quase todos os `.def`, mas em alguns vem como
 * `2023 (parcial)` ou com o mês junto. Procurar o ano dentro do rótulo cobre
 * os dois casos sem depender do formato do valor.
 */
export function selectTabnetFilesForYear(
  files: readonly TabnetOption[],
  year: number,
): TabnetOption[] {
  const ano = String(year);
  const doAno = files.filter((arquivo) => new RegExp(`(^|\\D)${ano}(\\D|$)`).test(arquivo.label));
  if (doAno.length > 0) return doAno;
  // Alguns `.def` rotulam só com o mês e escondem o ano no valor (`nvuf23.dbf`).
  const doisDigitos = ano.slice(-2);
  return files.filter((arquivo) => new RegExp(`${doisDigitos}\\.dbf$`, 'i').test(arquivo.value));
}

/**
 * Serializa o corpo do POST em latin-1, que é o que o TabNet entende.
 *
 * `URLSearchParams.toString()` percent-codifica em UTF-8: `Região` sairia
 * como `Regi%C3%A3o`. O TabNet de 1998 lê byte a byte em latin-1 e espera
 * `Regi%E3o` — com o UTF-8 ele simplesmente não reconhece a opção e devolve
 * uma página de erro, ou pior, uma tabulação de outra coisa.
 *
 * Os valores chegam aqui como vieram do formulário, que foi lido em
 * windows-1252; cada caractere já é um byte só.
 */
export function encodeTabnetBody(body: URLSearchParams): string {
  const porByte = (texto: string): string => [...texto]
    .map((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      if (/[A-Za-z0-9_.~-]/.test(caractere)) return caractere;
      if (codigo > 0xff) {
        // Fora do latin-1 não há byte para mandar. Acontecer aqui significa
        // que o valor não veio do formulário, e mandar '?' esconderia o erro.
        throw new Error(`o TabNet não aceita "${caractere}", que não cabe em latin-1`);
      }
      return `%${codigo.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');

  return [...body.entries()]
    .map(([chave, valor]) => `${porByte(chave)}=${porByte(valor)}`)
    .join('&');
}
