/**
 * Cliente do TabWin Bridge — o lado do aplicativo web.
 *
 * Duas regras que atravessam este módulo inteiro:
 *
 * 1. **O auxiliar nunca é iniciado pelo navegador.** Uma página não deve poder
 *    executar programa na máquina de ninguém. Tudo aqui pressupõe que a pessoa
 *    já subiu o auxiliar por conta própria e colou o token; o máximo que o
 *    aplicativo faz é *perguntar* se ele está no ar.
 * 2. **Ele é oferecido, não usado sozinho.** O caminho normal continua sendo o
 *    navegador. O auxiliar aparece depois de uma falha em que ele plausivelmente
 *    ajudaria, e mesmo aí é o usuário quem decide.
 *
 * Não depende de DOM, então dá para testar sem navegador e sem rede.
 */

export const BRIDGE_DEFAULT_PORT = 8787;
export const BRIDGE_SUPPORTED_PROTOCOL = 1;

export interface BridgeHealth {
  service: string;
  protocol: number;
  allowlist: string[];
  directory: string;
}

export type BridgeProbe =
  | { available: true; health: BridgeHealth; baseUrl: string }
  | { available: false; reason: 'offline' | 'incompatible' | 'unexpected'; detail: string };

export type BridgeJobStatus = 'pending' | 'downloading' | 'done' | 'failed' | 'cancelled';

export interface BridgeJob {
  id: string;
  url: string;
  filename: string;
  status: BridgeJobStatus;
  receivedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number | null;
  error: string | null;
  path: string | null;
}

export interface BridgeClientOptions {
  baseUrl?: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export function bridgeBaseUrl(port = BRIDGE_DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Pergunta se o auxiliar está no ar.
 *
 * Falha de rede aqui é o caso **comum**, não excepcional: quase ninguém tem o
 * auxiliar rodando. Por isso "offline" é um resultado, não um erro — tratar
 * como erro encheria o console de ruído a cada verificação.
 */
export async function probeBridge(
  baseUrl = bridgeBaseUrl(),
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<BridgeProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: controller.signal });
    if (!response.ok) {
      return { available: false, reason: 'unexpected', detail: `HTTP ${response.status}` };
    }
    const health = await response.json() as BridgeHealth;
    if (health.service !== 'tabwin-bridge') {
      return { available: false, reason: 'unexpected', detail: 'outro serviço responde nessa porta' };
    }
    // Versão diferente é recusa explícita, não tentativa de adivinhar o
    // protocolo: um auxiliar mais novo pode ter mudado o contrato.
    if (health.protocol !== BRIDGE_SUPPORTED_PROTOCOL) {
      return {
        available: false,
        reason: 'incompatible',
        detail: `o auxiliar fala a versão ${health.protocol} e este aplicativo fala a ${BRIDGE_SUPPORTED_PROTOCOL}`,
      };
    }
    return { available: true, health, baseUrl };
  } catch (error) {
    return {
      available: false,
      reason: 'offline',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function bridgeRequest<T>(
  options: BridgeClientOptions,
  route: string,
  init: RequestInit = {},
): Promise<T> {
  const call = options.fetchImpl ?? fetch;
  const response = await call(`${options.baseUrl ?? bridgeBaseUrl()}${route}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${options.token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `HTTP ${response.status}`;
    // 401 tem tratamento próprio na interface: é o único que o usuário
    // resolve sozinho, colando o token de novo.
    const error = new Error(response.status === 401 ? `token recusado: ${detail}` : detail);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return payload as T;
}

export function startBridgeDownload(options: BridgeClientOptions, url: string): Promise<BridgeJob> {
  return bridgeRequest<BridgeJob>(options, '/downloads', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export function readBridgeJob(options: BridgeClientOptions, id: string): Promise<BridgeJob> {
  return bridgeRequest<BridgeJob>(options, `/downloads/${id}`);
}

export function cancelBridgeDownload(options: BridgeClientOptions, id: string): Promise<BridgeJob> {
  return bridgeRequest<BridgeJob>(options, `/downloads/${id}/cancel`, { method: 'POST' });
}

/**
 * Decide se vale oferecer o auxiliar depois de uma falha.
 *
 * Só para falhas em que ele **plausivelmente** ajudaria: rede, CORS, timeout,
 * indisponibilidade do servidor. Oferecer diante de qualquer erro treinaria a
 * pessoa a ignorar a oferta — e diante de um erro que ele não resolve, seria
 * mandar instalar um programa à toa.
 */
export function bridgeWouldHelp(error: unknown): boolean {
  if (!error) return false;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const status = (error as { status?: number }).status;
  if (typeof status === 'number') {
    // 4xx de conteúdo (arquivo não existe, pedido inválido) não melhora com
    // outro transporte; 408/429 e 5xx são instabilidade.
    if (status === 408 || status === 429 || status >= 500) return true;
    if (status >= 400) return false;
  }
  return [
    'failed to fetch', 'networkerror', 'load failed',
    'cors', 'timeout', 'tempo esgotado', 'aborted',
    'proxy', 'gateway', 'econnreset', 'network',
  ].some((needle) => message.includes(needle));
}

/** Como o download foi obtido, para a interface dizer sem inventar. */
export type BridgeTransport = 'navegador' | 'downloader local';

export function describeBridgeProbe(probe: BridgeProbe): string {
  if (probe.available) {
    return `Downloader local disponível — salva em ${probe.health.directory}`;
  }
  switch (probe.reason) {
    case 'offline':
      return 'Downloader local não está rodando nesta máquina.';
    case 'incompatible':
      return `Downloader local incompatível: ${probe.detail}`;
    default:
      return `Não foi possível falar com o downloader local: ${probe.detail}`;
  }
}
