/**
 * Prévia agregada pelo TabNet, do lado do navegador.
 *
 * Duas idas ao proxy: uma busca o formulário do `.def`, outra manda a
 * tabulação. O formulário existe porque cada `.def` nomeia as coisas do seu
 * jeito — a medida do nascidos vivos é `Nascim_p/resid.mãe`, o arquivo de 2023
 * é `nvuf23.dbf` — e nada disso se deduz do par sistema/tipo.
 *
 * Uma coisa precisa ficar dita em voz alta, e está dita na tela também: **esta
 * é a única parte do aplicativo em que a pergunta viaja**. O caminho normal
 * baixa o arquivo e tabula aqui, sem contar a ninguém o que se quis saber. A
 * prévia manda a pergunta a um servidor do governo, e por isso ela nunca
 * acontece sozinha — só quando alguém clica.
 */
import {
  buildTabnetBody,
  encodeTabnetBody,
  findTabnetDef,
  parseTabnetForm,
  parseTabnetTable,
  selectTabnetFilesForYear,
  type TabnetOption,
  type TabnetTable,
} from '../../../packages/acquisition/src/tabnet-preview.ts';

const PROXY_BASE = (import.meta.env.VITE_DATASUS_PROXY_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** Prazo generoso: o TabNet de 1998 leva alguns segundos e isso é normal. */
const TIMEOUT_MS = 30_000;

export interface TabnetPreview {
  table: TabnetTable;
  /** O que foi perguntado, para a tela poder mostrar e a pessoa conferir. */
  asked: { def: string; row: string; measure: string; period: string };
}

/** O `.def` deste arquivo, ou `undefined` quando o TabNet não o cobre. */
export function tabnetDefFor(system: string | undefined, fileType: string | undefined): string | undefined {
  if (!system || !fileType) return undefined;
  return findTabnetDef(system, fileType);
}

/**
 * Se vale oferecer a prévia para este conjunto.
 *
 * Duas condições, e a segunda é fácil de esquecer: o TabNet **não manda CORS**
 * (medido), então sem o proxy o navegador recusa ler a resposta e a prévia
 * falha sempre. Oferecer um botão que só sabe falhar é pior do que não
 * oferecer — em desenvolvimento, sem proxy, ele simplesmente não aparece.
 */
export function tabnetPreviewAvailable(system: string | undefined, fileType: string | undefined): boolean {
  return Boolean(PROXY_BASE) && tabnetDefFor(system, fileType) !== undefined;
}

async function pedir(caminho: string, init?: RequestInit): Promise<string> {
  if (!PROXY_BASE) throw new Error('a prévia precisa do proxy, que não está configurado nesta build');
  const relogio = new AbortController();
  const prazo = setTimeout(() => relogio.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(`${PROXY_BASE}${caminho}`, { ...init, signal: relogio.signal });
    if (!resposta.ok) throw new Error(`o TabNet respondeu ${resposta.status}`);
    // O TabNet é latin-1 e não declara o charset direito; ler como UTF-8
    // transformaria todo acento em losango.
    const bytes = await resposta.arrayBuffer();
    return new TextDecoder('windows-1252').decode(bytes);
  } finally {
    clearTimeout(prazo);
  }
}

/**
 * Escolhe a linha da tabulação.
 *
 * Unidade da Federação é a resposta útil na esmagadora maioria dos casos: ela
 * cabe numa tela, é a mesma em todos os `.def` que interessam aqui, e é o
 * primeiro corte que quase todo mundo faz. Quando ela não existe, vale o que o
 * próprio formulário já vem marcando — o TabNet marca um padrão razoável.
 */
function escolherLinha(rows: readonly TabnetOption[]): TabnetOption | undefined {
  return rows.find((opcao) => /^Unidade_da_Federa/i.test(opcao.value))
    ?? rows.find((opcao) => opcao.selected)
    ?? rows[0];
}

/**
 * Busca a prévia de um conjunto, pelo par sistema/tipo e pelo ano.
 *
 * Devolve `null` quando o TabNet não cobre esse conjunto — quem chama usa isso
 * para nem oferecer o botão. Qualquer outra falha vira erro, porque aí houve
 * uma tentativa e a pessoa precisa saber que ela não deu certo.
 */
export async function fetchTabnetPreview(
  system: string,
  fileType: string,
  year: string | number,
): Promise<TabnetPreview | null> {
  const def = tabnetDefFor(system, fileType);
  if (!def) return null;

  const formulario = parseTabnetForm(await pedir(`/tabnet-form?def=${encodeURIComponent(def)}`));
  const linha = escolherLinha(formulario.rows);
  const medida = formulario.measures.find((opcao) => opcao.selected) ?? formulario.measures[0];
  const periodos = selectTabnetFilesForYear(formulario.files, Number(year));

  // Sem uma das três não há pergunta a fazer. Falhar aqui, com o motivo, é
  // melhor do que mandar uma tabulação incompleta e mostrar o que voltar.
  if (!linha) throw new Error('o formulário do TabNet não trouxe opções de linha');
  if (!medida) throw new Error('o formulário do TabNet não trouxe nenhuma medida');
  if (!periodos.length) throw new Error(`o TabNet não publica ${year} para este conjunto`);

  const corpo = buildTabnetBody({
    def,
    row: linha.value,
    measure: medida.value,
    files: periodos.map((periodo) => periodo.value),
  });

  const html = await pedir(`/tabnet?def=${encodeURIComponent(def)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    // Latin-1, não UTF-8: `URLSearchParams.toString()` mandaria `Regi%C3%A3o`
    // e o TabNet, que lê byte a byte, não reconheceria a opção.
    body: encodeTabnetBody(corpo),
  });

  return {
    table: parseTabnetTable(html),
    asked: {
      def,
      row: linha.label,
      measure: medida.label,
      period: periodos.map((periodo) => periodo.label).join(', '),
    },
  };
}
