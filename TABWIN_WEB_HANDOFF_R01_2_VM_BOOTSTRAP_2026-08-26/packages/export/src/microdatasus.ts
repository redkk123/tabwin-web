/**
 * Filtered, record-level CSV export inspired by the ergonomics of microdatasus.
 *
 * This is intentionally a thin projection/label/export layer over QueryPlan.
 * Record acceptance is delegated to `resolvePlanRecord`, so the subset exported
 * here is the same subset counted by the active tabulation. Fields may stay raw
 * or gain an explicit companion label derived from a loaded CNV/DBF lookup.
 * The encoder emits one bounded chunk per input batch and never retains source
 * records or the complete CSV in this package.
 */

import {
  resolveDimensionValue,
  resolvePlanRecord,
  type ConversionRegistry,
} from '../../core/src/execute.js';
import type { DataRecord, DimensionSpec, QueryPlan } from '../../core/src/model.js';
import { fieldsUsedByPlan } from '../../core/src/plan-fields.js';

export type MicrodatasusValueMode = 'raw' | 'label' | 'raw-and-label';

export interface MicrodatasusFieldSpec {
  /** Source field exactly as declared in the DBF schema. */
  field: string;
  /** Output header for the raw/value column; defaults to `field`. */
  outputName?: string;
  /** `label`/`raw-and-label` resolve this explicit dimension. */
  dimension?: DimensionSpec;
  /** Defaults to `raw` unless a dimension is provided, then `raw-and-label`. */
  valueMode?: MicrodatasusValueMode;
  /** Companion header used by `raw-and-label`; defaults to `<outputName>__ROTULO`. */
  labelOutputName?: string;
}

export interface MicrodatasusSourceContext {
  sourceName?: string;
  system?: string;
  fileType?: string;
  year?: string;
  month?: string;
  uf?: string;
}

export type MicrodatasusProvenanceColumn =
  | 'sourceName' | 'system' | 'fileType' | 'year' | 'month' | 'uf';

export interface MicrodatasusCsvOptions {
  delimiter?: ';' | ',' | '\t';
  includeBom?: boolean;
  provenanceColumns?: readonly MicrodatasusProvenanceColumn[];
  maxCellCharacters?: number;
}

export interface MicrodatasusCsvStats {
  recordsSeen: number;
  recordsAccepted: number;
  rowsEmitted: number;
  bytesEmitted: number;
}

export interface MicrodatasusCsvEncoder {
  /** Header including optional UTF-8 BOM. Call exactly once. */
  header(): Uint8Array;
  /** One bounded CSV chunk for one decoded record batch. */
  push(records: Iterable<DataRecord>, source?: MicrodatasusSourceContext): Uint8Array;
  finish(): MicrodatasusCsvStats;
}

const PROVENANCE_HEADERS: Record<MicrodatasusProvenanceColumn, string> = {
  sourceName: '__FONTE_ARQUIVO',
  system: '__SISTEMA',
  fileType: '__TIPO_ARQUIVO',
  year: '__ANO_FONTE',
  month: '__MES_FONTE',
  uf: '__UF_FONTE',
};

function normalizeFieldSpec(spec: MicrodatasusFieldSpec): Required<Pick<MicrodatasusFieldSpec, 'field' | 'outputName' | 'valueMode'>> & MicrodatasusFieldSpec {
  const field = spec.field.trim();
  if (!field) throw new Error('Microdatasus field cannot be empty');
  const outputName = (spec.outputName ?? field).trim();
  if (!outputName) throw new Error(`Microdatasus output name for ${field} cannot be empty`);
  const valueMode = spec.valueMode ?? (spec.dimension ? 'raw-and-label' : 'raw');
  if ((valueMode === 'label' || valueMode === 'raw-and-label') && !spec.dimension) {
    throw new Error(`Microdatasus field ${field} requires a dimension for ${valueMode}`);
  }
  if (spec.dimension && spec.dimension.field !== field) {
    throw new Error(`Microdatasus dimension for ${field} must resolve the same source field`);
  }
  return { ...spec, field, outputName, valueMode };
}

function uniqueProvenance(values: readonly MicrodatasusProvenanceColumn[] | undefined): MicrodatasusProvenanceColumn[] {
  const allowed = new Set<MicrodatasusProvenanceColumn>(['sourceName', 'system', 'fileType', 'year', 'month', 'uf']);
  const output: MicrodatasusProvenanceColumn[] = [];
  for (const value of values ?? []) {
    if (!allowed.has(value)) throw new Error(`Unsupported Microdatasus provenance column ${String(value)}`);
    if (!output.includes(value)) output.push(value);
  }
  return output;
}

