import type { TabulationResult } from '../../core/src/model.js';

export interface TabulationExportContext {
  sourceName: string;
  rowLabel: string;
  generatedAt?: string;
}

function csvQuote(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function tabulationToCsv(result: TabulationResult, context: TabulationExportContext): string {
  const lines = [
    [context.rowLabel, ...result.columns.map((column) => column.label)].map(csvQuote).join(','),
    ...result.rows.map((row, index) =>
      [row.label, ...(result.cells[index] ?? [])].map(csvQuote).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

function xmlEscape(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function tabulationToXml(result: TabulationResult, context: TabulationExportContext): string {
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const columns = result.columns
    .map((column, index) => `    <column index="${index}" key="${xmlEscape(column.key)}" label="${xmlEscape(column.label)}" />`)
    .join('\n');
  const rows = result.rows.map((row, rowIndex) => {
    const cells = (result.cells[rowIndex] ?? [])
      .map((value, columnIndex) => `      <cell column="${columnIndex}">${xmlEscape(value)}</cell>`)
      .join('\n');
    return `    <row index="${rowIndex}" key="${xmlEscape(row.key)}" label="${xmlEscape(row.label)}">\n${cells}\n    </row>`;
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tabulation xmlns="https://github.com/redkk123/tabwin-web/schema/tabulation/1" version="1">',
    `  <provenance source="${xmlEscape(context.sourceName)}" generatedAt="${xmlEscape(generatedAt)}" />`,
    `  <dimension label="${xmlEscape(context.rowLabel)}" />`,
    '  <columns>',
    columns,
    '  </columns>',
    '  <rows>',
    rows,
    '  </rows>',
    `  <recordCounts seen="${result.recordsSeen}" accepted="${result.recordsAccepted}" />`,
    '</tabulation>',
    '',
  ].join('\n');
}

/** Portable, deterministic result export with provenance and analytical metadata. */
export function tabulationToJson(result: TabulationResult, context: TabulationExportContext): string {
  return `${JSON.stringify({
    schema: 'tabwin-web.tabulation',
    version: 1,
    provenance: {
      source: context.sourceName,
      generatedAt: context.generatedAt ?? new Date().toISOString(),
    },
    dimension: { label: context.rowLabel },
    result,
  }, null, 2)}\n`;
}
