/**
 * Guarda pedaços de download no sistema de arquivos privado do navegador.
 *
 * Por que OPFS e não IndexedDB: aqui se escreve um arquivo grande em fatias e
 * se lê o que já existe sem trazer tudo para a memória. O IndexedDB guarda o
 * valor inteiro de uma vez, o que para 112 MB significa segurar 112 MB na aba
 * a cada gravação — exatamente o que se quer evitar.
 *
 * O nome do arquivo é o SHA-256 esperado. Isso não é enfeite: torna a parte
 * autoidentificável. Um pedaço do arquivo de hash X só serve para o arquivo de
 * hash X, e um arquivo republicado tem hash novo, então a parte antiga nunca é
 * encontrada. Não há validade a controlar.
 *
 * Todo caminho aqui devolve `null` ou segue em silêncio quando o navegador não
 * coopera. OPFS falta em navegador antigo, falha em aba anônima e estoura cota
 * sem aviso — e nada disso pode derrubar um download que funcionaria sem a
 * retomada.
 */
import type { PartialDownload, PartialStore } from '../../../packages/acquisition/src/partial-download.ts';

const PASTA = 'downloads-parciais';

async function pasta(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const raiz = await navigator.storage?.getDirectory?.();
    if (!raiz) return null;
    return await raiz.getDirectoryHandle(PASTA, { create: true });
  } catch {
    return null;
  }
}

/** O que já está guardado para este hash, ou `null`. */
export async function readPartial(
  sha256: string,
  totalBytes: number,
): Promise<PartialDownload | null> {
  try {
    const dir = await pasta();
    if (!dir) return null;
    const arquivo = await (await dir.getFileHandle(sha256)).getFile();
    if (!arquivo.size) return null;
    return { sha256, bytes: arquivo.size, totalBytes };
  } catch {
    // Inclui o caso comum de não existir parte nenhuma.
    return null;
  }
}

/** Os bytes guardados, ou `null` se não der para lê-los inteiros. */
export async function readPartialBytes(sha256: string, expectedBytes: number): Promise<Uint8Array | null> {
  try {
    const dir = await pasta();
    if (!dir) return null;
    const arquivo = await (await dir.getFileHandle(sha256)).getFile();
    if (arquivo.size !== expectedBytes) return null;
    return new Uint8Array(await arquivo.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Escreve a parte inteira, substituindo o que houver.
 *
 * Substituir em vez de acrescentar custa uma escrita maior, mas garante que o
 * tamanho do arquivo em disco é sempre exatamente o que foi conferido. Um
 * `append` interrompido no meio deixaria um arquivo maior do que os bytes
 * válidos, e a retomada seguinte continuaria do lugar errado — o tipo de erro
 * que só aparece como arquivo corrompido muito depois.
 */
export async function writePartial(sha256: string, bytes: Uint8Array): Promise<void> {
  try {
    const dir = await pasta();
    if (!dir) return;
    const handle = await dir.getFileHandle(sha256, { create: true });
    const escritor = await handle.createWritable();
    await escritor.write(bytes as unknown as BufferSource);
    await escritor.close();
  } catch {
    // Cota cheia, aba anônima, navegador sem suporte: a retomada é um bônus.
  }
}

/** Apaga a parte. Chamado quando o arquivo completa e é conferido. */
export async function deletePartial(sha256: string): Promise<void> {
  try {
    const dir = await pasta();
    await dir?.removeEntry(sha256);
  } catch {
    // Já não existia, ou o navegador não deixa. Nenhum dos dois é problema.
  }
}

/**
 * Quanto está ocupado em partes, e quantas são.
 *
 * Existe para a interface poder mostrar e oferecer a limpeza: um espaço que
 * cresce sozinho e não aparece em lugar nenhum é uma armadilha para quem usa
 * o aplicativo num aparelho apertado.
 */
export async function listPartials(): Promise<{ sha256: string; bytes: number }[]> {
  const encontradas: { sha256: string; bytes: number }[] = [];
  try {
    const dir = await pasta();
    if (!dir) return encontradas;
    // `values()` é assíncrono e só existe em navegador que tem OPFS de escrita.
    const iteravel = dir as unknown as { values?: () => AsyncIterable<FileSystemHandle> };
    if (!iteravel.values) return encontradas;
    for await (const entrada of iteravel.values()) {
      if (entrada.kind !== 'file') continue;
      const arquivo = await (entrada as FileSystemFileHandle).getFile();
      encontradas.push({ sha256: entrada.name, bytes: arquivo.size });
    }
  } catch {
    return encontradas;
  }
  return encontradas;
}

/** Apaga todas as partes. Devolve quantos bytes foram liberados. */
export async function clearPartials(): Promise<number> {
  const partes = await listPartials();
  for (const parte of partes) await deletePartial(parte.sha256);
  return partes.reduce((soma, parte) => soma + parte.bytes, 0);
}

/**
 * O armazenamento de partes deste navegador, na forma que o download espera.
 *
 * Quando o OPFS não existe, cada método simplesmente não guarda nada — e o
 * download segue pelo caminho normal, sem desvio.
 */
export const OPFS_PARTIAL_STORE: PartialStore = Object.freeze({
  read: readPartial,
  readBytes: readPartialBytes,
  write: writePartial,
  delete: deletePartial,
});
