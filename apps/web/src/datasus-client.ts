import { unzip, unzipSync } from 'fflate';
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
import { validateDatasusZipArchive } from '../../../packages/acquisition/src/archive-validation.ts';
import {
  assembleRangedParts,
  planByteRanges,
  rangeHeaderValue,
  readRangeSupport,
  type ByteRange,
  type DownloadStrategy,
  type RangeSupport,
} from '../../../packages/acquisition/src/ranged-download.ts';
import { resolveMicrodatasusCompatibleCandidates } from '../../../packages/acquisition/src/microdatasus-resolver.ts';
import {
  runDatasusBatch,
  type DatasusBatchResult,
} from '../../../packages/acquisition/src/resilient-batch.ts';
import {
  isAbortErrorLike,
  retryAttempts,
  retryCause,
  retryWithPolicy,
  type RetrySuccess,
} from '../../../packages/acquisition/src/retry-policy.ts';
import {
  ARCHIVE_LIMITS,
  classifyArchiveEntry,
  createArchiveBudget,
  type SkippedArchiveEntry,
} from '../../../packages/acquisition/src/archive-limits.ts';

export interface ExtractedArchiveFile {
  name: string;
  bytes: Uint8Array;
}

export interface ExtractedArchive {
  files: ExtractedArchiveFile[];
  /** Entries left out, so the interface can name them instead of hiding them. */
  skipped: SkippedArchiveEntry[];
}

const SUPPORTED_EXTENSIONS = new Set(['DBC', 'DBF', 'DEF', 'CNV', 'MAP']);
const MAX_ARCHIVE_BYTES = ARCHIVE_LIMITS.maxArchiveBytes;
const DATASUS_PROXY_BASE = (import.meta.env.VITE_DATASUS_PROXY_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const TRANSIENT_HTTP = new Set([429, 502, 503, 504]);

class DatasusHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DatasusHttpError';
  }
}

class DatasusTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasusTimeoutError';
  }
}

function endpointFor(endpoint: string): string {
  if (!DATASUS_PROXY_BASE) return endpoint;
  if (endpoint === DATASUS_TRANSFER_ENDPOINT) return `${DATASUS_PROXY_BASE}/catalog`;
  if (endpoint === DATASUS_DOWNLOAD_ENDPOINT) return `${DATASUS_PROXY_BASE}/prepare`;
  return endpoint;
}

function extensionOf(name: string): string {
  return name.includes('.') ? (name.split('.').pop() ?? '').toUpperCase() : '';
}

async function datasusHttpError(response: Response, context: string): Promise<DatasusHttpError> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    try {
      const envelope = await response.clone().json() as unknown;
      if (envelope && typeof envelope === 'object' && 'error' in envelope) {
        const error = (envelope as { error?: unknown }).error;
        if (error && typeof error === 'object' && 'message' in error
          && typeof (error as { message?: unknown }).message === 'string') {
          return new DatasusHttpError(response.status, `${context}: ${(error as { message: string }).message}`);
        }
      }
    } catch {
      // Fall back to the stable HTTP envelope below.
    }
  }
  return new DatasusHttpError(response.status, `${context}: HTTP ${response.status}`);
}

function shouldRetryDatasus(error: unknown): boolean {
  return error instanceof DatasusHttpError ? TRANSIENT_HTTP.has(error.status)
    : error instanceof DatasusTimeoutError || error instanceof TypeError;
}

function readableError(error: unknown): string {
  const cause = retryCause(error);
  return cause instanceof Error ? cause.message : String(cause);
}

