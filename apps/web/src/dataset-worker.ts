/**
 * Owns the opened dataset so the main thread never holds records.
 *
 * Every consumer that used to read a resident record array — tabulation,
 * numeric profiling, the filter value list, selected-record export — asks this
 * Worker instead, and each request is answered by streaming the retained
 * sources in bounded batches. There is no separate path for large files: the
 * same code serves a 300 KiB SIH file and the 63 MiB national Dengue file.
 *
 * The measured reason this works: decoding records into JavaScript objects is
 * about 91% of the cost of opening a DBC, and a tabulation reads a handful of
 * the hundred-odd declared fields. Every request therefore projects to the
 * fields it actually needs.
 */

import {
  readDbcMetadata,
  readDbfHeader,
  type DbfField,
  type DbfHeader,
  type DbfRecord,
} from '@precisa-saude/datasus-dbc';
import {
  streamDbcRecords,
  streamDbfRecords,
  type DbfRecordBatch,
} from '../../../packages/acquisition/src/dbf-record-stream.ts';
import {
  createTabulationAccumulator,
  matchesFilters,
  type ConversionRegistry,
} from '../../../packages/core/src/execute.ts';
import { fieldsUsedByPlan } from '../../../packages/core/src/plan-fields.ts';
import {
  createFlowAccumulator,
  type FlowBuildResult,
} from '../../../packages/analysis/src/spatial-flows.ts';
import {
  createAuditScanAccumulator,
  type AuditScanResult,
} from '../../../packages/analysis/src/anomaly-orchestrator.ts';
import {
  applyTransformPipeline,
  type TransformStep,
  type TransformStepResult,
} from '../../../packages/analysis/src/transform-pipeline.ts';
import { createTabulationResultCache } from '../../../packages/core/src/tabulation-cache.ts';
import type {
  CrossFieldRuleSpec,
  DataRecord,
  FilterSpec,
  QueryPlan,
  TabulationResult,
} from '../../../packages/core/src/model.ts';
import {
  createDistinctValueCollector,
  createFieldCombinationProfiler,
  createNumericFieldProfiler,
  type FieldCombinationProfile,
  type NumericFieldProfile,
} from '../../../packages/analysis/src/data-quality.ts';
import { createSelectedRecordCollector } from '../../../packages/export/src/selected-records.ts';
import { writeDbf } from '../../../packages/export/src/dbf-writer.ts';
import {
  createMicrodatasusCsvEncoder,
  fieldsUsedByMicrodatasusExport,
  type MicrodatasusFieldSpec,
  type MicrodatasusProvenanceColumn,
  type MicrodatasusSourceContext,
} from '../../../packages/export/src/microdatasus.ts';

/** A source already parsed on the main thread, such as a CSV import. */
interface RecordSource {
  kind: 'records';
  name: string;
  records: DbfRecord[];
}

interface BinarySource {
  kind: 'binary';
  name: string;
  bytes: ArrayBuffer;
  isDbc: boolean;
}

type DatasetSource = RecordSource | BinarySource;

interface OpenRequest {
  type: 'open';
  requestId: number;
  sources: DatasetSource[];
  /** Declared fields for a record source, which carries no DBF header. */
  fields?: DbfField[];
}

interface TabulateRequest {
  type: 'tabulate';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
}

interface NumericProfileRequest {
  type: 'profile-numeric';
  requestId: number;
  field: string;
}

interface DistinctRequest {
  type: 'distinct';
  requestId: number;
  field: string;
  limit?: number;
}

interface CombinationProfileRequest {
  type: 'profile-combinations';
  requestId: number;
  fields: string[];
  limit?: number;
}

/**
 * Origin-destination aggregation runs here for the same reason tabulation
 * does: the main thread never holds records, and only three fields are read.
 */
interface FlowRequest {
  type: 'flows';
  requestId: number;
  originField: string;
  destinationField: string;
  weightField?: string;
  knownGeocodes?: string[];
  unknownPolicy?: 'exclude' | 'include';
}

interface SelectedDbfRequest {
  type: 'selected-dbf';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
}