function outputHeaders(fields: readonly ReturnType<typeof normalizeFieldSpec>[], provenance: readonly MicrodatasusProvenanceColumn[]): string[] {
  const headers = provenance.map((key) => PROVENANCE_HEADERS[key]);
  for (const field of fields) {
    if (field.valueMode !== 'label') headers.push(field.outputName);
    if (field.valueMode !== 'raw') headers.push((field.labelOutputName ?? `${field.outputName}__ROTULO`).trim());
  }
  const normalized = headers.map((header) => header.toLocaleUpperCase('pt-BR'));
  if (headers.some((header) => !header)) throw new Error('Microdatasus output header cannot be empty');
  if (new Set(normalized).size !== normalized.length) throw new Error('Microdatasus output headers must be unique');
  return headers;
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function csvCell(value: unknown, delimiter: string, maxCharacters: number): string {
  const text = scalar(value);
  if (text.length > maxCharacters) throw new Error(`Microdatasus cell exceeds ${maxCharacters} characters`);
  if (text.includes('"') || text.includes('\r') || text.includes('\n') || text.includes(delimiter)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function sourceValue(context: MicrodatasusSourceContext | undefined, key: MicrodatasusProvenanceColumn): string {
  return context?.[key] ?? '';
}

/** Fields that the DBC/DBF decoder must project for this export. */
export function fieldsUsedByMicrodatasusExport(
  plan: QueryPlan,
  fields: readonly MicrodatasusFieldSpec[],
): string[] {
  const used = new Set(fieldsUsedByPlan(plan));
  for (const raw of fields) {
    const spec = normalizeFieldSpec(raw);
    used.add(spec.field);
    if (spec.dimension?.field) used.add(spec.dimension.field);
  }
  return [...used];
}

export function createMicrodatasusCsvEncoder(
  plan: QueryPlan,
  fieldsInput: readonly MicrodatasusFieldSpec[],
  conversions: ConversionRegistry = {},
  options: MicrodatasusCsvOptions = {},
): MicrodatasusCsvEncoder {
  if (!fieldsInput.length) throw new Error('Microdatasus export requires at least one field');
  const fields = fieldsInput.map(normalizeFieldSpec);
  const provenance = uniqueProvenance(options.provenanceColumns);
  const headers = outputHeaders(fields, provenance);
  const delimiter = options.delimiter ?? ';';
  const maxCellCharacters = options.maxCellCharacters ?? 1_000_000;
  if (!Number.isSafeInteger(maxCellCharacters) || maxCellCharacters < 1 || maxCellCharacters > 10_000_000) {
    throw new Error('Microdatasus maxCellCharacters must be between 1 and 10000000');
  }
  const encoder = new TextEncoder();
  let headerWritten = false;
  let finished = false;
  let recordsSeen = 0;
  let recordsAccepted = 0;
  let rowsEmitted = 0;
  let bytesEmitted = 0;

  const encode = (text: string): Uint8Array => {
    const bytes = encoder.encode(text);
    bytesEmitted += bytes.byteLength;
    return bytes;
  };

  return {
    header() {
      if (headerWritten) throw new Error('Microdatasus header was already emitted');
      if (finished) throw new Error('Microdatasus encoder is already finished');
      headerWritten = true;
      const bom = options.includeBom === false ? '' : '\uFEFF';
      return encode(`${bom}${headers.map((header) => csvCell(header, delimiter, maxCellCharacters)).join(delimiter)}\r\n`);
    },
    push(records, source) {
      if (!headerWritten) throw new Error('Emit the Microdatasus header before data chunks');
      if (finished) throw new Error('Microdatasus encoder is already finished');
      const lines: string[] = [];
      for (const record of records) {
        recordsSeen++;
        if (!resolvePlanRecord(record, plan, conversions)) continue;
        recordsAccepted++;
        const values: unknown[] = provenance.map((key) => sourceValue(source, key));
        for (const field of fields) {
          if (field.valueMode !== 'label') values.push(record[field.field]);
          if (field.valueMode !== 'raw') {
            const resolved = resolveDimensionValue(record, field.dimension!, conversions);
            values.push(resolved.label ?? '');
          }
        }
        lines.push(values.map((value) => csvCell(value, delimiter, maxCellCharacters)).join(delimiter));
        rowsEmitted++;
      }
      return lines.length ? encode(`${lines.join('\r\n')}\r\n`) : new Uint8Array();
    },
    finish() {
      if (!headerWritten) throw new Error('Microdatasus header was not emitted');
      if (finished) throw new Error('Microdatasus encoder is already finished');
      finished = true;
      return { recordsSeen, recordsAccepted, rowsEmitted, bytesEmitted };
    },
  };
}
