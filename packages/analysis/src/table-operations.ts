import type {
  TabulationResult,
  TableOperation,
  TotalPolicy,
} from '../../core/src/model.js';
import { evaluateTableExpression, parseTableExpression } from './table-expression.js';

export interface TableOperationAudit {
  operation: TableOperation;
  compatibility: 'modern-explicit-policy';
  inputColumnCount: number;
  outputColumnCount: number;
  rowCount: number;
}

export function createIncludeTableOperation(
  source: TabulationResult,
  included: TabulationResult,
  sourceLabel: string,
): Extract<TableOperation, { kind: 'include-table' }> {
  const label = sourceLabel.trim();
  if (!label) throw new Error('included table requires a source label');
  const baseNamespace = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'included';
  let namespace = baseNamespace;
  let suffix = 2;
  while (source.columns.some((column) => column.key.startsWith(`${namespace}:`))) {
    namespace = `${baseNamespace}-${suffix++}`;
  }
  return {
    kind: 'include-table',
    sourceLabel: label,
    requireMatchingLabels: true,
    rows: included.rows.map((row) => ({ key: row.key, label: row.label })),
    columns: included.columns.map((column) => ({
      ...column,
      key: `${namespace}:${column.key}`,
      label: `${label} — ${column.label}`,
      source: 'derived',
    })),
    cells: included.cells.map((row) => [...row]),
  };
}

function columnIndex(result: TabulationResult, key: string): number {
  const index = result.columns.findIndex((column) => column.key === key);
  if (index < 0) throw new Error(`table operation references missing column: ${key}`);
  return index;
}

function finite(value: number, context: string): number {
  if (!Number.isFinite(value)) throw new Error(`table operation produced a non-finite value at ${context}`);
  return value;
}

function divide(numerator: number, denominator: number, policy: 'error' | 'zero', row: number): number {
  if (denominator !== 0) return numerator / denominator;
  if (policy === 'zero') return 0;
  throw new Error(`division by zero at result row ${row + 1}`);
}

export function applyTableOperation(
  source: TabulationResult,
  operation: TableOperation,
): { result: TabulationResult; audit: TableOperationAudit } {
  const structural = applyStructuralOperation(source, operation);
  if (structural) return withAudit(source, structural, operation);
  if (!('output' in operation)) throw new Error(`unsupported structural operation: ${operation.kind}`);
  if (!operation.output.key.trim() || !operation.output.label.trim()) {
    throw new Error('derived columns require a non-empty key and label');
  }
  if (source.columns.some((column) => column.key === operation.output.key)) {
    throw new Error(`derived column key already exists: ${operation.output.key}`);
  }
  if (source.cells.length !== source.rows.length) throw new Error('result row/cell shape is inconsistent');

  let running = 0;
  const leftIndex = operation.kind === 'binary' ? columnIndex(source, operation.leftColumnKey) : -1;
  const rightIndex = operation.kind === 'binary' ? columnIndex(source, operation.rightColumnKey) : -1;
  const sourceIndex = operation.kind === 'factor' || operation.kind === 'cumulative'
    || operation.kind === 'absolute' || operation.kind === 'integer'
    ? columnIndex(source, operation.sourceColumnKey)
    : -1;
  const expression = operation.kind === 'expression'
    ? parseTableExpression(source, operation.expression) : undefined;

  const values = source.cells.map((cells, rowIndex) => {
    let value: number;
    if (operation.kind === 'binary') {
      const left = cells[leftIndex] ?? 0;
      const right = cells[rightIndex] ?? 0;
      switch (operation.operator) {
        case 'add': value = left + right; break;
        case 'subtract': value = left - right; break;
        case 'multiply': value = left * right; break;
        case 'divide': value = divide(left, right, operation.divisionByZero, rowIndex); break;
        case 'minimum': value = Math.min(left, right); break;
        case 'maximum': value = Math.max(left, right); break;
        case 'percentage': value = divide(left, right, operation.divisionByZero, rowIndex) * 100; break;
      }
    } else if (operation.kind === 'factor') {
      value = (cells[sourceIndex] ?? 0) * operation.factor;
    } else if (operation.kind === 'cumulative') {
      running += cells[sourceIndex] ?? 0;
      value = running;
    } else if (operation.kind === 'absolute') {
      value = Math.abs(cells[sourceIndex] ?? 0);
    } else if (operation.kind === 'integer') {
      const input = cells[sourceIndex] ?? 0;
      value = operation.rounding === 'truncate' ? Math.trunc(input)
        : operation.rounding === 'round' ? Math.round(input)
          : operation.rounding === 'floor' ? Math.floor(input) : Math.ceil(input);
    } else if (operation.kind === 'sequence') {
      value = operation.start + operation.step * rowIndex;
    } else if (operation.kind === 'constant') {
      value = operation.value;
    } else {
      value = evaluateTableExpression(expression!, {
        cells, rowIndex, allCells: source.cells, divisionByZero: operation.divisionByZero,
      });
    }
    return finite(value, `row ${rowIndex + 1}`);
  });

  const result: TabulationResult = {
    ...source,
    rows: source.rows.map((row) => ({ ...row })),
    columns: [...source.columns.map((column) => ({ ...column })), {
      key: operation.output.key,
      label: operation.output.label,
      source: 'derived',
      totalPolicy: operation.output.totalPolicy,
    }],
    cells: source.cells.map((cells, index) => [...cells, values[index] ?? 0]),
    warnings: [...source.warnings],
  };
  return withAudit(source, result, operation);
}

