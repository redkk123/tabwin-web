export class InvalidDatasusArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDatasusArchiveError';
  }
}

/**
 * O pacote chegou, mas cortado antes do fim.
 *
 * Separado do inválido genérico porque o desfecho é outro: HTML no lugar do
 * ZIP significa que o pedido está errado e repetir não ajuda; um corte
 * significa que a conexão caiu ou que o DATASUS ainda estava escrevendo o
 * arquivo, e aí tentar de novo é justamente o que resolve.
 */
export class TruncatedDatasusArchiveError extends InvalidDatasusArchiveError {
  constructor(message: string) {
    super(message);
    this.name = 'TruncatedDatasusArchiveError';
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

/**
 * Procura o fim do índice central, que é o que prova que o ZIP está inteiro.
 *
 * O registro final do formato tem assinatura `PK` e fica nos últimos
 * 22 bytes, mais um comentário opcional de até 65535 — daí a janela de busca.
 * ZIP64 também termina com ele, então a varredura vale para os dois.
 */
function hasEndOfCentralDirectory(bytes: Uint8Array): boolean {
  const window = Math.min(bytes.length, 22 + 0xffff);
  for (let index = bytes.length - 4; index >= bytes.length - window && index >= 0; index--) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b
      && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) return true;
  }
  return false;
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
  // Os quatro primeiros bytes não bastam: um download CORTADO no meio começa
  // igualzinho a um inteiro. Aconteceu de verdade — um relógio do nosso proxy
  // abortava a resposta de origem no meio de downloads longos, e o que chegava
  // ao navegador passava por aqui e só falhava lá adiante, com "invalid zip
  // data", que não diz a ninguém o que houve. O fim do índice central é o que
  // separa "veio inteiro" de "veio pela metade".
  if (!hasEndOfCentralDirectory(bytes)) {
    throw new TruncatedDatasusArchiveError(
      'O download veio incompleto: o pacote do DATASUS foi cortado antes do fim.'
      + ' Nada foi guardado no cache.',
    );
  }
}
