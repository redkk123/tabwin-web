import { dbcToDbf, readDbcMetadata, readDbfHeader, type DbfHeader } from '@precisa-saude/datasus-dbc';
import { assertMaterializedDbfFits } from '../../acquisition/src/decode-limits.js';

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
  if (kind === 'DBC') {
    // Este é o único caminho que ainda materializa o DBF inteiro: tabular
    // streama, mas extrair o arquivo original precisa dele todo de uma vez.
    // Sem esta checagem, um DBC grande derrubava a aba sem explicação — e o
    // guard que dizia exatamente de quantos MiB se precisaria existia,
    // testado, sem ninguém chamar.
    assertMaterializedDbfFits(readDbcMetadata(source), sourceName);
  }
  const bytes = kind === 'DBC' ? dbcToDbf(source) : source.slice();
  const header = readDbfHeader(bytes);
  return { bytes, filename: extractedDbfName(sourceName), header, decompressed: kind === 'DBC' };
}
