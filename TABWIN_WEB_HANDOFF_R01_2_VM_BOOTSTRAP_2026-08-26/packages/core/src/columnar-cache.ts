/**
 * Dictionary-encoded projected column store and bounded L2 cache.
 *
 * This layer deliberately optimizes *storage/reuse*, not semantics. Records
 * reconstructed from the store are still executed by the reference kernel,
 * so every plan feature (CNV, lookups, cross-field rules, totals) keeps one
 * implementation. A future direct columnar executor must prove equality with
 * this path before replacing it.
 */

import type { ConversionRegistry } from './execute.js';
import { executeInMemory } from './execute.js';
import type { DataRecord, QueryPlan, TabulationResult } from './model.js';
import { fieldsUsedByPlan } from './plan-fields.js';

const DEFAULT_CHUNK_ROWS = 65_536;
const DEFAULT_CACHE_ENTRIES = 4;

type EncodedIndexChunk = Uint16Array | Uint32Array;

type DictionaryValue = null | undefined | string | number | boolean | Date;

export interface ColumnarDictionaryColumn {
  field: string;
  dictionary: readonly DictionaryValue[];
  indexWidth: 2 | 4;
  chunks: readonly EncodedIndexChunk[];
  rowCount: number;
  estimatedBytes: number;
}

export interface ColumnarProjection {
  readonly fields: readonly string[];
  readonly rowCount: number;
  readonly estimatedBytes: number;
  readonly columns: ReadonlyMap<string, ColumnarDictionaryColumn>;
  recordAt(index: number): DataRecord;
  records(): Iterable<DataRecord>;
  /** Zero-copy field view over the same encoded columns. */
  select(fields: readonly string[]): ColumnarProjection;
}

export interface ColumnarProjectionBuilder {
  push(records: Iterable<DataRecord>): void;
  finish(): ColumnarProjection;
  readonly rowCount: number;
}

export interface ColumnarProjectionCache {
  /** Returns an exact projection or a zero-copy view from the smallest cached superset. */
  get(sourceId: string, fields: readonly string[]): ColumnarProjection | undefined;
  set(sourceId: string, projection: ColumnarProjection): void;
  deleteSource(sourceId: string): void;
  clear(): void;
  readonly size: number;
}

interface MutableColumn {
  field: string;
  dictionary: DictionaryValue[];
  indexByKey: Map<string, number>;
  chunks: Uint32Array[];
  active: Uint32Array;
  activeLength: number;
}

function normalizedFields(fields: readonly string[]): string[] {
  const normalized = [...new Set(fields.map((field) => field.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!normalized.length) throw new Error('columnar projection requires at least one field');
  return normalized;
}

function cloneDictionaryValue(value: unknown): DictionaryValue {
  if (value === null || value === undefined || typeof value === 'string'
    || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return new Date(value.getTime());
  throw new Error(`columnar projection does not support value type ${Object.prototype.toString.call(value)}`);
}

function valueKey(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'boolean') return `b:${value ? 1 : 0}`;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'n:NaN';
    if (Object.is(value, -0)) return 'n:-0';
    return `n:${String(value)}`;
  }
  if (value instanceof Date) return `d:${value.getTime()}`;
  throw new Error(`columnar projection does not support value type ${Object.prototype.toString.call(value)}`);
}

function createMutableColumn(field: string, chunkRows: number): MutableColumn {
  return {
    field,
    dictionary: [],
    indexByKey: new Map(),
    chunks: [],
    active: new Uint32Array(chunkRows),
    activeLength: 0,
  };
}

function dictionaryIndex(column: MutableColumn, value: unknown): number {
  const key = valueKey(value);
  const existing = column.indexByKey.get(key);
  if (existing !== undefined) return existing;
  const index = column.dictionary.length;
  if (index >= 0xffff_ffff) throw new Error(`dictionary for ${column.field} exceeds Uint32 capacity`);
  column.dictionary.push(cloneDictionaryValue(value));
  column.indexByKey.set(key, index);
  return index;
}

function appendIndex(column: MutableColumn, index: number): void {
  if (column.activeLength >= column.active.length) {
    column.chunks.push(column.active);
    column.active = new Uint32Array(column.active.length);
    column.activeLength = 0;
  }
  column.active[column.activeLength++] = index;
}

function dictionaryEstimatedBytes(dictionary: readonly DictionaryValue[]): number {
  let bytes = 0;
  for (const value of dictionary) {
    if (typeof value === 'string') bytes += value.length * 2;
    else if (typeof value === 'number' || value instanceof Date) bytes += 8;
    else bytes += 1;
  }
  return bytes;
}

function finalizeColumn(column: MutableColumn, rowCount: number): ColumnarDictionaryColumn {
  const chunks = [...column.chunks];
  if (column.activeLength) chunks.push(column.active.subarray(0, column.activeLength));
  const use16 = column.dictionary.length <= 65_536;
  const compact: EncodedIndexChunk[] = use16
    ? chunks.map((chunk) => Uint16Array.from(chunk))
    : chunks.map((chunk) => Uint32Array.from(chunk));
  const indexBytes = compact.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  return {
    field: column.field,
    dictionary: column.dictionary,
    indexWidth: use16 ? 2 : 4,
    chunks: compact,
    rowCount,
    estimatedBytes: indexBytes + dictionaryEstimatedBytes(column.dictionary),
  };
}

function valueAt(column: ColumnarDictionaryColumn, index: number, chunkRows: number): DictionaryValue {
  const chunkIndex = Math.floor(index / chunkRows);
  const within = index % chunkRows;
  const dictionaryIndexValue = column.chunks[chunkIndex]?.[within];
  if (dictionaryIndexValue === undefined) throw new Error(`column ${column.field} has no row ${index}`);
  return column.dictionary[dictionaryIndexValue];
}

function makeProjection(
  fields: readonly string[],
  rowCount: number,
  columns: ReadonlyMap<string, ColumnarDictionaryColumn>,
  chunkRows: number,
): ColumnarProjection {
  const estimatedBytes = [...columns.values()].reduce((sum, column) => sum + column.estimatedBytes, 0);
  const fieldList = [...fields];
  const recordAt = (index: number): DataRecord => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= rowCount) throw new Error(`columnar row index ${index} is out of range`);
    const record: DataRecord = {};
    for (const field of fieldList) {
      const column = columns.get(field);
      if (!column) throw new Error(`columnar field ${field} is unavailable`);
      record[field] = valueAt(column, index, chunkRows);
    }
    return record;
  };
  return {
    fields: fieldList,
    rowCount,
    estimatedBytes,
    columns,
    recordAt,
    *records(): Iterable<DataRecord> {
      for (let index = 0; index < rowCount; index++) yield recordAt(index);
    },
    select(requested: readonly string[]): ColumnarProjection {
      const selected = normalizedFields(requested);
      const next = new Map<string, ColumnarDictionaryColumn>();
      for (const field of selected) {
        const column = columns.get(field);
        if (!column) throw new Error(`columnar field ${field} is unavailable`);
        next.set(field, column);
      }
      return makeProjection(selected, rowCount, next, chunkRows);
    },
  };
}

