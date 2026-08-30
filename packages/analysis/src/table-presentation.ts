import type { TabulationResult } from '../../core/src/model.js';

export interface TableSort {
  columnKey: '__row_key__' | string;
  direction: 'original' | 'ascending' | 'descending';
}

function searchable(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

/** Returns a presentation index without changing row/cell order in the analytical result. */
export function tableRowIndexes(
  result: TabulationResult,
  sort: TableSort = { columnKey: '__row_key__', direction: 'original' },
  query = '',
): number[] {
  const needle = searchable(query);
  const indexes = result.rows
    .map((_, index) => index)
    .filter((index) => !needle || searchable(`${result.rows[index]?.key ?? ''} ${result.rows[index]?.label ?? ''}`).includes(needle));
  if (sort.direction === 'original') return indexes;
  const multiplier = sort.direction === 'ascending' ? 1 : -1;
  const columnIndex = sort.columnKey === '__row_key__'
    ? -1 : result.columns.findIndex((column) => column.key === sort.columnKey);
  if (columnIndex < 0 && sort.columnKey !== '__row_key__') throw new Error(`table sort references missing column: ${sort.columnKey}`);
  return indexes.sort((leftIndex, rightIndex) => {
    let comparison: number;
    if (columnIndex < 0) {
      comparison = (result.rows[leftIndex]?.label ?? '').localeCompare(result.rows[rightIndex]?.label ?? '', 'pt-BR', {
        numeric: true, sensitivity: 'base',
      });
    } else {
      comparison = (result.cells[leftIndex]?.[columnIndex] ?? 0) - (result.cells[rightIndex]?.[columnIndex] ?? 0);
    }
    return comparison * multiplier || leftIndex - rightIndex;
  });
}

export function tableRowsToTsv(
  result: TabulationResult,
  rowIndexes: readonly number[],
  options: { rowLabel: string; includeKey: boolean },
): string {
  const escape = (value: unknown): string => String(value ?? '').replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ');
  const lines = [
    [...(options.includeKey ? [options.rowLabel] : []), ...result.columns.map((column) => column.label)].map(escape).join('\t'),
  ];
  for (const rowIndex of rowIndexes) {
    lines.push([
      ...(options.includeKey ? [result.rows[rowIndex]?.label ?? ''] : []),
      ...(result.cells[rowIndex] ?? []),
    ].map(escape).join('\t'));
  }
  return lines.join('\r\n');
}
