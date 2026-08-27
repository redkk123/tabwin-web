export interface DelimitedField {
  name: string;
  type: 'C' | 'N';
  length: number;
  decimalCount: number;
}

export interface DelimitedDataset {
  delimiter: ',' | ';' | '\t';
  fields: DelimitedField[];
  records: Array<Record<string, string | number | null>>;
}

export interface ParseDelimitedOptions {
  delimiter?: ',' | ';' | '\t';
  maxRows?: number;
  maxColumns?: number;
  maxCellCharacters?: number;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count++;
  }
  return count;
}

function firstLogicalLine(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (text[index] === '\r' || text[index] === '\n')) {
      return text.slice(0, index);
    }
  }
  return text;
}

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const line = firstLogicalLine(text);
  const candidates = [',', ';', '\t'] as const;
  const ranked = candidates.map((delimiter) => ({ delimiter, count: countOutsideQuotes(line, delimiter) }))
    .sort((a, b) => b.count - a.count);
  if (!ranked[0]?.count) throw new Error('CSV header must contain at least two columns');
  if (ranked[1]?.count === ranked[0].count) throw new Error('CSV delimiter is ambiguous; use comma, semicolon or tab consistently');
  return ranked[0].delimiter;
}

function parseRows(
  source: string,
  delimiter: string,
  maxRows: number,
  maxColumns: number,
  maxCellCharacters: number,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let afterQuote = false;
  const pushCell = () => {
    if (cell.length > maxCellCharacters) throw new Error('CSV cell exceeds the configured safety limit');
    row.push(cell);
    if (row.length > maxColumns) throw new Error('CSV exceeds the configured column limit');
    cell = '';
    afterQuote = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.length > 1 || row.some((value) => value.length > 0)) rows.push(row);
    row = [];
    if (rows.length > maxRows + 1) throw new Error('CSV exceeds the configured row limit');
  };

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { cell += '"'; index++; }
        else { quoted = false; afterQuote = true; }
      } else cell += char;
      continue;
    }
    if (char === '"' && cell.length === 0 && !afterQuote) { quoted = true; continue; }
    if (char === delimiter) { pushCell(); continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      pushRow();
      continue;
    }
    if (afterQuote && !/\s/.test(char)) throw new Error('CSV has characters after a closing quote');
    if (!afterQuote) cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field');
  if (cell.length || row.length) pushRow();
  return rows;
}

function numericValue(value: string, delimiter: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[+-]?0\d/.test(trimmed)) return undefined;
  const pattern = delimiter === ';' ? /^[+-]?(?:\d+|\d+[.,]\d+|[.,]\d+)$/ : /^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/;
  if (!pattern.test(trimmed)) return undefined;
  const number = Number(trimmed.replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}

export function parseDelimited(text: string, options: ParseDelimitedOptions = {}): DelimitedDataset {
  const source = text.replace(/^\uFEFF/, '');
  const delimiter = options.delimiter ?? detectDelimiter(source);
  const rows = parseRows(source, delimiter, options.maxRows ?? 2_000_000,
    options.maxColumns ?? 512, options.maxCellCharacters ?? 1_000_000);
  const rawHeaders = rows.shift();
  if (!rawHeaders?.length) throw new Error('CSV is empty');
  const headers = rawHeaders.map((value, index) => value.trim() || `COLUNA_${index + 1}`);
  const normalized = headers.map((value) => value.toLocaleUpperCase('pt-BR'));
  if (new Set(normalized).size !== normalized.length) throw new Error('CSV contains duplicate column names');
  if (!rows.length) throw new Error('CSV has no data rows');
  for (let index = 0; index < rows.length; index++) {
    if (rows[index]?.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${rows[index]?.length ?? 0} columns; expected ${headers.length}`);
    }
  }

  const numeric = headers.map((_, column) => {
    const populated = rows.map((row) => row[column] ?? '').filter((value) => value.trim() !== '');
    return populated.length > 0 && populated.every((value) => numericValue(value, delimiter) !== undefined);
  });
  const records = rows.map((row) => Object.fromEntries(headers.map((header, column) => {
    const raw = row[column] ?? '';
    if (!raw.trim()) return [header, null];
    return [header, numeric[column] ? numericValue(raw, delimiter)! : raw];
  })));
  const fields = headers.map((name, column): DelimitedField => {
    if (numeric[column]) {
      const decimals = Math.min(15, Math.max(0, ...rows.map((row) => {
        const raw = (row[column] ?? '').trim().replace(',', '.');
        return raw.includes('.') ? raw.length - raw.indexOf('.') - 1 : 0;
      })));
      const length = Math.min(20, Math.max(1, ...rows.map((row) => (row[column] ?? '').trim().length)));
      return { name, type: 'N', length, decimalCount: decimals };
    }
    const length = Math.min(254, Math.max(1, ...rows.map((row) => (row[column] ?? '').length)));
    return { name, type: 'C', length, decimalCount: 0 };
  });
  return { delimiter, fields, records };
}
