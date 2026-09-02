/**
 * Onde as respostas do catálogo ficam guardadas neste aparelho.
 *
 * A política — o que vale, por quanto tempo, e o que precisa ser perguntado de
 * novo — mora em `packages/acquisition/src/catalog-memory.ts`, onde é testada.
 * Aqui só existe o armazenamento.
 *
 * Usa o mesmo IndexedDB dos pacotes baixados, numa store própria. Se o
 * navegador negar armazenamento (janela anônima, política do site), tudo
 * degrada para o comportamento antigo: pergunta sempre. Nenhuma falha daqui
 * pode impedir uma busca de acontecer.
 */

import type { DatasusSearchQuery } from '../../../packages/acquisition/src/datasus.ts';
import {
  catalogQueryKey,
  type CatalogAnswer,
  type RememberedCatalogAnswer,
} from '../../../packages/acquisition/src/catalog-memory.ts';

/**
 * Banco PRÓPRIO, e não uma store nova dentro de `tabwin-web`.
 *
 * O cache de pacotes abre `tabwin-web` na versão 1. Acrescentar uma store ali
 * exigiria subir para a versão 2, e a partir daí qualquer `open(nome, 1)` do
 * outro módulo passaria a falhar com `VersionError` — uma funcionalidade nova
 * e opcional derrubaria o cache de arquivos, que funciona e é testado.
 *
 * Bancos separados custam um nome a mais no navegador e removem esse risco
 * inteiro. "Limpar cache" apaga os dois.
 */
const DATABASE_NAME = 'tabwin-web-catalog';
const DATABASE_VERSION = 1;
const STORE_NAME = 'catalog-answers';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponível'));
  });
}

/**
 * Lê tudo que já se sabe sobre estas combinações.
 *
 * Uma leitura só para o lote inteiro: abrir transação por consulta seria
 * trocar latência de rede por latência de disco.
 */
export async function readCatalogMemory(
  queries: readonly DatasusSearchQuery[],
): Promise<Map<string, RememberedCatalogAnswer>> {
  const memoria = new Map<string, RememberedCatalogAnswer>();
  if (!queries.length) return memoria;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    await Promise.all(queries.map((query) => new Promise<void>((resolve) => {
      const chave = catalogQueryKey(query);
      const pedido = store.get(chave);
      pedido.onsuccess = () => {
        const valor = pedido.result as (RememberedCatalogAnswer & { key: string }) | undefined;
        if (valor && (valor.answer === 'found' || valor.answer === 'missing')) {
          memoria.set(chave, { answer: valor.answer, checkedAt: valor.checkedAt, files: valor.files ?? [] });
        }
        resolve();
      };
      // Um registro ilegível não pode derrubar a busca: ele simplesmente não
      // é lembrado, e a combinação vai ao servidor como antes.
      pedido.onerror = () => resolve();
    })));
  } catch {
    // Armazenamento negado ou indisponível: segue sem memória.
  } finally {
    database?.close();
  }
  return memoria;
}

/** Guarda o que o DATASUS acabou de responder, inclusive quando foi "não existe". */
export async function rememberCatalogAnswers(
  respostas: ReadonlyArray<{
    query: DatasusSearchQuery;
    answer: CatalogAnswer;
    files: RememberedCatalogAnswer['files'];
  }>,
): Promise<void> {
  if (!respostas.length) return;
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const checkedAt = Date.now();
    for (const { query, answer, files } of respostas) {
      store.put({ key: catalogQueryKey(query), answer, checkedAt, files });
    }
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  } catch {
    // Não conseguir lembrar é aceitável; não conseguir buscar não seria.
  } finally {
    database?.close();
  }
}

/** Esquece tudo, para quem quer forçar uma consulta limpa. */
export async function forgetCatalogMemory(): Promise<void> {
  let database: IDBDatabase | null = null;
  try {
    database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  } catch {
    // Nada a esquecer se nem dá para abrir.
  } finally {
    database?.close();
  }
}
