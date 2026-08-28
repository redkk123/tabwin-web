export const MAX_MATERIALIZED_DBF_BYTES = 256 * 1024 * 1024;

export interface DbcSizeMetadata {
  headerSize: number;
  recordCount: number;
  recordSize: number;
}

export function expectedDecodedDbfBytes(metadata: DbcSizeMetadata): number {
  const bytes = metadata.headerSize + metadata.recordCount * metadata.recordSize + 1;
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('Cabeçalho DBC contém tamanho descompactado inválido');
  return bytes;
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

export function assertMaterializedDbfFits(metadata: DbcSizeMetadata, sourceName = 'Este DBC'): number {
  const expectedBytes = expectedDecodedDbfBytes(metadata);
  if (expectedBytes > MAX_MATERIALIZED_DBF_BYTES) {
    throw new Error(
      `${sourceName} é um arquivo oficial grande: precisaria de aproximadamente ${formatMiB(expectedBytes)} MiB `
      + `descompactados, acima do limite seguro atual de ${formatMiB(MAX_MATERIALIZED_DBF_BYTES)} MiB neste navegador. `
      + 'O arquivo não foi tratado como corrompido e nenhum conjunto anterior foi alterado. O processamento em blocos ainda é necessário para abri-lo com segurança.',
    );
  }
  return expectedBytes;
}