function withAudit(source: TabulationResult, result: TabulationResult, operation: TableOperation) {
  return {
    result,
    audit: {
      operation,
      compatibility: 'modern-explicit-policy' as const,
      inputColumnCount: source.columns.length,
      outputColumnCount: result.columns.length,
      rowCount: result.rows.length,
    },
  };
}

function cloneResult(source: TabulationResult): TabulationResult {
  return {
    ...source,
    rows: source.rows.map((row) => ({ ...row })),
    columns: source.columns.map((column) => ({ ...column })),
    cells: source.cells.map((row) => [...row]),
    warnings: [...source.warnings],
  };
}

function applyStructuralOperation(source: TabulationResult, operation: TableOperation): TabulationResult | undefined {
  if (operation.kind === 'include-table') {
    if (!operation.sourceLabel.trim()) throw new Error('included table requires a source label');
    if (operation.rows.length !== operation.cells.length) throw new Error('included table row/cell shape is inconsistent');
    if (!operation.columns.length) throw new Error('included table must contain at least one column');
    const includedByKey = new Map<string, number>();
    operation.rows.forEach((row, index) => {
      if (!row.key) throw new Error('included table contains an empty row key');
      if (includedByKey.has(row.key)) throw new Error(`included table contains duplicate row key: ${row.key}`);
      includedByKey.set(row.key, index);
    });
    const sourceKeys = new Set(source.rows.map((row) => row.key));
    if (sourceKeys.size !== source.rows.length) throw new Error('source table contains duplicate row keys');
    if (source.rows.length !== operation.rows.length
      || operation.rows.some((row) => !sourceKeys.has(row.key))) {
      throw new Error('included table row keys must exactly match the current table');
    }
    const knownColumns = new Set(source.columns.map((column) => column.key));
    for (const column of operation.columns) {
      if (!column.key || !column.label) throw new Error('included table contains an invalid column');
      if (knownColumns.has(column.key)) throw new Error(`included table column key already exists: ${column.key}`);
      knownColumns.add(column.key);
    }
    for (const cells of operation.cells) {
      if (cells.length !== operation.columns.length || cells.some((value) => !Number.isFinite(value))) {
        throw new Error('included table contains an invalid or non-finite cell');
      }
    }
    const result = cloneResult(source);
    result.columns.push(...operation.columns.map((column) => ({ ...column })));
    result.cells = source.rows.map((row, sourceIndex) => {
      const includedIndex = includedByKey.get(row.key);
      if (includedIndex === undefined) throw new Error(`included table is missing row key: ${row.key}`);
      const includedRow = operation.rows[includedIndex]!;
      if (operation.requireMatchingLabels && includedRow.label !== row.label) {
        throw new Error(`included table row label differs for key ${row.key}`);
      }
      return [...(source.cells[sourceIndex] ?? []), ...(operation.cells[includedIndex] ?? [])];
    });
    result.warnings.push(`Table ${operation.sourceLabel} included by exact row key using a modern explicit policy`);
    return result;
  }
  if (operation.kind === 'transpose') {
    const result = cloneResult(source);
    result.rows = source.columns.map((column) => ({ ...column }));
    result.columns = source.rows.map((row) => ({ ...row }));
    result.cells = source.columns.map((_, columnIndex) =>
      source.rows.map((_, rowIndex) => source.cells[rowIndex]?.[columnIndex] ?? 0));
    return result;
  }
  if (operation.kind === 'rename-column') {
    if (!operation.label.trim()) throw new Error('renamed column requires a non-empty label');
    const index = columnIndex(source, operation.columnKey);
    const result = cloneResult(source);
    result.columns[index] = { ...result.columns[index]!, label: operation.label.trim() };
    return result;
  }
  if (operation.kind === 'move-column') {
    const index = columnIndex(source, operation.columnKey);
    const target = operation.direction === 'left' ? index - 1 : index + 1;
    if (target < 0 || target >= source.columns.length) throw new Error(`column cannot move ${operation.direction}`);
    const order = source.columns.map((_, position) => position);
    [order[index], order[target]] = [order[target]!, order[index]!];
    const result = cloneResult(source);
    result.columns = order.map((position) => ({ ...source.columns[position]! }));
    result.cells = source.cells.map((cells) => order.map((position) => cells[position] ?? 0));
    return result;
  }
  if (operation.kind === 'delete-column') {
    const index = columnIndex(source, operation.columnKey);
    if (source.columns.length <= 1) throw new Error('table must retain at least one numeric column');
    const result = cloneResult(source);
    result.columns.splice(index, 1);
    result.cells.forEach((cells) => cells.splice(index, 1));
    return result;
  }
  if (operation.kind === 'suppress-rows') {
    const keys = new Set(operation.rowKeys);
    if (!keys.size) throw new Error('row suppression requires at least one key');
    const known = source.rows.filter((row) => keys.has(row.key)).length;
    if (!known) throw new Error('row suppression does not match any result row');
    const keep = source.rows.map((row) => !keys.has(row.key));
    const result = cloneResult(source);
    result.rows = result.rows.filter((_, index) => keep[index]);
    result.cells = result.cells.filter((_, index) => keep[index]);
    return result;
  }
  if (operation.kind === 'aggregate-rows') {
    const keys = new Set(operation.rowKeys);
    if (!keys.size) throw new Error('row aggregation requires at least one key');
    if (!operation.outputRow.key.trim() || !operation.outputRow.label.trim()) throw new Error('aggregate row requires a key and label');
    if (source.rows.some((row) => row.key === operation.outputRow.key)) throw new Error(`aggregate row key already exists: ${operation.outputRow.key}`);
    const indexes = source.rows.map((row, index) => keys.has(row.key) ? index : -1).filter((index) => index >= 0);
    if (!indexes.length) throw new Error('row aggregation does not match any result row');
    const aggregate = source.columns.map((_, column) =>
      indexes.reduce((sum, row) => sum + (source.cells[row]?.[column] ?? 0), 0));
    const result = cloneResult(source);
    if (operation.removeSources) {
      result.rows = result.rows.filter((row) => !keys.has(row.key));
      result.cells = result.cells.filter((_, index) => !indexes.includes(index));
    }
    result.rows.push({
      key: operation.outputRow.key,
      label: operation.outputRow.label,
      source: 'derived',
      ...(operation.outputRow.excludeFromTotal ? { excludeFromTotal: true } : {}),
    });
    result.cells.push(aggregate);
    return result;
  }
  return undefined;
}

export function replayTableOperations(source: TabulationResult, operations: readonly TableOperation[]): TabulationResult {
  return operations.reduce((result, operation) => applyTableOperation(result, operation).result, source);
}

export function calculateColumnTotal(
  result: TabulationResult,
  columnKey: string,
  policy: Exclude<TotalPolicy, 'precalculated'> = 'sum',
): number | undefined {
  if (policy === 'none') return undefined;
  const index = columnIndex(result, columnKey);
  const values = result.cells
    .filter((_, rowIndex) => !result.rows[rowIndex]?.excludeFromTotal)
    .map((row) => row[index] ?? 0);
  if (!values.length) return 0;
  switch (policy) {
    case 'sum': return values.reduce((sum, value) => sum + value, 0);
    case 'product': return values.reduce((product, value) => product * value, 1);
    case 'mean': return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'initial': return values[0];
    case 'final': return values.at(-1);
    case 'min': return Math.min(...values);
    case 'max': return Math.max(...values);
  }
}
