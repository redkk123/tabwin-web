/**
 * Limits applied when expanding an official DATASUS archive, and the decision
 * of what a breach should cost.
 *
 * These guards exist so a hostile or malformed archive cannot exhaust memory
 * in the browser. That goal does not require throwing away an entire bundle
 * because one member of it is too large.
 *
 * The distinction this module draws:
 *
 * - **A single oversized file is skipped, not fatal.** A DATASUS auxiliary
 *   bundle holds the DEF and CNV files that make a tabulation legible plus
 *   whatever lookup tables the system ships. Those lookups can be very large
 *   (`TAB_SINANNET/UNIDTOTAL.DBF` is the case that exposed this). Aborting the
 *   whole extraction over one of them costs the user every DEF and CNV in the
 *   package - the very reason to open it. The oversized entry is never
 *   expanded, so the guard still holds.
 * - **Aggregate breaches stay fatal.** Too many entries, too much total
 *   expansion, or nesting past the supported depth are properties of the
 *   archive as a whole, not of one member, and they are what a zip bomb
 *   actually looks like.
 *
 * Nothing is skipped silently. Every skipped entry is returned so the caller
 * can say which file was left out and why - a default may exist, an invisible
 * default may not.
 */

export const ARCHIVE_LIMITS = {
  /** Bytes accepted from the network for one archive. */
  maxArchiveBytes: 512 * 1024 * 1024,
  /** Total expanded bytes across every kept entry. */
  maxExpandedBytes: 512 * 1024 * 1024,
  /** Expanded bytes accepted for any single entry. */
  maxFileBytes: 256 * 1024 * 1024,
  /** Entries examined before the archive is judged unusable. */
  maxEntries: 5_000,
  /** Nested ZIP depth. */
  maxDepth: 2,
} as const;

export interface ArchiveEntryInfo {
  name: string;
  /** Expanded size in bytes, as the archive itself declares it. */
  originalSize: number;
}

export interface SkippedArchiveEntry {
  name: string;
  bytes: number;
  reason: 'too-large';
}

/** Running totals across one extraction. Created by {@link createArchiveBudget}. */
export interface ArchiveBudget {
  entriesSeen: number;
  expandedBytes: number;
  skipped: SkippedArchiveEntry[];
}

export function createArchiveBudget(): ArchiveBudget {
  return { entriesSeen: 0, expandedBytes: 0, skipped: [] };
}

export type ArchiveEntryDecision =
  | { action: 'take' }
  | { action: 'skip'; reason: 'too-large' }
  | { action: 'ignore' };

/**
 * Decides what to do with one archive entry, updating `budget`.
 *
 * Throws only for a breach that describes the archive as a whole. A single
 * entry that is merely too large returns `skip`, and the caller carries on.
 */
export function classifyArchiveEntry(
  entry: ArchiveEntryInfo,
  budget: ArchiveBudget,
  isWanted: (name: string) => boolean,
): ArchiveEntryDecision {
  budget.entriesSeen++;
  if (budget.entriesSeen > ARCHIVE_LIMITS.maxEntries) {
    throw new Error('ZIP contém arquivos demais');
  }
  if (!isWanted(entry.name)) return { action: 'ignore' };

  if (entry.originalSize > ARCHIVE_LIMITS.maxFileBytes) {
    budget.skipped.push({ name: entry.name, bytes: entry.originalSize, reason: 'too-large' });
    return { action: 'skip', reason: 'too-large' };
  }

  budget.expandedBytes += entry.originalSize;
  if (budget.expandedBytes > ARCHIVE_LIMITS.maxExpandedBytes) {
    throw new Error('ZIP excede o limite total expandido');
  }
  return { action: 'take' };
}

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} kB`;
}

/**
 * A sentence naming what was left out, for the interface to show.
 *
 * Returns `null` when nothing was skipped, so the caller has nothing to
 * report rather than an empty notice to suppress.
 */
export function describeSkippedEntries(skipped: readonly SkippedArchiveEntry[]): string | null {
  if (!skipped.length) return null;
  const limit = formatBytes(ARCHIVE_LIMITS.maxFileBytes);
  const named = skipped
    .map((entry) => `${entry.name} (${formatBytes(entry.bytes)})`)
    .join(', ');
  const subject = skipped.length === 1 ? 'Um arquivo do pacote foi' : `${skipped.length} arquivos do pacote foram`;
  return `${subject} deixado(s) de fora por passar do limite de ${limit} por arquivo: ${named}. `
    + 'O restante do pacote foi aberto normalmente. Se algum rótulo depender '
    + 'justamente dessa tabela, ele aparecerá pelo código em vez do nome.';
}
