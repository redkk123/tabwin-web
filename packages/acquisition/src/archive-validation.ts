export class InvalidDatasusArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDatasusArchiveError';
  }
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256))).trimStart().toLowerCase();
  return prefix.startsWith('<!doctype html') || prefix.startsWith('<html')
    || prefix.startsWith('<?xml') || prefix.startsWith('<body');
}

/** ZIP local header, empty archive, or spanning signature accepted by PKZIP. */
function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

/** Validates the transport envelope before cache or extraction can trust it. */
export function validateDatasusZipArchive(bytes: Uint8Array, contentType?: string | null): void {
  if (bytes.byteLength === 0) throw new InvalidDatasusArchiveError('O DATASUS retornou um arquivo vazio');
  const normalizedType = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (normalizedType === 'text/html' || normalizedType === 'application/xhtml+xml' || looksLikeHtml(bytes)) {
    throw new InvalidDatasusArchiveError('O DATASUS retornou HTML/XML no lugar do arquivo ZIP');
  }
  if (!hasZipSignature(bytes)) {
    throw new InvalidDatasusArchiveError('A resposta do DATASUS não possui uma assinatura ZIP válida');
  }
}
