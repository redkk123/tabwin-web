/**
 * Evidence-first reconnaissance for legacy TabWin `.TAB` files.
 *
 * The container/panel schema is not documented in this repository and no real
 * `.TAB` fixture ships with the snapshot. This module therefore does *not*
 * pretend to parse or replay a panel. It performs bounded, deterministic
 * binary inspection that is useful when paired save/reopen captures arrive:
 * identify the outer container, extract embedded single-byte/UTF-16LE strings,
 * locate likely DEF/CNV/data/map references, and diff two inspections.
 *
 * Once evidence proves stable fields, a replay parser can be layered on top of
 * these offsets without weakening the current compatibility boundary.
 */

export type LegacyTabContainerHint = 'ole-cfb' | 'zip' | 'plain-text' | 'unknown-binary';
export type LegacyTabStringEncoding = 'windows-1252' | 'utf-16le';
export type LegacyTabReferenceKind = 'def' | 'cnv' | 'dbf' | 'dbc' | 'map' | 'tab' | 'other-path';

export interface LegacyTabStringRun {
  offset: number;
  encoding: LegacyTabStringEncoding;
  text: string;
}

export interface LegacyTabReference {
  offset: number;
  encoding: LegacyTabStringEncoding;
  kind: LegacyTabReferenceKind;
  value: string;
}

export interface LegacyTabInspection {
  version: 1;
  byteLength: number;
  signatureHex: string;
  containerHint: LegacyTabContainerHint;
  printableByteRatio: number;
  strings: LegacyTabStringRun[];
  references: LegacyTabReference[];
  replay: {
    status: 'inspection-only';
    blockers: string[];
  };
}

export interface LegacyTabInspectionOptions {
  minStringLength?: number;
  maxStrings?: number;
  maxStringLength?: number;
}

export interface LegacyTabInspectionDiff {
  beforeBytes: number;
  afterBytes: number;
  byteLengthDelta: number;
  addedStrings: LegacyTabStringRun[];
  removedStrings: LegacyTabStringRun[];
  addedReferences: LegacyTabReference[];
  removedReferences: LegacyTabReference[];
}