interface MicrodatasusCsvRequest {
  type: 'microdatasus-csv';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
  fields: MicrodatasusFieldSpec[];
  provenanceColumns?: MicrodatasusProvenanceColumn[];
  sourceContexts?: MicrodatasusSourceContext[];
  maxBytes?: number;
}

/**
 * Statistical anomaly audit. `group` is a plain filter set, deliberately not
 * a QueryPlan - the group under investigation is independent of whatever is
 * being tabulated as rows or columns. Every other record accepted by the
 * open dataset is the reference.
 */
interface AuditScanRequest {
  type: 'audit-scan';
  requestId: number;
  groupFilters: FilterSpec[];
  groupCrossFieldRules?: CrossFieldRuleSpec[];
  conversions?: ConversionRegistry;
  numericFields: string[];
  categoricalFields: string[];
  geographyFields?: string[];
}

/** Adds a schema-compatible file to the open dataset without reopening it. */
interface AppendRequest {
  type: 'append';
  requestId: number;
  source: DatasetSource;
}

/**
 * Materializes every currently retained source into memory, runs the
 * transform pipeline over it, and - on success - replaces the active dataset
 * with the result, exactly like `open`/`append` do. There is no in-place
 * variant: a binary (DBC/DBF) source is normally re-decoded from bytes on
 * every request rather than held resident, but a pipeline step can drop or
 * rewrite values in ways nothing downstream can undo, so its output has to
 * become the new resident source of truth, not a view over the old one.
 */
interface TransformApplyRequest {
  type: 'transform-apply';
  requestId: number;
  steps: TransformStep[];
  conversions?: ConversionRegistry;
}

type DatasetRequest =
  | OpenRequest | AppendRequest | TabulateRequest
  | NumericProfileRequest | CombinationProfileRequest | DistinctRequest | SelectedDbfRequest
  | FlowRequest | MicrodatasusCsvRequest | AuditScanRequest | TransformApplyRequest;

const workerScope: Worker = self as unknown as Worker;
const BATCH_RECORDS = 5_000;
const PROGRESS_INTERVAL_RECORDS = 20_000;

let sources: DatasetSource[] = [];
let header: DbfHeader | null = null;
/**
 * L3 cache: memoizes a finished tabulation by its exact plan and conversions.
 * Cleared on every 'open'/'append' — a cached result answers for the plan
 * *and* the data it ran over, so once the data changes, nothing in it is
 * still valid, not just the entries that look related.
 */
const resultCache = createTabulationResultCache();

