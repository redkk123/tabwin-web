export type CachedArchiveRole = 'data' | 'auxiliary';

export interface CachedArchiveSource {
  name: string;
  address: string;
  source: string;
  modality: string;
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

export async function listCachedArchives(): Promise<CachedArchiveSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const entries = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as CachedArchive[];
    return entries.map(summarize).sort((a, b) => b.savedAt - a.savedAt);
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
    const read = database.transaction(STORE_NAME, 'readonly');
    const entries = await requestResult(read.objectStore(STORE_NAME).getAll()) as CachedArchive[];
    entries.sort((a, b) => b.savedAt - a.savedAt);
    const expired = entries.slice(MAX_CACHED_ARCHIVES);
    if (expired.length) {
      const cleanup = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
      await Promise.all(expired.map((entry) => requestResult(cleanup.delete(entry.key))));
    }
    return summarize(entry);
  } finally {
    database.close();
  }
}