async function postForm(endpoint: string, body: URLSearchParams, signal?: AbortSignal): Promise<string> {
  const timeout = new AbortController();
  const timer = globalThis.setTimeout(() => timeout.abort(), 30_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let response: Response;
  try {
    response = await fetch(endpointFor(endpoint), {
      method: 'POST',
      body,
      signal: requestSignal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (timeout.signal.aborted) throw new DatasusTimeoutError('O DATASUS não respondeu em 30 segundos');
    if (!DATASUS_PROXY_BASE && error instanceof TypeError) {
      throw new Error('O portal DATASUS bloqueou a consulta direta deste domínio. Abra um DBC local ou use uma implantação com proxy DATASUS configurado.');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (!response.ok) throw await datasusHttpError(response, 'Falha na consulta ao DATASUS');
  return response.text();
}

async function searchOfficialFilesOnce(query: DatasusSearchQuery, signal?: AbortSignal): Promise<DatasusRemoteFile[]> {
  return parseSearchResponse(await postForm(DATASUS_TRANSFER_ENDPOINT, buildSearchBody(query), signal));
}

export function searchOfficialFilesDetailed(query: DatasusSearchQuery, signal?: AbortSignal): Promise<RetrySuccess<DatasusRemoteFile[]>> {
  return retryWithPolicy(() => searchOfficialFilesOnce(query, signal), {
    ...(signal ? { signal } : {}), maxAttempts: 3, shouldRetry: shouldRetryDatasus,
  });
}

export async function searchOfficialFiles(query: DatasusSearchQuery, signal?: AbortSignal): Promise<DatasusRemoteFile[]> {
  return (await searchOfficialFilesDetailed(query, signal)).value;
}

/** The official form accepts one period/UF tuple; batch it deterministically. */
export async function searchOfficialFilesBatch(
  queries: readonly DatasusSearchQuery[],
  signal?: AbortSignal,
): Promise<DatasusRemoteFile[]> {
  return (await searchOfficialCatalogBatch(queries, signal)).files;
}

export interface CatalogSearchProgress {
  completed: number;
  total: number;
  /** Arquivos encontrados até agora, na ordem em que apareceram. */
  files: DatasusRemoteFile[];
}

/**
 * Consulta o catálogo, avisando a cada combinação resolvida.
 *
 * O `onProgress` existe por um defeito de uso real: antes o resultado só era
 * desenhado quando o lote INTEIRO terminava. Com dezenas de combinações num
 * servidor que oscila, isso podia levar minutos — e cancelar fazia o lote
 * devolver o parcial, então os arquivos "só apareciam quando você cancelava".
 * Quem via isso concluía, com razão, que a busca estava quebrada.
 */
export async function searchOfficialCatalogBatch(
  queries: readonly DatasusSearchQuery[],
  signal?: AbortSignal,
  onProgress?: (progress: CatalogSearchProgress) => void,
): Promise<{
  files: DatasusRemoteFile[];
  availability: DatasusAvailabilityManifest;
  batch: DatasusBatchResult<DatasusSearchQuery, DatasusRemoteFile[]>;
}> {
  const found: DatasusRemoteFile[] = [];
  const batch = await runDatasusBatch<DatasusSearchQuery, DatasusRemoteFile[]>(queries, async (query) => {
    try {
      const primary = await searchOfficialFilesDetailed(query, signal);
      const files = primary.value.map((file) => ({
        ...file,
        catalogQuery: { ...query },
        resolver: 'primary' as const,
        resolverAttempts: primary.attempts,
      }));
      return {
        status: files.length ? 'FOUND' as const : 'NOT_PUBLISHED' as const,
        value: files,
        resolver: 'primary' as const,
        attempts: primary.attempts,
      };
    } catch (primaryError) {
      if (isAbortErrorLike(primaryError) || signal?.aborted) throw primaryError;
      const candidates = resolveMicrodatasusCompatibleCandidates(query);
      if (!candidates.length) {
        return {
          status: 'LOOKUP_FAILED' as const,
          resolver: 'primary' as const,
          attempts: retryAttempts(primaryError),
          error: `${readableError(primaryError)} Fallback seguro indisponível para esta combinação.`,
        };
      }
      let attempts = retryAttempts(primaryError);
      let lastError: unknown = primaryError;
      for (const candidate of candidates) {
        try {
          // Preparing through the independent official endpoint verifies the
          // evidence-derived FTP candidate without downloading it twice.
          const prepared = await prepareOfficialDownloadDetailed([candidate], signal);
          attempts += prepared.attempts;
          return {
            status: 'FOUND' as const,
            resolver: 'microdatasus-compatible' as const,
            attempts,
            value: [{
              ...candidate,
              preparedUrl: prepared.value,
              preparedAt: Date.now(),
              resolverAttempts: attempts,
            }],
          };
        } catch (fallbackError) {
          if (isAbortErrorLike(fallbackError) || signal?.aborted) throw fallbackError;
          attempts += retryAttempts(fallbackError);
          lastError = fallbackError;
        }
      }
      return {
        status: 'LOOKUP_FAILED' as const,
        resolver: 'microdatasus-compatible' as const,
        attempts,
        error: readableError(lastError),
      };
    }
  }, {
    ...(signal ? { signal } : {}),
    failureStatus: 'LOOKUP_FAILED',
    // Consultar catálogo é POST pequeno; baixar arquivo continua em fila.
    // Seis é comedido: o servidor oscila, e a intenção é sair da fila, não
    // transformar uma busca em ataque.
    concurrency: 6,
    ...(onProgress
      ? {
        onProgress: (progress) => {
          if (progress.item.status === 'FOUND') found.push(...(progress.item.value ?? []));
          // Uma cópia: quem desenha não pode segurar referência para um vetor
          // que ainda vai crescer por baixo dele.
          onProgress({ completed: progress.completed, total: progress.total, files: [...found] });
        },
      }
      : {}),
  });

  const results: DatasusCatalogQueryResult[] = batch.items.flatMap((item) => {
    if (item.status !== 'FOUND' && item.status !== 'NOT_PUBLISHED') return [];
    return [{ query: { ...item.request }, files: item.value ?? [] }];
  });
  const files = deduplicateRemoteFiles(batch.items.flatMap((item) => item.status === 'FOUND' ? item.value ?? [] : []));
  return { files, availability: buildAvailabilityManifest(results), batch };
}

export async function searchOfficialAuxiliaries(system: string, signal?: AbortSignal): Promise<DatasusRemoteFile[]> {
  return (await retryWithPolicy(
    () => postForm(DATASUS_TRANSFER_ENDPOINT, buildAuxiliarySearchBody(system), signal).then(parseSearchResponse),
    { ...(signal ? { signal } : {}), maxAttempts: 3, shouldRetry: shouldRetryDatasus },
  )).value;
}

async function prepareOfficialDownloadOnce(files: readonly DatasusRemoteFile[], signal?: AbortSignal): Promise<string> {
  return parsePreparedDownloadResponse(await postForm(DATASUS_DOWNLOAD_ENDPOINT, buildDownloadBody(files), signal));
}

export function prepareOfficialDownloadDetailed(files: readonly DatasusRemoteFile[], signal?: AbortSignal): Promise<RetrySuccess<string>> {
  return retryWithPolicy(() => prepareOfficialDownloadOnce(files, signal), {
    ...(signal ? { signal } : {}), maxAttempts: 3, shouldRetry: shouldRetryDatasus,
  });
}

export async function prepareOfficialDownload(files: readonly DatasusRemoteFile[], signal?: AbortSignal): Promise<string> {
  return (await prepareOfficialDownloadDetailed(files, signal)).value;
}

export interface ArchiveDownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
}

/**
 * Como o último download foi obtido, para a interface poder dizer.
 *
 * Sem isso, um download lento parece azar. Com isso, dá para saber se o
 * caminho paralelo sequer entrou em ação — e por que não entrou.
 */
export interface LastDownloadTransport {
  strategy: DownloadStrategy;
  parts: number;
  reason?: string;
}

let lastDownloadTransport: LastDownloadTransport = { strategy: 'única conexão', parts: 1 };

export function readLastDownloadTransport(): LastDownloadTransport {
  return { ...lastDownloadTransport };
}

function archiveEndpoint(url: string): string {
  return DATASUS_PROXY_BASE
    ? `${DATASUS_PROXY_BASE}/archive?url=${encodeURIComponent(url)}`
    : url;
}

/**
 * Pergunta ao servidor se ele entrega faixas de bytes.
 *
 * Pede um byte só. Uma promessa em `Accept-Ranges` não basta: há servidor que
 * anuncia e ignora, e descobrir isso no meio da montagem daria um arquivo com
 * pedaços trocados. O que conta é um 206 com `Content-Range` coerente.
 *
 * Qualquer falha aqui é respondida com "não dá" — a sondagem nunca pode ser o
 * motivo de o download não acontecer.
 */
async function probeRangeSupport(downloadUrl: string, signal?: AbortSignal): Promise<RangeSupport> {
  const probe: ByteRange = { start: 0, end: 0 };
  try {
    const response = await fetch(downloadUrl, {
      headers: { Range: rangeHeaderValue(probe) },
      ...(signal ? { signal } : {}),
    });
    // O corpo não interessa; soltar evita segurar a conexão.
    await response.body?.cancel();
    return readRangeSupport(response.status, response.headers.get('content-range'), probe);
  } catch (error) {
    if (isAbortErrorLike(error) || signal?.aborted) throw error;
    return { supported: false, reason: 'a sondagem de faixa falhou' };
  }
}

/**
 * Baixa em partes paralelas, ou devolve `null` para o chamador seguir pelo
 * caminho simples.
 *
 * Devolve `null` em vez de lançar sempre que a paralelização não se
 * justifica ou não se confirma. Esta é uma otimização: ela não pode ser a
 * causa de um download falhar.
 */
async function fetchArchiveInParts(
  downloadUrl: string,
  signal?: AbortSignal,
  onProgress?: (progress: ArchiveDownloadProgress) => void,
): Promise<Uint8Array | null> {
  const support = await probeRangeSupport(downloadUrl, signal);
  if (!support.supported) {
    lastDownloadTransport = { strategy: 'única conexão', parts: 1, reason: support.reason };
    return null;
  }
  if (support.totalBytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Arquivo remoto excede o limite de segurança');
  }
  const ranges = planByteRanges(support.totalBytes);
  if (ranges.length < 2) {
    lastDownloadTransport = { strategy: 'única conexão', parts: 1, reason: 'arquivo pequeno demais para dividir' };
    return null;
  }

  let receivedBytes = 0;
  const parts = await Promise.all(ranges.map(async (range) => {
    const response = await fetch(downloadUrl, {
      headers: { Range: rangeHeaderValue(range) },
      ...(signal ? { signal } : {}),
    });
    if (response.status !== 206) {
      throw new Error(`parte ${range.start}-${range.end}: servidor respondeu ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    receivedBytes += bytes.byteLength;
    onProgress?.({ receivedBytes, totalBytes: support.totalBytes });
    return { range, bytes };
  }));

  // Montagem confere tamanho e sequência; qualquer desencontro lança, e o
  // chamador cai no caminho simples em vez de aceitar bytes suspeitos.
  const archive = assembleRangedParts(parts, support.totalBytes);
  lastDownloadTransport = { strategy: 'partes paralelas', parts: ranges.length };
  return archive;
}

async function fetchOfficialArchiveOnce(
  url: string,
  signal?: AbortSignal,
  onProgress?: (progress: ArchiveDownloadProgress) => void,
): Promise<Uint8Array> {
  const downloadUrl = archiveEndpoint(url);

  // Tenta o caminho paralelo primeiro. Se ele não se confirmar, ou falhar por
  // qualquer motivo que não seja cancelamento, o download simples acontece
  // como sempre aconteceu — a otimização não pode custar o arquivo.
  try {
    const inParts = await fetchArchiveInParts(downloadUrl, signal, onProgress);
    if (inParts) {
      validateDatasusZipArchive(inParts, 'application/zip');
      return inParts;
    }
  } catch (error) {
    if (isAbortErrorLike(error) || signal?.aborted) throw error;
    lastDownloadTransport = {
      strategy: 'única conexão',
      parts: 1,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const response = await fetch(downloadUrl, signal ? { signal } : {});
  if (!response.ok) throw await datasusHttpError(response, 'Falha no download DATASUS');
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_ARCHIVE_BYTES) throw new Error('Arquivo remoto excede o limite de segurança');
  const totalBytes = length > 0 ? length : undefined;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Arquivo remoto excede o limite de segurança');
    onProgress?.({ receivedBytes: bytes.byteLength, ...(totalBytes ? { totalBytes } : {}) });
    validateDatasusZipArchive(bytes, response.headers.get('content-type'));
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
  validateDatasusZipArchive(archive, response.headers.get('content-type'));
  return archive;
}

export function fetchOfficialArchiveDetailed(
  url: string,
  signal?: AbortSignal,
  onProgress?: (progress: ArchiveDownloadProgress) => void,
): Promise<RetrySuccess<Uint8Array>> {
  return retryWithPolicy(() => fetchOfficialArchiveOnce(url, signal, onProgress), {
    ...(signal ? { signal } : {}), maxAttempts: 3, shouldRetry: shouldRetryDatasus,
  });
}

export async function fetchOfficialArchive(
  url: string,
  signal?: AbortSignal,
  onProgress?: (progress: ArchiveDownloadProgress) => void,
): Promise<Uint8Array> {
  return (await fetchOfficialArchiveDetailed(url, signal, onProgress)).value;
}

/**
 * Expands an official archive, keeping every supported file it can.
 *
 * A single entry past the per-file limit is skipped and reported rather than
 * aborting the whole archive: an auxiliary bundle's DEF and CNV files are
 * small and are the reason to open it, and losing them because one lookup
 * table is oversized helps nobody. Aggregate breaches remain fatal - see
 * `packages/acquisition/src/archive-limits.ts`.
 */
export function extractSupportedArchive(archive: Uint8Array): ExtractedArchive {
  const output: ExtractedArchiveFile[] = [];
  const budget = createArchiveBudget();
  const isWanted = (name: string): boolean => {
    const extension = extensionOf(name);
    return extension === 'ZIP' || SUPPORTED_EXTENSIONS.has(extension);
  };

  const visit = (bytes: Uint8Array, depth: number): void => {
    if (depth > ARCHIVE_LIMITS.maxDepth) throw new Error('ZIP aninhado além do limite suportado');
    const entries = unzipSync(bytes, {
      filter: (entry) => classifyArchiveEntry(entry, budget, isWanted).action === 'take',
    });
    for (const [name, content] of Object.entries(entries)) {
      if (extensionOf(name) === 'ZIP') visit(content, depth + 1);
      else output.push({ name, bytes: content });
    }
  };

  visit(archive, 0);
  return { files: output, skipped: budget.skipped };
}

/**
 * A mesma expansão, sem travar a interface.
 *
 * `unzipSync` roda na thread principal: medido, um pacote de 25 MB congelava a
 * tela por ~600 ms em dois blocos. O total nem era o pior — tela morta parece
 * defeito mesmo quando o número é aceitável. A versão assíncrona do fflate faz
 * o trabalho fora da thread.
 *
 * A política de limites é a MESMA função, então nada afrouxa por ser assíncrono.
 */
export function extractSupportedArchiveAsync(archive: Uint8Array): Promise<ExtractedArchive> {
  const budget = createArchiveBudget();
  const isWanted = (name: string): boolean => {
    const extension = extensionOf(name);
    return extension === 'ZIP' || SUPPORTED_EXTENSIONS.has(extension);
  };
  return new Promise((resolve, reject) => {
    unzip(archive, {
      filter: (entry) => classifyArchiveEntry(entry, budget, isWanted).action === 'take',
    }, (error, entries) => {
      if (error) { reject(error); return; }
      const output: ExtractedArchiveFile[] = [];
      try {
        for (const [name, content] of Object.entries(entries)) {
          // ZIP aninhado é raro e pequeno; resolver aqui de forma síncrona
          // evita uma cascata de callbacks para um caso que não pesa.
          if (extensionOf(name) === 'ZIP') output.push(...extractSupportedArchive(content).files);
          else output.push({ name, bytes: content });
        }
      } catch (nested) { reject(nested); return; }
      resolve({ files: output, skipped: budget.skipped });
    });
  });
}

/** Files only, for callers with nothing to report. */
export function extractSupportedArchiveFiles(archive: Uint8Array): ExtractedArchiveFile[] {
  return extractSupportedArchive(archive).files;
}

/**
 * Expands exactly one named entry, ignoring the per-file eager limit.
 *
 * The limit exists so a huge member is not expanded *automatically* into a tab
 * that also has to hold the data being tabulated. It is not a claim that the
 * file must never be read. When the user asks for that specific file by name -
 * to save it and use it outside the browser - the cost is theirs to accept and
 * the guard has already done its job.
 *
 * Everything else still holds: only this entry is expanded, and the archive it
 * comes from was already bounded on download.
 */
export function extractOneArchiveEntry(archive: Uint8Array, wantedName: string): Uint8Array {
  let found: Uint8Array | null = null;
  const visit = (bytes: Uint8Array, depth: number): void => {
    if (found || depth > ARCHIVE_LIMITS.maxDepth) return;
    const entries = unzipSync(bytes, {
      filter: (entry) => entry.name === wantedName
        || (extensionOf(entry.name) === 'ZIP' && !found),
    });
    for (const [name, content] of Object.entries(entries)) {
      if (name === wantedName) { found = content; return; }
      if (extensionOf(name) === 'ZIP') visit(content, depth + 1);
    }
  };
  visit(archive, 0);
  if (!found) throw new Error(`${wantedName} não foi encontrado no pacote`);
  return found;
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