export function createColumnarProjectionBuilder(
  fields: readonly string[],
  options: { chunkRows?: number } = {},
): ColumnarProjectionBuilder {
  const fieldList = normalizedFields(fields);
  const chunkRows = options.chunkRows ?? DEFAULT_CHUNK_ROWS;
  if (!Number.isSafeInteger(chunkRows) || chunkRows < 256 || chunkRows > 1_000_000) {
    throw new Error('columnar chunkRows must be an integer between 256 and 1000000');
  }
  const mutable = new Map(fieldList.map((field) => [field, createMutableColumn(field, chunkRows)]));
  let rowCount = 0;
  let finished = false;

  return {
    push(records) {
      if (finished) throw new Error('columnar projection builder is already finished');
      for (const record of records) {
        for (const field of fieldList) {
          const column = mutable.get(field)!;
          appendIndex(column, dictionaryIndex(column, record[field]));
        }
        rowCount++;
      }
    },
    finish() {
      if (finished) throw new Error('columnar projection builder is already finished');
      finished = true;
      const columns = new Map<string, ColumnarDictionaryColumn>();
      for (const field of fieldList) columns.set(field, finalizeColumn(mutable.get(field)!, rowCount));
      return makeProjection(fieldList, rowCount, columns, chunkRows);
    },
    get rowCount() { return rowCount; },
  };
}

export function buildColumnarProjection(
  records: Iterable<DataRecord>,
  fields: readonly string[],
  options: { chunkRows?: number } = {},
): ColumnarProjection {
  const builder = createColumnarProjectionBuilder(fields, options);
  builder.push(records);
  return builder.finish();
}

/** Semantic-proof path: reconstruction feeds the exact reference executor. */
export function executeColumnarProjection(
  projection: ColumnarProjection,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): TabulationResult {
  const required = fieldsUsedByPlan(plan);
  const available = new Set(projection.fields);
  const missing = required.filter((field) => !available.has(field));
  if (missing.length) throw new Error(`columnar projection is missing plan field(s): ${missing.join(', ')}`);
  return executeInMemory(projection.select(required).records(), plan, conversions);
}

function fieldKey(fields: readonly string[]): string {
  return normalizedFields(fields).join('\u0000');
}

interface CacheEntry {
  sourceId: string;
  fields: string[];
  projection: ColumnarProjection;
}

export function createColumnarProjectionCache(maxEntries = DEFAULT_CACHE_ENTRIES): ColumnarProjectionCache {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100) {
    throw new Error('columnar cache size must be an integer between 1 and 100');
  }
  const entries = new Map<string, CacheEntry>();
  const keyFor = (sourceId: string, fields: readonly string[]): string => `${sourceId}\n${fieldKey(fields)}`;
  const touch = (key: string, entry: CacheEntry): void => {
    entries.delete(key);
    entries.set(key, entry);
  };

  return {
    get(sourceId, fields) {
      const cleanSource = sourceId.trim();
      if (!cleanSource) throw new Error('columnar cache sourceId cannot be empty');
      const requested = normalizedFields(fields);
      const exactKey = keyFor(cleanSource, requested);
      const exact = entries.get(exactKey);
      if (exact) {
        touch(exactKey, exact);
        return exact.projection;
      }
      const wanted = new Set(requested);
      let best: { key: string; entry: CacheEntry } | undefined;
      for (const [key, entry] of entries) {
        if (entry.sourceId !== cleanSource) continue;
        const available = new Set(entry.fields);
        if (![...wanted].every((field) => available.has(field))) continue;
        if (!best || entry.fields.length < best.entry.fields.length) best = { key, entry };
      }
      if (!best) return undefined;
      touch(best.key, best.entry);
      return best.entry.projection.select(requested);
    },
    set(sourceId, projection) {
      const cleanSource = sourceId.trim();
      if (!cleanSource) throw new Error('columnar cache sourceId cannot be empty');
      const fields = normalizedFields(projection.fields);
      const key = keyFor(cleanSource, fields);
      touch(key, { sourceId: cleanSource, fields, projection });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    deleteSource(sourceId) {
      for (const [key, entry] of entries) if (entry.sourceId === sourceId) entries.delete(key);
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
}
