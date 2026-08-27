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
      value = evaluateTableExpression(expression!, cells, operation.divisionByZero, rowIndex);
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
  return {
    result,
    audit: {
      operation,
      compatibility: 'modern-explicit-policy',
      inputColumnCount: source.columns.length,
      outputColumnCount: result.columns.length,
      rowCount: result.rows.length,
    },
  };
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
