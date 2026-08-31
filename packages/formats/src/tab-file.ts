/**
 * Read-only parser for TabWin 4.15 `.TAB` saved tables.
 *
 * ## What the evidence actually says
 *
 * Until a real artifact arrived, this format was assumed to be a binary
 * container, and `legacy-tab.ts` was written as bounded reconnaissance for
 * exactly that reason - it inspects, it does not claim to replay. The first
 * real capture (golden G023, saved from the same TabWin run as G002) settles
 * the question for that save path: the file is **plain Windows-1252 text with
 * CRLF line endings**, opening on the literal line `NEW`, with `key=value`
 * lines, `[Section]` headers, and a `;`-separated quoted result matrix.
 *
 * This parser therefore reads that text faithfully. It deliberately does not
 * interpret what it cannot yet justify from a real file:
 *
 * - `NEW` is recorded as an opening marker, not decoded as a version - one
 *   sample cannot tell a version token from a fixed literal;
 * - option values are kept as raw strings; `Não_Classificados=0` is a code
 *   whose mapping onto this engine's unclassified policies is not evidenced,
 *   so it is surfaced, never translated;
 * - totals are found by their literal `Total` label, never by position,
 *   because a positional guess would silently swallow a real category that
 *   happened to sort last.
 *
 * Writing `.TAB` is out of scope here. Per the project rule, only fields
 * proven stable across several real artifacts should ever be written back.
 */

export interface TabFileEntry {
  key: string;
  /** Raw value, trimmed of surrounding whitespace only. Never coerced. */
  value: string;
  sourceLine: number;
}

export interface TabFileSection {
  name: string;
  entries: TabFileEntry[];
  /** Lines inside the section that carry no `=`, such as file names under `[Arquivos]`. */
  bareLines: string[];
  sourceLine: number;
}

export interface TabFileMatrix {
  /** First cell of the header row - TabWin puts the row dimension's label here. */
  cornerLabel: string;
  columnLabels: string[];
  rowLabels: string[];
  /** Cell text exactly as written, before any numeric reading. */
  cells: string[][];
}

export interface TabFileTotals {
  /** Present only when a column is literally labelled `Total`. */
  columnTotals: string[] | null;
  /** Present only when a row is literally labelled `Total`. */
  rowTotals: string[] | null;
  grandTotal: string | null;
}

export interface TabFileDocument {
  version: 1;
  /** The opening line, verbatim. Recorded as evidence, not interpreted. */
  marker: string;
  /** `key=value` lines appearing before the first `[Section]`. */
  preamble: TabFileEntry[];
  sections: TabFileSection[];
  matrix: TabFileMatrix | null;
  /** Totals TabWin itself wrote. Presentation, never result cells. */
  totals: TabFileTotals;
  warnings: string[];
}

const TOTAL_LABEL = 'Total';

/** Splits one `;`-separated line, honouring `"` quoting. */
function splitRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote. No real
      // sample exercises this yet; handling it costs nothing and refusing to
      // would corrupt a label the day one appears.
      if (quoted && line[index + 1] === '"') { current += '"'; index++; continue; }
      quoted = !quoted;
      continue;
    }
    if (char === ';' && !quoted) { fields.push(current); current = ''; continue; }
    current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/** True for a line that opens the result matrix rather than the header block. */
function looksLikeMatrixRow(line: string): boolean {
  return line.startsWith('"') && line.includes(';');
}

/**
 * Parses the decoded text of a `.TAB` file.
 *
 * Takes text rather than bytes so the caller stays responsible for decoding
 * Windows-1252 - the same split the DEF and CNV parsers already use.
 */
