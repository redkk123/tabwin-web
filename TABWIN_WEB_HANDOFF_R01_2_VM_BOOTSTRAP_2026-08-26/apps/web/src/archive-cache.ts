interface CachedArchive {
  key: string;
  savedAt: number;
  bytes: ArrayBuffer;
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

export async function readCachedArchive(key: string, maxAgeMs: number): Promise<Uint8Array | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const entry = await requestResult(transaction.objectStore(STORE_NAME).get(key)) as CachedArchive | undefined;
    if (!entry || Date.now() - entry.savedAt > maxAgeMs) return null;
    return new Uint8Array(entry.bytes);
  } finally {
    database.close();
  }
}

export async function writeCachedArchive(key: string, bytes: Uint8Array): Promise<void> {
  const database = await openDatabase();
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const write = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(write.objectStore(STORE_NAME).put({ key, savedAt: Date.now(), bytes: buffer } satisfies CachedArchive));
    const read = database.transaction(STORE_NAME, 'readonly');
    const entries = await requestResult(read.objectStore(STORE_NAME).getAll()) as CachedArchive[];
    entries.sort((a, b) => b.savedAt - a.savedAt);
    const expired = entries.slice(MAX_CACHED_ARCHIVES);
    if (expired.length) {
      const cleanup = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
      await Promise.all(expired.map((entry) => requestResult(cleanup.delete(entry.key))));
    }
  } finally {
    database.close();
  }
}
