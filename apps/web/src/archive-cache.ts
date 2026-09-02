import type { DatasusSearchQuery } from '../../../packages/acquisition/src/datasus.ts';

export type CachedArchiveRole = 'data' | 'auxiliary';

export interface CachedArchiveSource {
  name: string;
  address: string;
  source: string;
  modality: string;
  catalogQuery?: DatasusSearchQuery;
}

interface CachedArchive {
  key: string;
  savedAt: number;
  bytes: ArrayBuffer;
  sha256?: string;
  role?: CachedArchiveRole;
  sources?: CachedArchiveSource[];
}

export interface CachedArchiveSummary {
  key: string;
  savedAt: number;
  size: number;
  sha256: string;
  role: CachedArchiveRole;
  sources: CachedArchiveSource[];
}

export interface CachedArchivePayload {
  summary: CachedArchiveSummary;
  bytes: Uint8Array;
}

const DATABASE_NAME = 'tabwin-web';
const DATABASE_VERSION = 1;
const STORE_NAME = 'official-archives';
const MAX_CACHED_ARCHIVES = 6;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o cache local'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha no cache local'));
  });
}

function legacySources(key: string): CachedArchiveSource[] {
  const prefix = 'official-v1:';
  if (!key.startsWith(prefix)) return [];
  return key.slice(prefix.length).split('|').flatMap((address) => {
    try {
      const url = new URL(address);
      const name = url.pathname.split('/').pop() ?? '';
      return name ? [{ name, address, source: '', modality: '' }] : [];
    } catch {
      return [];
    }
  });
}

function summarize(entry: CachedArchive): CachedArchiveSummary {
  const sources = entry.sources?.length ? entry.sources : legacySources(entry.key);
  return {
    key: entry.key,
    savedAt: entry.savedAt,
    size: entry.bytes.byteLength,
    sha256: entry.sha256 ?? '',
    role: entry.role ?? (sources.some((source) => /\.(dbc|dbf)$/i.test(source.name)) ? 'data' : 'auxiliary'),
    sources,
  };
}

export async function readCachedArchive(key: string, maxAgeMs: number): Promise<CachedArchivePayload | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const entry = await requestResult(transaction.objectStore(STORE_NAME).get(key)) as CachedArchive | undefined;
    if (!entry || Date.now() - entry.savedAt > maxAgeMs) return null;
    return { summary: summarize(entry), bytes: new Uint8Array(entry.bytes) };
  } finally {
    database.close();
  }
}

/**
 * Resumos dos pacotes guardados, sem trazer os pacotes.
 *
 * A versão anterior usava `getAll()`, que materializa os BYTES de todo pacote
 * em cache só para montar uma lista que não usa nenhum deles. Com seis
 * arquivos de centenas de megabytes, abrir o diálogo pedia gigabytes ao
 * navegador — e num aparelho modesto isso é a aba morrendo.
 *
 * O cursor lê um registro por vez: o pico passa a ser o maior pacote, não a
 * soma de todos. Continua não sendo grátis, porque o IndexedDB não sabe
 * projetar colunas; a eliminação completa exigiria uma store separada só de
 * metadados, o que é a evolução natural daqui.
 */
export async function listCachedArchives(): Promise<CachedArchiveSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const summaries: CachedArchiveSummary[] = [];
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        summaries.push(summarize(cursor.value as CachedArchive));
        // Sem guardar `cursor.value`: o registro anterior fica elegível para
        // coleta assim que o cursor avança.
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Falha ao listar o cache local'));
    });
    return summaries.sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    database.close();
  }
}

export async function deleteCachedArchive(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(transaction.objectStore(STORE_NAME).delete(key));
  } finally {
    database.close();
  }
}

export async function clearCachedArchives(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(transaction.objectStore(STORE_NAME).clear());
  } finally {
    database.close();
  }
}

export async function writeCachedArchive(
  key: string,
  bytes: Uint8Array,
  metadata: {
    sha256: string;
    role: CachedArchiveRole;
    sources: CachedArchiveSource[];
  },
): Promise<CachedArchiveSummary> {
  const database = await openDatabase();
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const entry: CachedArchive = { key, savedAt: Date.now(), bytes: buffer, ...metadata };
    const write = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(write.objectStore(STORE_NAME).put(entry));
    // Decidir QUEM sai não precisa de nenhum byte de dado. O índice `savedAt`
    // já devolve as chaves em ordem cronológica, então a escolha custa a
    // leitura de seis strings.
    //
    // Antes isto era um `getAll()`, que trazia os bytes de todos os pacotes
    // para ordenar por data — e rodava a cada download, logo depois de o
    // navegador já ter na memória o arquivo recém-baixado. Era o pior momento
    // possível para pedir mais algumas centenas de megabytes.
    const read = database.transaction(STORE_NAME, 'readonly');
    const keysByAge = await requestResult(
      read.objectStore(STORE_NAME).index('savedAt').getAllKeys(),
    ) as IDBValidKey[];
    const expired = keysByAge.slice(0, Math.max(0, keysByAge.length - MAX_CACHED_ARCHIVES));
    if (expired.length) {
      const cleanup = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
      await Promise.all(expired.map((expiredKey) => requestResult(cleanup.delete(expiredKey))));
    }
    return summarize(entry);
  } finally {
    database.close();
  }
}