function post(message: unknown, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

function reportProgress(requestId: number, recordsRead: number, recordCount: number): void {
  post({ type: 'progress', requestId, recordsRead, recordCount });
}

/**
 * Streams every retained source in order through one consumer.
 *
 * Multiple files are not concatenated anywhere: they are streamed one after
 * another into the same accumulator, which is both cheaper and closer to what
 * combining sources actually means.
 */
function streamAll(
  requestId: number,
  fields: readonly string[] | undefined,
  consume: (batch: DbfRecordBatch, sourceIndex: number) => void,
): number {
  const declared = header?.recordCount ?? 0;
  let readSoFar = 0;
  let reported = 0;

  for (const [sourceIndex, source] of sources.entries()) {
    const forward = (batch: DbfRecordBatch): void => {
      consume(batch, sourceIndex);
      const total = readSoFar + batch.recordsRead;
      if (total - reported >= PROGRESS_INTERVAL_RECORDS) {
        reported = total;
        reportProgress(requestId, total, declared);
      }
    };

    if (source.kind === 'records') {
      for (let offset = 0; offset < source.records.length; offset += BATCH_RECORDS) {
        const records = source.records.slice(offset, offset + BATCH_RECORDS);
        forward({
          records,
          firstRecordIndex: offset,
          recordsRead: offset + records.length,
          recordCount: source.records.length,
        });
      }
      readSoFar += source.records.length;
      continue;
    }

    const bytes = new Uint8Array(source.bytes);
    const summary = source.isDbc
      ? streamDbcRecords(bytes, forward, { batchSize: BATCH_RECORDS, ...(fields ? { fields } : {}) })
      : streamDbfRecords(bytes, forward, { batchSize: BATCH_RECORDS, ...(fields ? { fields } : {}) });
    readSoFar += summary.recordsRead;
  }

  reportProgress(requestId, readSoFar, declared || readSoFar);
  return readSoFar;
}

function headerForSources(request: OpenRequest): DbfHeader {
  const [first] = request.sources;
  if (!first) throw new Error('Nenhuma fonte foi enviada ao trabalhador local');
  if (first.kind === 'records') {
    const fields = request.fields ?? [];
    if (!fields.length) throw new Error('Uma fonte de registros exige a lista de campos');
    const base: DbfHeader = {
      version: 0x03,
      dateOfLastUpdate: new Date(),
      recordCount: 0,
      headerLength: 32 + fields.length * 32 + 1,
      recordLength: 1 + fields.reduce((sum, field) => sum + field.length, 0),
      fields,
    };
    let recordCount = 0;
    for (const source of request.sources) {
      if (source.kind === 'records') {
        recordCount += source.records.length;
        continue;
      }
      const bytes = new Uint8Array(source.bytes);
      const incoming = source.isDbc
        ? readDbfHeader(bytes.subarray(0, readDbcMetadata(bytes).headerSize))
        : readDbfHeader(bytes);
      if (schemaSignature(base) !== schemaSignature(incoming)) {
        throw new Error(`${source.name}: esquema incompatível com a fonte de registros`);
      }
      recordCount += incoming.recordCount;
    }
    return { ...base, recordCount };
  }

  let recordCount = 0;
  let first_header: DbfHeader | null = null;
  for (const source of request.sources) {
    if (source.kind !== 'binary') throw new Error('Fontes de tipos diferentes não podem ser combinadas');
    const bytes = new Uint8Array(source.bytes);
    const current = source.isDbc
      ? readDbfHeader(bytes.subarray(0, readDbcMetadata(bytes).headerSize))
      : readDbfHeader(bytes);
    if (!first_header) first_header = current;
    else if (schemaSignature(first_header) !== schemaSignature(current)) {
      throw new Error(`${source.name}: esquema incompatível com o primeiro arquivo`);
    }
    recordCount += current.recordCount;
  }
  return { ...first_header!, recordCount };
}

function schemaSignature(value: DbfHeader): string {
  return value.fields.map((field) => `${field.name}:${field.type}:${field.length}:${field.decimalCount}`).join('|');
}

/**
 * A DbfField for a pipeline-created field, inferred from its actual values.
 * Numeric when every present value parses as a number (so it is offered as a
 * measure and profiled as numeric); character otherwise, wide enough for the
 * longest value seen, so a text field never gets mislabeled numeric.
 */
function synthesizeFieldShape(name: string, records: readonly DataRecord[]): DbfField {
  let allNumeric = true;
  let sawValue = false;
  let maxLength = 1;
  for (const record of records) {
    const raw = record[name];
    if (raw === null || raw === undefined) continue;
    sawValue = true;
    const text = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
    maxLength = Math.max(maxLength, text.length);
    if (allNumeric && typeof raw !== 'number') {
      const value = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(value)) allNumeric = false;
    }
  }
  if (sawValue && allNumeric) return { name, type: 'N', length: 20, decimalCount: 6 };
  // Character width is bounded so a stray very long value cannot blow the
  // record size out; 254 is the DBF character-field maximum.
  return { name, type: 'C', length: Math.min(254, Math.max(1, maxLength)), decimalCount: 0 };
}