const OLE_CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const;

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function signatureHex(bytes: Uint8Array): string {
  return [...bytes.subarray(0, Math.min(16, bytes.length))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join(' ');
}

function singleBytePrintable(value: number): boolean {
  return value >= 0x20 && value !== 0x7f && (value <= 0x7e || value >= 0xa0);
}

function printableRatio(bytes: Uint8Array): number {
  if (!bytes.length) return 1;
  let printable = 0;
  for (const value of bytes) {
    if (singleBytePrintable(value) || value === 0x09 || value === 0x0a || value === 0x0d) printable++;
  }
  return printable / bytes.length;
}

function containerHint(bytes: Uint8Array, ratio: number): LegacyTabContainerHint {
  if (startsWith(bytes, OLE_CFB_SIGNATURE)) return 'ole-cfb';
  if (ZIP_SIGNATURES.some((signature) => startsWith(bytes, signature))) return 'zip';
  if (ratio >= 0.85) return 'plain-text';
  return 'unknown-binary';
}

function assertLimit(value: number | undefined, fallback: number, label: string, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function extractSingleByteStrings(
  bytes: Uint8Array,
  minLength: number,
  maxStrings: number,
  maxStringLength: number,
): LegacyTabStringRun[] {
  const decoder = new TextDecoder('windows-1252');
  const runs: LegacyTabStringRun[] = [];
  let start = -1;
  const flush = (end: number): void => {
    if (start < 0 || end - start < minLength || runs.length >= maxStrings) {
      start = -1;
      return;
    }
    const decoded = decoder.decode(bytes.subarray(start, end)).trim();
    if (decoded.length >= minLength) {
      runs.push({ offset: start, encoding: 'windows-1252', text: boundedText(decoded, maxStringLength) });
    }
    start = -1;
  };
  for (let index = 0; index < bytes.length; index++) {
    if (singleBytePrintable(bytes[index]!)) {
      if (start < 0) start = index;
    } else flush(index);
    if (runs.length >= maxStrings) break;
  }
  flush(bytes.length);
  return runs;
}

function extractUtf16LeStrings(
  bytes: Uint8Array,
  minLength: number,
  maxStrings: number,
  maxStringLength: number,
): LegacyTabStringRun[] {
  const decoder = new TextDecoder('utf-16le');
  const runs: LegacyTabStringRun[] = [];
  // Test both byte parities because an embedded string is not guaranteed to be
  // aligned to the beginning of the file.
  for (const parity of [0, 1]) {
    let start = -1;
    const flush = (end: number): void => {
      if (start < 0) return;
      const codeUnits = Math.floor((end - start) / 2);
      if (codeUnits >= minLength && runs.length < maxStrings) {
        const decoded = decoder.decode(bytes.subarray(start, end)).trim();
        if (decoded.length >= minLength) {
          runs.push({ offset: start, encoding: 'utf-16le', text: boundedText(decoded, maxStringLength) });
        }
      }
      start = -1;
    };
    for (let index = parity; index + 1 < bytes.length; index += 2) {
      const low = bytes[index]!;
      const high = bytes[index + 1]!;
      if (high === 0 && low >= 0x20 && low <= 0x7e) {
        if (start < 0) start = index;
      } else flush(index);
      if (runs.length >= maxStrings) break;
    }
    flush(bytes.length - ((bytes.length - parity) % 2));
    if (runs.length >= maxStrings) break;
  }
  return runs;
}

function referenceKind(value: string): LegacyTabReferenceKind | undefined {
  const clean = value.replace(/["'()[\]{};,]+$/g, '').trim();
  const match = clean.match(/\.([a-z0-9]{2,5})(?:\s|$)/i);
  if (!match) return /[\\/]/.test(clean) ? 'other-path' : undefined;
  switch (match[1]!.toLowerCase()) {
    case 'def': return 'def';
    case 'cnv': return 'cnv';
    case 'dbf': return 'dbf';
    case 'dbc': return 'dbc';
    case 'map':
    case 'geojson': return 'map';
    case 'tab': return 'tab';
    default: return /[\\/]/.test(clean) ? 'other-path' : undefined;
  }
}

function referencesFromStrings(strings: readonly LegacyTabStringRun[]): LegacyTabReference[] {
  const seen = new Set<string>();
  const references: LegacyTabReference[] = [];
  // A run can contain prose around a path. Pull path-like tokens first, then
  // fall back to the entire run for simple filenames.
  const pathToken = /(?:[A-Za-z]:)?[^\s"'<>|]+\.(?:def|cnv|dbf|dbc|map|geojson|tab)\b/gi;
  for (const run of strings) {
    const candidates = [...run.text.matchAll(pathToken)].map((match) => ({
      value: match[0]!,
      offset: run.offset + (match.index ?? 0) * (run.encoding === 'utf-16le' ? 2 : 1),
    }));
    if (!candidates.length && referenceKind(run.text)) candidates.push({ value: run.text, offset: run.offset });
    for (const candidate of candidates) {
      const kind = referenceKind(candidate.value);
      if (!kind) continue;
      const key = `${candidate.offset}\u0000${run.encoding}\u0000${candidate.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({ offset: candidate.offset, encoding: run.encoding, kind, value: candidate.value });
    }
  }
  return references.sort((left, right) => left.offset - right.offset || left.value.localeCompare(right.value));
}

/** Bounded reconnaissance; never claims that a legacy panel was parsed. */
export function inspectLegacyTab(
  bytes: Uint8Array,
  options: LegacyTabInspectionOptions = {},
): LegacyTabInspection {
  const minStringLength = assertLimit(options.minStringLength, 4, 'minStringLength', 1024);
  const maxStrings = assertLimit(options.maxStrings, 5000, 'maxStrings', 100_000);
  const maxStringLength = assertLimit(options.maxStringLength, 4096, 'maxStringLength', 1_000_000);
  const ratio = printableRatio(bytes);
  const singleByte = extractSingleByteStrings(bytes, minStringLength, maxStrings, maxStringLength);
  const remaining = Math.max(0, maxStrings - singleByte.length);
  const utf16 = remaining
    ? extractUtf16LeStrings(bytes, minStringLength, remaining, maxStringLength)
    : [];
  const strings = [...singleByte, ...utf16]
    .sort((left, right) => left.offset - right.offset || left.encoding.localeCompare(right.encoding));

  return {
    version: 1,
    byteLength: bytes.length,
    signatureHex: signatureHex(bytes),
    containerHint: containerHint(bytes, ratio),
    printableByteRatio: ratio,
    strings,
    references: referencesFromStrings(strings),
    replay: {
      status: 'inspection-only',
      blockers: [
        'No real legacy .TAB fixture is present in this snapshot.',
        'Panel-field offsets and meanings have not been proven against TabWin 4.15 save/reopen pairs.',
        'Writing or replaying guessed fields would violate the compatibility evidence boundary.',
      ],
    },
  };
}

function runIdentity(run: LegacyTabStringRun): string {
  return `${run.encoding}\u0000${run.text}`;
}

function referenceIdentity(reference: LegacyTabReference): string {
  return `${reference.kind}\u0000${reference.encoding}\u0000${reference.value}`;
}

function multisetDifference<T>(left: readonly T[], right: readonly T[], keyFor: (value: T) => string): T[] {
  const rightCounts = new Map<string, number>();
  for (const item of right) {
    const key = keyFor(item);
    rightCounts.set(key, (rightCounts.get(key) ?? 0) + 1);
  }
  const output: T[] = [];
  for (const item of left) {
    const key = keyFor(item);
    const count = rightCounts.get(key) ?? 0;
    if (count > 0) rightCounts.set(key, count - 1);
    else output.push(item);
  }
  return output;
}

/**
 * Compares two captures without assuming that changed offsets mean changed
 * semantics. This is intended for controlled experiments such as "save the
 * same table, toggle one panel option, save again".
 */
export function diffLegacyTabInspections(
  before: LegacyTabInspection,
  after: LegacyTabInspection,
): LegacyTabInspectionDiff {
  return {
    beforeBytes: before.byteLength,
    afterBytes: after.byteLength,
    byteLengthDelta: after.byteLength - before.byteLength,
    addedStrings: multisetDifference(after.strings, before.strings, runIdentity),
    removedStrings: multisetDifference(before.strings, after.strings, runIdentity),
    addedReferences: multisetDifference(after.references, before.references, referenceIdentity),
    removedReferences: multisetDifference(before.references, after.references, referenceIdentity),
  };
}

/** Small byte window for handoff reports and differential archaeology. */
export function legacyTabHexWindow(bytes: Uint8Array, centerOffset: number, radius = 32): string {
  if (!Number.isSafeInteger(centerOffset) || centerOffset < 0 || centerOffset > bytes.length) {
    throw new Error('centerOffset is outside the file');
  }
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > 4096) throw new Error('radius must be between 1 and 4096');
  const start = Math.max(0, centerOffset - radius);
  const end = Math.min(bytes.length, centerOffset + radius);
  const lines: string[] = [];
  for (let offset = start; offset < end; offset += 16) {
    const chunk = bytes.subarray(offset, Math.min(end, offset + 16));
    const hex = [...chunk].map((value) => value.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = [...chunk].map((value) => (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  return lines.join('\n');
}
