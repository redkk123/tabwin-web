import { unzipSync } from 'fflate';
import {
  DATASUS_DOWNLOAD_ENDPOINT,
  DATASUS_TRANSFER_ENDPOINT,
  buildAuxiliarySearchBody,
  buildAvailabilityManifest,
  buildDownloadBody,
  buildSearchBody,
  deduplicateRemoteFiles,
  parsePreparedDownloadResponse,
  parseSearchResponse,
  verifiedAuxiliaryBundleName,
  type DatasusRemoteFile,
  type DatasusAvailabilityManifest,
  type DatasusCatalogQueryResult,
  type DatasusSearchQuery,
} from '../../../packages/acquisition/src/datasus.ts';

export interface ExtractedArchiveFile {
  name: string;
  bytes: Uint8Array;
}

const SUPPORTED_EXTENSIONS = new Set(['DBC', 'DBF', 'DEF', 'CNV', 'MAP']);
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const DATASUS_PROXY_BASE = (import.meta.env.VITE_DATASUS_PROXY_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

function endpointFor(endpoint: string): string {
  if (!DATASUS_PROXY_BASE) return endpoint;
  if (endpoint === DATASUS_TRANSFER_ENDPOINT) return `${DATASUS_PROXY_BASE}/catalog`;
  if (endpoint === DATASUS_DOWNLOAD_ENDPOINT) return `${DATASUS_PROXY_BASE}/prepare`;
  return endpoint;
}

function extensionOf(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? '').toUpperCase() : '';
}

async function datasusHttpError(response: Response, context: string): Promise<Error> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    try {
      const envelope = await response.clone().json() as unknown;
      if (envelope && typeof envelope === 'object' && 'error' in envelope) {
        const error = (envelope as { error?: unknown }).error;
        if (error && typeof error === 'object' && 'message' in error
          && typeof (error as { message?: unknown }).message === 'string') {
          return new Error(`${context}: ${(error as { message: string }).message}`);
        }
      }
    } catch {
      // Fall back to the stable HTTP envelope below.
    }
  }
  return new Error(`${context}: HTTP ${response.status}`);
}

async function postForm(endpoint: string, body: URLSearchParams, signal?: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpointFor(endpoint), {
      method: 'POST',
      body,
      ...(signal ? { signal } : {}),
      headers: { Accept: 'application/json, text/plain, */*' },
    });
  } catch (error) {
    if (!DATASUS_PROXY_BASE && error instanceof TypeError) {
      throw new Error('O portal DATASUS bloqueou a consulta direta deste domínio. Abra um DBC local ou use uma implantação com proxy DATASUS configurado.');
    }
    throw error;
  }
  if (!response.ok) throw await datasusHttpError(response, 'Falha na consulta ao DATASUS');
  return response.text();
}

export async function searchOfficialFiles(query: DatasusSearchQuery, signal?: AbortSignal): Promise<DatasusRemoteFile[]> {
  return parseSearchResponse(await postForm(DATASUS_TRANSFER_ENDPOINT, buildSearchBody(query), signal));
}

/** The official form accepts one period/UF tuple; batch it deterministically. */
export async function searchOfficialFilesBatch(
  queries: readonly DatasusSearchQuery[],
  signal?: AbortSignal,
): Promise<DatasusRemoteFile[]> {
  return (await searchOfficialCatalogBatch(queries, signal)).files;
}

export async function searchOfficialCatalogBatch(
  queries: readonly DatasusSearchQuery[],
  signal?: AbortSignal,
): Promise<{ files: DatasusRemoteFile[]; availability: DatasusAvailabilityManifest }> {
  const files: DatasusRemoteFile[] = [];
  const results: DatasusCatalogQueryResult[] = [];
  for (const query of queries) {
    const result = await searchOfficialFiles(query, signal);
    results.push({ query: { ...query }, files: result });
    files.push(...result.map((file) => ({ ...file, catalogQuery: { ...query } })));
  }
  return { files: deduplicateRemoteFiles(files), availability: buildAvailabilityManifest(results) };
}

export async function searchOfficialAuxiliaries(system: string, signal?: AbortSignal): Promise<DatasusRemoteFile[]> {
  return parseSearchResponse(await postForm(DATASUS_TRANSFER_ENDPOINT, buildAuxiliarySearchBody(system), signal));
}

export async function prepareOfficialDownload(files: readonly DatasusRemoteFile[], signal?: AbortSignal): Promise<string> {
  return parsePreparedDownloadResponse(await postForm(DATASUS_DOWNLOAD_ENDPOINT, buildDownloadBody(files), signal));
}

export interface ArchiveDownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
}

export async function fetchOfficialArchive(
  url: string,
  signal?: AbortSignal,
  onProgress?: (progress: ArchiveDownloadProgress) => void,
): Promise<Uint8Array> {
  const downloadUrl = DATASUS_PROXY_BASE
    ? `${DATASUS_PROXY_BASE}/archive?url=${encodeURIComponent(url)}`
    : url;
  const response = await fetch(downloadUrl, signal ? { signal } : {});
  if (!response.ok) throw await datasusHttpError(response, 'Falha no download DATASUS');
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_ARCHIVE_BYTES) throw new Error('Arquivo remoto excede o limite de segurança');
  const totalBytes = length > 0 ? length : undefined;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Arquivo remoto excede o limite de segurança');
    onProgress?.({ receivedBytes: bytes.byteLength, ...(totalBytes ? { totalBytes } : {}) });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_ARCHIVE_BYTES) {
      await reader.cancel('archive limit exceeded');
      throw new Error('Arquivo remoto excede o limite de segurança');
    }
    chunks.push(value);
    onProgress?.({ receivedBytes, ...(totalBytes ? { totalBytes } : {}) });
  }
  const archive = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

export function extractSupportedArchiveFiles(archive: Uint8Array): ExtractedArchiveFile[] {
  const output: ExtractedArchiveFile[] = [];
  let entryCount = 0;
  let expandedBytes = 0;

  const visit = (bytes: Uint8Array, depth: number): void => {
    if (depth > 2) throw new Error('ZIP aninhado além do limite suportado');
    const entries = unzipSync(bytes, {
      filter: (entry) => {
        entryCount++;
        if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('ZIP contém arquivos demais');
        const extension = extensionOf(entry.name);
        const wanted = extension === 'ZIP' || SUPPORTED_EXTENSIONS.has(extension);
        if (!wanted) return false;
        if (entry.originalSize > MAX_FILE_BYTES) throw new Error(`${entry.name}: arquivo expandido grande demais`);
        expandedBytes += entry.originalSize;
        if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('ZIP excede o limite total expandido');
        return true;
      },
    });
    for (const [name, content] of Object.entries(entries)) {
      if (extensionOf(name) === 'ZIP') visit(content, depth + 1);
      else output.push({ name, bytes: content });
    }
  };

  visit(archive, 0);
  return output;
}

export function chooseVerifiedAuxiliaryBundle(
  files: readonly DatasusRemoteFile[],
  system: string,
  fileType: string,
): DatasusRemoteFile | null {
  const verifiedName = verifiedAuxiliaryBundleName(system, fileType);
  if (!verifiedName) return null;
  return files.find((file) => file.name.toUpperCase() === verifiedName.toUpperCase()) ?? null;
}

export function suggestedDefinitionName(system: string, fileType: string): string | null {
  if (system === 'SIHSUS' && fileType === 'RD') return 'RD2008.DEF';
  return null;
}