function handle(request: DatasetRequest): void {
  switch (request.type) {
    case 'open': {
      // Computed against the *new* sources before anything module-level
      // changes, so a schema/format error here leaves the previous dataset —
      // and its still-valid cache — untouched.
      const nextHeader = headerForSources(request);
      sources = request.sources;
      header = nextHeader;
      resultCache.clear();
      post({ type: 'opened', requestId: request.requestId, header, recordCount: header.recordCount });
      return;
    }
    case 'append': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto para combinar');
      const source = request.source;
      if (source.kind !== 'binary') throw new Error('Só arquivos DBC/DBF podem ser combinados');
      const bytes = new Uint8Array(source.bytes);
      const incoming = source.isDbc
        ? readDbfHeader(bytes.subarray(0, readDbcMetadata(bytes).headerSize))
        : readDbfHeader(bytes);
      if (schemaSignature(header) !== schemaSignature(incoming)) {
        throw new Error(
          `${source.name}: esquema incompatível; arquivos combinados precisam ter os mesmos campos, tipos, tamanhos e decimais`,
        );
      }
      sources = [...sources, source];
      header = { ...header, recordCount: header.recordCount + incoming.recordCount };
      resultCache.clear();
      post({ type: 'opened', requestId: request.requestId, header, recordCount: header.recordCount });
      return;
    }
    case 'tabulate': {
      const conversions = request.conversions ?? {};
      const cached = resultCache.get({ plan: request.plan, conversions });
      if (cached) {
        post({ type: 'tabulation', requestId: request.requestId, result: cached, cached: true });
        return;
      }
      const accumulator = createTabulationAccumulator(request.plan, conversions);
      streamAll(request.requestId, fieldsUsedByPlan(request.plan), (batch) => accumulator.push(batch.records));
      const result: TabulationResult = accumulator.finish();
      resultCache.set({ plan: request.plan, conversions }, result);
      post({ type: 'tabulation', requestId: request.requestId, result, cached: false });
      return;
    }
    case 'profile-numeric': {
      const profiler = createNumericFieldProfiler(request.field);
      streamAll(request.requestId, [request.field], (batch) => profiler.push(batch.records));
      const profile: NumericFieldProfile = profiler.finish();
      post({ type: 'numeric-profile', requestId: request.requestId, profile });
      return;
    }
    case 'profile-combinations': {
      const profiler = createFieldCombinationProfiler(request.fields, { limit: request.limit ?? 50 });
      streamAll(request.requestId, request.fields, (batch) => profiler.push(batch.records));
      const profile: FieldCombinationProfile = profiler.finish();
      post({ type: 'combination-profile', requestId: request.requestId, profile });
      return;
    }
    case 'distinct': {
      const collector = createDistinctValueCollector(request.field, request.limit ?? 500);
      streamAll(request.requestId, [request.field], (batch) => collector.push(batch.records));
      const collected = collector.finish();
      post({ type: 'distinct-values', requestId: request.requestId, ...collected });
      return;
    }
    case 'flows': {
      const fields = [request.originField, request.destinationField];
      if (request.weightField) fields.push(request.weightField);
      const accumulator = createFlowAccumulator({
        originField: request.originField,
        destinationField: request.destinationField,
        ...(request.weightField ? { weightField: request.weightField } : {}),
        ...(request.knownGeocodes ? { knownGeocodes: new Set(request.knownGeocodes) } : {}),
        ...(request.unknownPolicy ? { unknownPolicy: request.unknownPolicy } : {}),
      });
      streamAll(request.requestId, fields, (batch) => accumulator.push(batch.records));
      const result: FlowBuildResult = accumulator.finish();
      post({ type: 'flows-ready', requestId: request.requestId, result });
      return;
    }
    case 'selected-dbf': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const collector = createSelectedRecordCollector(request.plan, request.conversions ?? {});
      // No projection here: the exported DBF must carry every declared field.
      streamAll(request.requestId, undefined, (batch) => collector.push(batch.records));
      const bytes = writeDbf(collector.finish(), header.fields, header.dateOfLastUpdate ? { dateOfLastUpdate: header.dateOfLastUpdate } : {});
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: 'selected-dbf-ready', requestId: request.requestId, bytes: buffer }, [buffer]);
      return;
    }
    case 'microdatasus-csv': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const maxBytes = request.maxBytes ?? 512 * 1024 * 1024;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024 * 1024) {
        throw new Error('Limite Microdatasus inválido');
      }
      if (request.sourceContexts && request.sourceContexts.length !== sources.length) {
        throw new Error('Proveniência Microdatasus não corresponde às fontes abertas');
      }
      const conversions = request.conversions ?? {};
      const exporter = createMicrodatasusCsvEncoder(request.plan, request.fields, conversions, {
        provenanceColumns: request.provenanceColumns ?? [],
      });
      let emitted = 0;
      const emitChunk = (bytes: Uint8Array): void => {
        if (!bytes.byteLength) return;
        emitted += bytes.byteLength;
        if (emitted > maxBytes) {
          throw new Error(`Microdatasus excedeu ${(maxBytes / 1024 / 1024).toFixed(0)} MiB; restrinja os filtros antes de exportar`);
        }
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        post({ type: 'microdatasus-chunk', requestId: request.requestId, bytes: buffer }, [buffer]);
      };
      emitChunk(exporter.header());
      const projectedFields = fieldsUsedByMicrodatasusExport(request.plan, request.fields);
      streamAll(request.requestId, projectedFields, (batch, sourceIndex) => {
        emitChunk(exporter.push(batch.records, request.sourceContexts?.[sourceIndex]));
      });
      const stats = exporter.finish();
      post({ type: 'microdatasus-ready', requestId: request.requestId, stats });
      return;
    }
    case 'audit-scan': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const conversions = request.conversions ?? {};
      const isGroup = (record: DataRecord): boolean =>
        matchesFilters(record, request.groupFilters, request.groupCrossFieldRules, conversions);
      const accumulator = createAuditScanAccumulator(isGroup, {
        numericFields: request.numericFields,
        categoricalFields: request.categoricalFields,
        ...(request.geographyFields ? { geographyFields: request.geographyFields } : {}),
      });
      // Every field a group filter or cross-field condition reads must stay
      // in the projection too, or matchesFilters would see it as always
      // absent and the group would silently become empty.
      const filterFields = request.groupFilters.map((filter) => filter.field);
      const crossFieldFields = (request.groupCrossFieldRules ?? [])
        .flatMap((rule) => rule.conditions.map((condition) => condition.field));
      const projectedFields = [...new Set([
        ...request.numericFields, ...request.categoricalFields, ...filterFields, ...crossFieldFields,
      ])];
      streamAll(request.requestId, projectedFields, (batch) => accumulator.push(batch.records));
      const result: AuditScanResult = accumulator.finish();
      post({ type: 'audit-scan-ready', requestId: request.requestId, result });
      return;
    }
    case 'transform-apply': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const originalHeader = header;
      const originalFields = originalHeader.fields.map((field) => field.name);

      // No projection: a step the user adds later can reference any field
      // that survived so far, and the final field set is only known once the
      // whole pipeline has run - the same reason "selected-dbf" also reads
      // every declared field instead of guessing which ones matter.
      const collected: DataRecord[] = [];
      streamAll(request.requestId, undefined, (batch) => { for (const record of batch.records) collected.push(record); });

      const outcome = applyTransformPipeline(collected, originalFields, request.steps, request.conversions ?? {});

      const originalFieldByName = new Map(originalHeader.fields.map((field) => [field.name, field]));
      const fields: DbfField[] = outcome.fields.map((field) => {
        if (field.originalName === undefined) {
          // A field the pipeline created (derive-column, a date part, an
          // aggregation) or brought in from a second source has no original to
          // inherit a shape from. Inspect its actual values instead of
          // assuming: a numeric column so it is offered as a measure, a
          // character column wide enough for its longest value otherwise, so a
          // text field a bind-rows source contributed is never mislabeled N.
          return synthesizeFieldShape(field.name, outcome.records);
        }
        const original = originalFieldByName.get(field.originalName);
        // Cannot actually be missing: applyTransformPipeline only ever
        // carries a field's originalName forward from this exact map.
        if (!original) throw new Error(`internal: campo original ${field.originalName} não encontrado`);
        return { ...original, name: field.name };
      });
      const nextHeader: DbfHeader = {
        version: 0x03,
        dateOfLastUpdate: new Date(),
        headerLength: 32 + fields.length * 32 + 1,
        recordLength: 1 + fields.reduce((sum, field) => sum + field.length, 0),
        fields,
        recordCount: outcome.records.length,
      };

      sources = [{ kind: 'records', name: 'Dados transformados', records: outcome.records as DbfRecord[] }];
      header = nextHeader;
      resultCache.clear();
      const steps: TransformStepResult[] = outcome.steps;
      post({ type: 'transform-applied', requestId: request.requestId, header, recordCount: header.recordCount, steps });
      return;
    }
  }
}

workerScope.addEventListener('message', (event: MessageEvent<DatasetRequest>) => {
  try {
    handle(event.data);
  } catch (error) {
    post({
      type: 'error',
      requestId: event.data.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
