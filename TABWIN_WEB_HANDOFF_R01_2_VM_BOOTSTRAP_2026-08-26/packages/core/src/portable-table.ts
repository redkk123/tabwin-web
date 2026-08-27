import type { QueryPlan, ResultAxisItem, SourceFingerprint, TableOperation, TabulationResult } from './model.js';
import { compileQueryPlan } from './plan.js';
import { stableJson, validateTableOperation } from './recipe.js';

export interface PortableTableV1 {
  schema: 'tabwin-web.table';
  version: 1;
  title: string;
  rowLabel: string;
  createdAt: string;
  source?: Pick<SourceFingerprint, 'name' | 'sha256' | 'size'>;
  plan: QueryPlan;
  baseResult: TabulationResult;
  operations: TableOperation[];
  presentation?: {
    sortColumnKey: string;
    sortDirection: 'original' | 'ascending' | 'descending';
    decimalPlaces: number;
    keyVisible: boolean;
  };
}

function validateAxis(value: unknown, name: string): asserts value is ResultAxisItem[] {
  if (!Array.isArray(value)) throw new Error(`invalid ${name} axis in TabWin Web table`);
  const keys = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error(`invalid ${name} item in TabWin Web table`);
    const axis = item as Partial<ResultAxisItem>;
    if (typeof axis.key !== 'string' || !axis.key || typeof axis.label !== 'string'
      || !new Set(['raw', 'conversion', 'derived']).has(String(axis.source))) {
      throw new Error(`invalid ${name} item in TabWin Web table`);
    }
    if ((axis.subtotalTargetKey !== undefined && typeof axis.subtotalTargetKey !== 'string')
      || (axis.excludeFromTotal !== undefined && typeof axis.excludeFromTotal !== 'boolean')
      || (axis.totalPolicy !== undefined && !new Set([
        'none', 'sum', 'product', 'mean', 'initial', 'final', 'min', 'max', 'precalculated',
      ]).has(axis.totalPolicy))) {
      throw new Error(`invalid ${name} metadata in TabWin Web table`);
    }
    if (keys.has(axis.key)) throw new Error(`duplicate ${name} key in TabWin Web table: ${axis.key}`);
    keys.add(axis.key);
  }
}

function validateResult(value: unknown): asserts value is TabulationResult {
  if (!value || typeof value !== 'object') throw new Error('invalid result in TabWin Web table');
  const result = value as Partial<TabulationResult>;
  validateAxis(result.rows, 'row');
  validateAxis(result.columns, 'column');
  if (!Array.isArray(result.cells) || result.cells.length !== result.rows.length) {
    throw new Error('result row/cell shape mismatch in TabWin Web table');
  }
  for (const row of result.cells) {
    if (!Array.isArray(row) || row.length !== result.columns.length || row.some((cell) => typeof cell !== 'number' || !Number.isFinite(cell))) {
      throw new Error('invalid or non-finite result cell in TabWin Web table');
    }
  }
  if (!Array.isArray(result.warnings) || result.warnings.some((warning) => typeof warning !== 'string')) {
    throw new Error('invalid result warnings in TabWin Web table');
  }
  for (const count of [result.recordsSeen, result.recordsAccepted]) {
    if (!Number.isInteger(count) || Number(count) < 0) throw new Error('invalid record count in TabWin Web table');
  }
  if (Number(result.recordsAccepted) > Number(result.recordsSeen)) {
    throw new Error('accepted record count exceeds seen records in TabWin Web table');
  }
}

export function serializePortableTable(table: PortableTableV1): string {
  return stableJson(table);
}

export function parsePortableTable(json: string): PortableTableV1 {
  const value = JSON.parse(json) as Partial<PortableTableV1>;
  if (value.schema !== 'tabwin-web.table' || value.version !== 1
    || typeof value.title !== 'string' || !value.title.trim()
    || typeof value.rowLabel !== 'string' || !value.rowLabel.trim()
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || !value.plan || value.plan.version !== 1) {
    throw new Error('unsupported or invalid TabWin Web table');
  }
  compileQueryPlan(value.plan.spec);
  if (!Array.isArray(value.plan.warnings) || value.plan.warnings.some((warning) => typeof warning !== 'string')) {
    throw new Error('invalid QueryPlan warnings in TabWin Web table');
  }
  validateResult(value.baseResult);
  if (!Array.isArray(value.operations)) throw new Error('invalid operations in TabWin Web table');
  for (const operation of value.operations) validateTableOperation(operation);
  if (value.source !== undefined && (!value.source || typeof value.source.name !== 'string'
    || typeof value.source.sha256 !== 'string' || typeof value.source.size !== 'number'
    || !Number.isFinite(value.source.size) || value.source.size < 0)) {
    throw new Error('invalid source fingerprint in TabWin Web table');
  }
  if (value.presentation !== undefined) {
    const presentation = value.presentation;
    if (typeof presentation.sortColumnKey !== 'string'
      || !new Set(['original', 'ascending', 'descending']).has(presentation.sortDirection)
      || !Number.isInteger(presentation.decimalPlaces) || presentation.decimalPlaces < -1 || presentation.decimalPlaces > 6
      || typeof presentation.keyVisible !== 'boolean') {
      throw new Error('invalid presentation in TabWin Web table');
    }
  }
  return value as PortableTableV1;
}
