/**
 * Leitor do pacote de laboratório exportado pelo TabWin Web.
 *
 * ## Por que a implementação é independente
 *
 * O Lab não importa nada do `tabwin-web`, e isso é regra, não acaso: os dois
 * projetos são separados porque fazem coisas diferentes — o Lab explora dados,
 * a aquisição e a semântica DEF/CNV ficam lá. O que os une é um **formato
 * documentado**. Se este arquivo importasse módulos de lá, a fronteira sumiria
 * na primeira refatoração e o Lab passaria a depender do ciclo de release do
 * outro projeto.
 *
 * Custo aceito conscientemente: o parser abaixo é escrito aqui e testado aqui.
 *
 * ## O que o pacote traz
 *
 * - `dados.csv` — a tabela, UTF-8 com BOM, separada por vírgula;
 * - `PROVENIENCIA.json` — de onde veio e o que foi feito com os dados.
 *
 * A procedência é o motivo de existir o pacote em vez de um CSV solto. Um CSV
 * sozinho é número sem origem: meses depois ninguém sabe qual arquivo do
 * DATASUS o gerou, que filtros estavam ativos, nem se a coluna já vinha
 * recodificada.
 */

export const LAB_PACKAGE_SCHEMA = 'tabwin-web.lab-package';
export const LAB_PACKAGE_VERSION = 1;

export class LabPackageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LabPackageError';
  }
}

/**
 * Lê um CSV respeitando aspas.
 *
 * Um `split(',')` ingênuo quebraria em qualquer nome de município com vírgula,
 * e o erro apareceria como coluna deslocada muitas linhas depois — o pior tipo
 * de defeito de dado, porque não parece defeito.
 */
export function parseLabCsv(text) {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') { field += '"'; index++; continue; }
        quoted = false;
        continue;
      }
      field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  // Última linha sem quebra ao final.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function validateProvenance(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LabPackageError('PROVENIENCIA.json não é um JSON válido');
  }
  if (parsed?.schema !== LAB_PACKAGE_SCHEMA) {
    throw new LabPackageError('Este arquivo não é um pacote de laboratório do TabWin Web');
  }
  // Versão diferente é recusa, não tentativa de adivinhar: um pacote mais novo
  // pode ter mudado o significado de um campo, e ler errado em silêncio é pior
  // do que não ler.
  if (parsed.version !== LAB_PACKAGE_VERSION) {
    throw new LabPackageError(
      `Pacote na versão ${parsed.version}; este Lab lê a versão ${LAB_PACKAGE_VERSION}`,
    );
  }
  if (!Array.isArray(parsed.columns) || !parsed.columns.length) {
    throw new LabPackageError('O pacote não declara colunas');
  }
  return parsed;
}

/**
 * Abre um pacote já descompactado.
 *
 * Recebe as duas entradas como texto porque a descompactação é
 * responsabilidade de quem chama — assim esta função é testável sem zip.
 */
export function openLabPackage({ csv, provenance }) {
  if (typeof csv !== 'string') throw new LabPackageError('dados.csv ausente no pacote');
  if (typeof provenance !== 'string') throw new LabPackageError('PROVENIENCIA.json ausente no pacote');

  const meta = validateProvenance(provenance);
  const rows = parseLabCsv(csv);
  if (!rows.length) throw new LabPackageError('dados.csv está vazio');

  const header = rows[0];
  const declared = meta.columns.map((column) => column.name);
  if (header.length !== declared.length || header.some((name, index) => name !== declared[index])) {
    // O cabeçalho e a procedência discordarem significa pacote adulterado ou
    // montado errado. Seguir daria uma análise com rótulo trocado.
    throw new LabPackageError(
      `As colunas do CSV não batem com a procedência: ${header.join(', ')} contra ${declared.join(', ')}`,
    );
  }

  const body = rows.slice(1);
  if (body.length !== meta.rowCount) {
    throw new LabPackageError(
      `A procedência declara ${meta.rowCount} linha(s), mas o CSV traz ${body.length}`,
    );
  }

  return {
    columns: meta.columns,
    rows: body,
    provenance: meta,
    /** Rótulo legível quando existe; nome técnico quando não. */
    labelFor(name) {
      const column = meta.columns.find((item) => item.name === name);
      return column?.label ?? name;
    },
  };
}

/**
 * Resumo em uma frase, para a interface mostrar antes de montar o arquivo.
 *
 * Diz o que a pessoa precisa saber para decidir se é o pacote certo, sem
 * obrigá-la a abrir o JSON.
 */
export function describeLabPackage(opened) {
  const { provenance: meta } = opened;
  const parts = [
    meta.content === 'records' ? 'registros' : 'tabulação',
    `${meta.rowCount} linha(s)`,
    `${meta.columns.length} coluna(s)`,
  ];
  if (meta.sources?.length) {
    parts.push(`fonte: ${meta.sources.map((source) => source.name).join(', ')}`);
  }
  if (meta.filters?.length) parts.push(`${meta.filters.length} filtro(s) ativo(s)`);
  if (meta.transformSteps?.length) parts.push(`${meta.transformSteps.length} transformação(ões)`);
  return parts.join(' · ');
}
