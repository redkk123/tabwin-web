import { dbcToDbf, readDbfHeader, type DbfHeader } from '@precisa-saude/datasus-dbc';

export interface DbfExtraction {
  bytes: Uint8Array;
  filename: string;
  header: DbfHeader;
  decompressed: boolean;
}

function extension(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match?.[1]?.toUpperCase() ?? '';
}

export function extractedDbfName(sourceName: string): string {
  const basename = sourceName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'dados';
  return `${basename}.dbf`;
}

/**
 * Expands a DATASUS DBC or validates/copies an existing DBF. The returned
 * bytes are standard xBase data and are never interpreted as an analysis.
 */
export function extractSourceDbf(source: Uint8Array, sourceName: string): DbfExtraction {
  const kind = extension(sourceName);
  if (kind !== 'DBC' && kind !== 'DBF') throw new Error('DBF extraction requires a .dbc or .dbf source');
  const bytes = kind === 'DBC' ? dbcToDbf(source) : source.slice();
  const header = readDbfHeader(bytes);
  return { bytes, filename: extractedDbfName(sourceName), header, decompressed: kind === 'DBC' };
}
