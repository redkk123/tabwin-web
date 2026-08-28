import type { DbfRecord } from '@precisa-saude/datasus-dbc';
import { resolvePlanRecord, type ConversionRegistry } from '../../core/src/execute.js';
import type { QueryPlan } from '../../core/src/model.js';

/** Retained selection, bounded so a whole national file cannot be collected by accident. */
const DEFAULT_MAX_SELECTED_RECORDS = 1_000_000;

export interface SelectedRecordCollector {
  push(records: Iterable<DbfRecord>): void;
  /** The records the plan accepts, in source order. */
  finish(): DbfRecord[];
}

/**
 * Collects the records a plan accepts, from bounded batches.
 *
 * The DBF writer needs the full selection to size its output, so this is the
 * one consumer that genuinely retains records — but it retains the *selection*
 * the user asked for, not the source. Beyond the cap it fails with an explicit
 * message rather than exhausting the tab, which is what the unbounded
 * `records.filter(...)` did before.
 *
 * Acceptance is decided by {@link resolvePlanRecord}, the same boundary the
 * tabulation uses, so an exported selection can never disagree with the table.
 */
export function createSelectedRecordCollector(
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
  options: { maxRecords?: number } = {},
): SelectedRecordCollector {
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_SELECTED_RECORDS;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new Error(`limite inválido de registros selecionados: ${maxRecords}`);
  }
  const selected: DbfRecord[] = [];

  return {
    push(records: Iterable<DbfRecord>): void {
      for (const record of records) {
        if (!resolvePlanRecord(record, plan, conversions)) continue;
        if (selected.length >= maxRecords) {
          throw new Error(
            `A seleção passou de ${maxRecords.toLocaleString('pt-BR')} registros e não cabe em um DBF local. `
            + 'Restrinja a seleção com filtros antes de exportar.',
          );
        }
        selected.push(record);
      }
    },
    finish(): DbfRecord[] {
      return selected;
    },
  };
}
