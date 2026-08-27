import { strToU8, zipSync } from 'fflate';
import type { TabulationResult } from '../../core/src/model.js';
import type { TabulationExportContext } from './tabulation.js';

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value--;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function textCell(reference: string, value: unknown, style = 0): string {
  return `<c r="${reference}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function numberCell(reference: string, value: number): string {
  if (!Number.isFinite(value)) throw new Error(`XLSX cannot encode a non-finite value at ${reference}`);
  return `<c r="${reference}"><v>${value}</v></c>`;
}

function worksheet(rows: string[], lastColumn: string, lastRow: number): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="A1:${lastColumn}${Math.max(1, lastRow)}"/>`,
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    `<sheetData>${rows.join('')}</sheetData>`,
    `<autoFilter ref="A1:${lastColumn}${Math.max(1, lastRow)}"/>`,
    '</worksheet>',
  ].join('');
}

export function tabulationToXlsx(result: TabulationResult, context: TabulationExportContext): Uint8Array {
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const headers = [context.rowLabel, ...result.columns.map((column) => column.label)];
  const tableRows = [
    `<row r="1">${headers.map((value, index) => textCell(`${columnName(index)}1`, value, 1)).join('')}</row>`,
    ...result.rows.map((row, rowIndex) => {
      const excelRow = rowIndex + 2;
      return `<row r="${excelRow}">${textCell(`A${excelRow}`, row.label)}${(result.cells[rowIndex] ?? [])
        .map((value, columnIndex) => numberCell(`${columnName(columnIndex + 1)}${excelRow}`, value)).join('')}</row>`;
    }),
  ];
  const auditPairs: Array<[string, string | number]> = [
    ['Fonte', context.sourceName], ['Gerado em', generatedAt], ['Registros lidos', result.recordsSeen],
    ['Registros aceitos', result.recordsAccepted], ['Linhas', result.rows.length], ['Colunas numéricas', result.columns.length],
    ['Avisos', result.warnings.join(' | ')],
  ];
  const auditRows = auditPairs.map(([key, value], index) => {
    const row = index + 1;
    return `<row r="${row}">${textCell(`A${row}`, key, index === 0 ? 1 : 0)}${typeof value === 'number'
      ? numberCell(`B${row}`, value) : textCell(`B${row}`, value)}</row>`;
  });

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tabela" sheetId="1" r:id="rId1"/><sheet name="Auditoria" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8(worksheet(tableRows, columnName(headers.length - 1), result.rows.length + 1)),
    'xl/worksheets/sheet2.xml': strToU8(worksheet(auditRows, 'B', auditRows.length)),
  };
  // ZIP stores local DOS timestamps. Constructing midnight UTC can cross into
  // 1979 in western time zones, which fflate correctly rejects. A local wall
  // clock value is both valid and byte-stable across environments.
  return zipSync(files, { level: 6, mtime: new Date(2000, 0, 1, 0, 0, 0) });
}