export function parseTabFile(text: string): TabFileDocument {
  const lines = text.split(/\r\n|\n|\r/);
  const warnings: string[] = [];
  const preamble: TabFileEntry[] = [];
  const sections: TabFileSection[] = [];
  const matrixLines: Array<{ line: string; sourceLine: number }> = [];

  let marker = '';
  let current: TabFileSection | null = null;
  let started = false;

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const line = raw.trim();
    const sourceLine = index + 1;
    if (!line) continue;

    if (!started) {
      started = true;
      // The opening line carries no `=` and no brackets in the one real
      // sample. Anything else is still parsed, but said out loud.
      if (!line.includes('=') && !line.startsWith('[')) { marker = line; continue; }
      warnings.push(`o arquivo não começa com um marcador simples; primeira linha: ${line}`);
    }

    if (matrixLines.length || looksLikeMatrixRow(line)) {
      matrixLines.push({ line, sourceLine });
      continue;
    }

    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      current = { name: section[1]!, entries: [], bareLines: [], sourceLine };
      sections.push(current);
      continue;
    }

    const separator = line.indexOf('=');
    if (separator < 0) {
      if (current) current.bareLines.push(line);
      else warnings.push(`linha ${sourceLine} fora de qualquer seção e sem "=": ${line}`);
      continue;
    }
    const entry: TabFileEntry = {
      key: line.slice(0, separator).trim(),
      value: line.slice(separator + 1).trim(),
      sourceLine,
    };
    (current ? current.entries : preamble).push(entry);
  }

  const matrix = readMatrix(matrixLines.map((item) => item.line), warnings);
  return {
    version: 1,
    marker,
    preamble,
    sections,
    matrix: matrix?.matrix ?? null,
    totals: matrix?.totals ?? { columnTotals: null, rowTotals: null, grandTotal: null },
    warnings,
  };
}

function readMatrix(
  rows: string[],
  warnings: string[],
): { matrix: TabFileMatrix; totals: TabFileTotals } | null {
  if (!rows.length) {
    warnings.push('o arquivo não traz matriz de resultado');
    return null;
  }
  const header = splitRow(rows[0]!);
  const body = rows.slice(1).map(splitRow);

  const ragged = body.filter((row) => row.length !== header.length).length;
  if (ragged) warnings.push(`${ragged} linha(s) com número de colunas diferente do cabeçalho`);

  // Totals are identified by label, never by position.
  const totalColumn = header.lastIndexOf(TOTAL_LABEL);
  const totalRow = body.findIndex((row) => row[0] === TOTAL_LABEL);
  if (totalColumn < 1) warnings.push('nenhuma coluna rotulada "Total" — os totais do TabWin não foram encontrados');
  if (totalRow < 0) warnings.push('nenhuma linha rotulada "Total" — os totais do TabWin não foram encontrados');

  const keptColumns = header
    .map((label, index) => ({ label, index }))
    .slice(1)
    .filter((column) => column.index !== totalColumn);
  const keptRows = body.filter((_, index) => index !== totalRow);

  const grandTotal = totalRow >= 0 && totalColumn >= 0
    ? body[totalRow]![totalColumn] ?? null
    : null;

  return {
    matrix: {
      cornerLabel: header[0] ?? '',
      columnLabels: keptColumns.map((column) => column.label),
      rowLabels: keptRows.map((row) => row[0] ?? ''),
      cells: keptRows.map((row) => keptColumns.map((column) => row[column.index] ?? '')),
    },
    totals: {
      columnTotals: totalRow >= 0
        ? keptColumns.map((column) => body[totalRow]![column.index] ?? '')
        : null,
      rowTotals: totalColumn >= 0
        ? keptRows.map((row) => row[totalColumn] ?? '')
        : null,
      grandTotal,
    },
  };
}

/** Convenience lookup across the preamble and every section. */
export function tabFileValue(document: TabFileDocument, key: string): string | undefined {
  const wanted = key.toLowerCase();
  const match = (entries: TabFileEntry[]): TabFileEntry | undefined =>
    entries.find((entry) => entry.key.toLowerCase() === wanted);
  const found = match(document.preamble)
    ?? document.sections.map((section) => match(section.entries)).find(Boolean);
  return found?.value;
}

/**
 * Reads a matrix cell as a number.
 *
 * Returns `null` rather than `NaN` or `0` for anything unreadable: a `.TAB`
 * cell that cannot be read is an unknown, and inventing a zero for it would
 * be the exact failure this project refuses everywhere else.
 */
export function tabFileNumber(cell: string): number | null {
  const text = cell.trim();
  if (!text) return null;
  // Only the integer form is evidenced so far. A comma is unambiguous pt-BR
  // decimal notation, so dots alongside it are grouping and get stripped. A
  // lone dot is left as a decimal point: stripping it unconditionally would
  // silently turn 1.5 into 15, which is worse than any parse failure.
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
