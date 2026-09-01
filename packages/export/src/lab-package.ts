/**
 * Pacote de laboratório — o contrato tabular entre o TabWin Web e o Tabwin Lab.
 *
 * ## Por que um formato, e não uma importação de código
 *
 * Os dois projetos são separados de propósito: o Lab explora dados; a
 * aquisição e a semântica DEF/CNV ficam no TabWin Web. Se o Lab importasse
 * módulos daqui, essa fronteira sumiria na primeira refatoração. Então o que
 * os une é um **formato documentado**, com implementação independente dos dois
 * lados — o Lab lê o pacote sem conhecer uma linha deste repositório.
 *
 * ## O que o pacote carrega, e por quê
 *
 * Um `.zip` com:
 *
 * - `dados.csv` — a tabela, em UTF-8 com BOM, separada por vírgula;
 * - `PROVENIENCIA.json` — de onde os dados vieram e o que foi feito com eles.
 *
 * A procedência não é enfeite. Um CSV solto num caderno de análise é um número
 * sem origem: seis meses depois ninguém sabe qual arquivo do DATASUS gerou
 * aquilo, que filtros estavam ativos, nem se a coluna "IDADE" já vinha
 * recodificada. O pacote responde isso por escrito, com hash das fontes, para
 * a análise no Lab poder ser citada.
 */

export interface LabPackageColumn {
  /** Nome técnico do microdado, como está no arquivo original. */
  name: string;
  /** Rótulo legível, quando um DEF o define. `null` quando não há. */
  label: string | null;
}

export interface LabPackageSource {
  name: string;
  sha256: string;
  bytes: number;
  origin?: string;
  retrievedAt?: string;
}

export interface LabPackageProvenance {
  schema: 'tabwin-web.lab-package';
  version: 1;
  createdAt: string;
  /** O que a tabela é: registros aceitos, ou o resultado de uma tabulação. */
  content: 'records' | 'tabulation';
  rowCount: number;
  columns: LabPackageColumn[];
  sources: LabPackageSource[];
  /** Passos de transformação aplicados antes da exportação, se houver. */
  transformSteps: unknown[];
  /** Filtros ativos, em texto legível. */
  filters: string[];
  notes: string[];
}

export interface LabPackageInput {
  content: 'records' | 'tabulation';
  columns: LabPackageColumn[];
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>;
  sources: LabPackageSource[];
  transformSteps?: unknown[];
  filters?: string[];
  createdAt?: string;
}

/** Escapa um campo CSV. Aspas dobram; qualquer separador força aspas. */
function csvField(value: string | number | null): string {
  // `null` vira campo vazio, nunca `0` nem a palavra "null": um ausente que
  // vira zero é exatamente o erro que este projeto recusa em todo lugar.
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function labPackageCsv(input: LabPackageInput): string {
  const header = input.columns.map((column) => csvField(column.name)).join(',');
  const body = input.rows.map((row) => row.map(csvField).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}

export function labPackageProvenance(input: LabPackageInput): LabPackageProvenance {
  return {
    schema: 'tabwin-web.lab-package',
    version: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    content: input.content,
    rowCount: input.rows.length,
    columns: input.columns,
    sources: input.sources,
    transformSteps: input.transformSteps ?? [],
    filters: input.filters ?? [],
    notes: [
      'Microdados públicos do DATASUS/Ministério da Saúde.',
      'Pacote montado pelo TabWin Web, que não é afiliado ao órgão.',
      input.content === 'records'
        ? 'Uma linha por registro aceito pelos filtros ativos no momento da exportação.'
        : 'Resultado de uma tabulação; os totais do TabWin não são células de resultado.',
      'Célula vazia significa ausente. Nenhum zero foi fabricado para preencher lacuna.',
    ],
  };
}

/**
 * Monta as entradas do `.zip`.
 *
 * Devolve os bytes em vez de compactar aqui: quem chama já tem um compactador
 * e a escolha de nível de compressão depende do tamanho, que só o chamador
 * conhece.
 */
export function labPackageEntries(input: LabPackageInput): Record<string, Uint8Array> {
  const encoder = new TextEncoder();
  // BOM: Excel e um bom número de leitores tratam CSV sem BOM como Latin-1 e
  // quebram todo acento. O Python e o R leem por cima do BOM sem reclamar.
  const csv = encoder.encode(`﻿${labPackageCsv(input)}`);
  const provenance = encoder.encode(
    `${JSON.stringify(labPackageProvenance(input), null, 2)}\n`,
  );
  return { 'dados.csv': csv, 'PROVENIENCIA.json': provenance };
}

/** Nome sugerido, com a data para dois pacotes do mesmo dia não colidirem à toa. */
export function labPackageFilename(input: Pick<LabPackageInput, 'content'>, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `tabwin-lab-${input.content === 'records' ? 'registros' : 'tabela'}-${stamp}.zip`;
}
