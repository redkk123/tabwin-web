import { unzipSync } from 'fflate';
import {
  DATASUS_DOWNLOAD_ENDPOINT,
  DATASUS_TRANSFER_ENDPOINT,
  buildAuxiliarySearchBody,
  buildDownloadBody,
  buildSearchBody,
  parsePreparedDownloadResponse,
  parseSearchResponse,
  type DatasusRemoteFile,
  type DatasusSearchQuery,
} from '../../../packages/acquisition/src/datasus.ts';

export interface ExtractedArchiveFile {
  name: string;
  bytes: Uint8Array;
}

const SUPPORTED_EXTENSIONS = new Set(['DBC', 'DBF', 'DEF', 'CNV', 'MAP']);
const MAX_ARCHIVE_ENTRIES = 5_000;
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
  if (!response.ok) throw new Error(`DATASUS retornou HTTP ${response.status}`);
  return response.text();
}

export async function searchOfficialFiles(query: DatasusSearchQuery, signal?: AbortSignal): Promise<DatasusRemoteFile[]> {
  return parseSearchResponse(await postForm(DATASUS_TRANSFER_ENDPOINT, buildSearchBody(query), signal));
}

export async function searchOfficialAuxiliaries(system: string, signal?: AbortSignal): Promise<DatasusRemoteFile[]> {
  return parseSearchResponse(await postForm(DATASUS_TRANSFER_ENDPOINT, buildAuxiliarySearchBody(system), signal));
}

export async function prepareOfficialDownload(files: readonly DatasusRemoteFile[], signal?: AbortSignal): Promise<string> {
  return parsePreparedDownloadResponse(await postForm(DATASUS_DOWNLOAD_ENDPOINT, buildDownloadBody(files), signal));
}

export async function fetchOfficialArchive(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const downloadUrl = DATASUS_PROXY_BASE
    ? `${DATASUS_PROXY_BASE}/archive?url=${encodeURIComponent(url)}`
    : url;
  const response = await fetch(downloadUrl, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Download DATASUS retornou HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_ARCHIVE_ENTRIES * MAX_FILE_BYTES) throw new Error('Arquivo remoto excede o limite de segurança');
  return new Uint8Array(await response.arrayBuffer());
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

export function chooseCurrentAuxiliaryBundle(files: readonly DatasusRemoteFile[], system: string): DatasusRemoteFile | null {
  const preferredNames: Record<string, string> = {
    SIHSUS: 'TAB_SIH.zip',
    SIASUS: 'TAB_SIA.zip',
  };
  const preferred = preferredNames[system];
  if (preferred) {
    const exact = files.find((file) => file.name.toUpperCase() === preferred.toUpperCase());
    if (exact) return exact;
  }
  return files.find((file) => !/\d{6}[-_]\d{6}/.test(file.name)) ?? files[0] ?? null;
}

export function suggestedDefinitionName(system: string, fileType: string): string | null {
  if (system === 'SIHSUS' && fileType === 'RD') return 'RD2008.DEF';
  return null;
}
