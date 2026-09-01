/**
 * Política de segurança do TabWin Bridge — o auxiliar local opcional de
 * download.
 *
 * Vive aqui, e não dentro do executável, por dois motivos: é a parte que
 * precisa de teste unitário de verdade, e é a parte que alguém revisando o
 * projeto vai querer ler antes de instalar qualquer coisa na própria máquina.
 *
 * ## O que este módulo assume
 *
 * O Bridge é um alvo atraente: um processo local que baixa da rede a pedido de
 * uma página web. Se a página puder escolher **qualquer** URL, qualquer nome de
 * arquivo ou qualquer destino, ele deixa de ser um auxiliar e vira um
 * downloader arbitrário controlado remotamente. Por isso a política é uma
 * allowlist fechada, e não uma lista de bloqueios:
 *
 * - só `https`, e só nos hosts do DATASUS que o aplicativo de fato usa;
 * - o caminho também é verificado, não só o host — a URL preparada pelo
 *   DATASUS tem forma conhecida e fixa;
 * - redirecionamento é reavaliado com a mesma regra, porque um `302` para fora
 *   da allowlist anularia a verificação inicial;
 * - o nome do arquivo é derivado no auxiliar, nunca aceito do navegador.
 *
 * Nada aqui depende de rede, então tudo é testável sem o DATASUS no ar.
 */

/** Host e prefixo de caminho de cada origem aceita. */
export interface BridgeAllowedOrigin {
  host: string;
  /** Prefixo obrigatório do caminho. `/` aceita o host inteiro. */
  pathPrefix: string;
  /** Sufixo obrigatório, quando a origem publica um nome fixo. */
  pathSuffix?: string;
  /** Para que serve, em uma linha - vai na documentação e na tela de ajuda. */
  purpose: string;
}

/**
 * As únicas origens que o Bridge pode buscar.
 *
 * Curta de propósito. Ampliar isto é uma decisão de segurança, não uma
 * conveniência: cada linha nova é uma coisa a mais que uma página web
 * comprometida poderia mandar o processo local buscar.
 */
export const BRIDGE_ALLOWED_ORIGINS: readonly BridgeAllowedOrigin[] = [
  {
    host: 'datasus.saude.gov.br',
    pathPrefix: '/wp-content/zipupload/',
    pathSuffix: '/arquivo.zip',
    purpose: 'pacote preparado pelo próprio catálogo oficial a cada pedido',
  },
  {
    host: 'ftp.datasus.gov.br',
    pathPrefix: '/dissemin/publicos/',
    purpose: 'árvore pública de microdados do DATASUS',
  },
];

export type BridgeRejectionReason =
  | 'malformed-url'
  | 'protocol-not-allowed'
  | 'host-not-allowed'
  | 'path-not-allowed'
  | 'credentials-not-allowed';

export type BridgeUrlVerdict =
  | { ok: true; url: string; origin: BridgeAllowedOrigin }
  | { ok: false; reason: BridgeRejectionReason; detail: string };

const REJECTION_TEXT: Record<BridgeRejectionReason, string> = {
  'malformed-url': 'o endereço não é uma URL válida',
  'protocol-not-allowed': 'somente https é aceito',
  'host-not-allowed': 'o host não está na lista de origens permitidas',
  'path-not-allowed': 'o caminho não corresponde ao que essa origem publica',
  'credentials-not-allowed': 'a URL não pode carregar usuário ou senha',
};

/** Mensagem em português para quem vê a recusa na interface. */
export function describeBridgeRejection(reason: BridgeRejectionReason): string {
  return REJECTION_TEXT[reason];
}

/**
 * Decide se o Bridge pode buscar esta URL.
 *
 * Recusa por padrão: qualquer coisa que não case exatamente com uma origem da
 * allowlist é negada, e a resposta diz por quê — uma recusa silenciosa faria o
 * usuário achar que o auxiliar está quebrado.
 */
export function validateBridgeUrl(raw: string): BridgeUrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed-url', detail: raw };
  }

  // `http:` fica de fora inclusive para localhost: o Bridge não é um proxy.
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'protocol-not-allowed', detail: url.protocol };
  }
  // `https://user:senha@host` pode enganar a leitura do host a olho nu.
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials-not-allowed', detail: url.host };
  }

  const host = url.hostname.toLowerCase();
  const matchingHost = BRIDGE_ALLOWED_ORIGINS.filter((origin) => origin.host === host);
  if (!matchingHost.length) {
    return { ok: false, reason: 'host-not-allowed', detail: host };
  }

  // `url.pathname` já vem normalizado pelo WHATWG URL, então `..` foi
  // resolvido antes de chegar aqui e não dá para escapar do prefixo.
  const origin = matchingHost.find((candidate) => (
    url.pathname.startsWith(candidate.pathPrefix)
    && (!candidate.pathSuffix || url.pathname.endsWith(candidate.pathSuffix))
  ));
  if (!origin) {
    return { ok: false, reason: 'path-not-allowed', detail: url.pathname };
  }

  return { ok: true, url: url.href, origin };
}

/**
 * Reavalia o destino de um redirecionamento.
 *
 * Sem isto, a allowlist só valeria para o primeiro salto: bastaria uma origem
 * permitida responder `302` para levar o auxiliar a qualquer lugar.
 */
export function validateBridgeRedirect(from: string, to: string): BridgeUrlVerdict {
  const target = /^https?:\/\//i.test(to)
    ? to
    // Redirecionamento relativo é resolvido contra a origem atual.
    : (() => { try { return new URL(to, from).href; } catch { return to; } })();
  return validateBridgeUrl(target);
}

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

/**
 * Deriva um nome de arquivo seguro.
 *
 * O nome **não** é aceito do navegador: ele é derivado da URL já validada e
 * depois conferido. Um nome vindo da página poderia trazer `..`, separador de
 * caminho, fluxo alternativo do NTFS (`arquivo:stream`) ou um nome reservado
 * do Windows — e o destino deixaria de ser a pasta do auxiliar.
 */
export function bridgeFilenameFromUrl(rawUrl: string): string {
  const verdict = validateBridgeUrl(rawUrl);
  if (!verdict.ok) throw new Error(`URL recusada: ${describeBridgeRejection(verdict.reason)}`);

  const url = new URL(verdict.url);
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  // `arquivo.zip` é o nome que o DATASUS dá a todo pacote preparado, então
  // sozinho ele não distingue um download do outro. O segmento anterior é o
  // identificador do pedido e é o que torna o nome útil.
  const parent = url.pathname.split('/').filter(Boolean).slice(-2, -1)[0] ?? '';
  const candidate = last === 'arquivo.zip' && parent ? `${parent}-${last}` : last;

  // Decodifica antes de higienizar: `pathname` mantém `%2F` escapado, então
  // sem este passo `..%2F..%2Fevil.exe` chegaria ao disco como
  // `.._2F.._2Fevil.exe` — inofensivo para travessia, já que barra e dois
  // pontos somem em seguida, mas um nome com `..` é ruído desnecessário.
  let decoded = candidate;
  try { decoded = decodeURIComponent(candidate); } catch { /* mantém o valor cru */ }

  const cleaned = decoded.normalize('NFKC').replace(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = cleaned
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .slice(0, 120);
  if (!trimmed || !SAFE_FILENAME.test(trimmed)) {
    throw new Error('não foi possível derivar um nome de arquivo seguro dessa URL');
  }
  if (isReservedWindowsName(trimmed)) {
    throw new Error(`"${trimmed}" é um nome reservado no Windows`);
  }
  return trimmed;
}

/**
 * Nomes que o Windows trata como dispositivo, com ou sem extensão.
 * Gravar em `CON.zip` não cria arquivo nenhum.
 */
function isReservedWindowsName(name: string): boolean {
  const base = (name.split('.')[0] ?? '').toUpperCase();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base);
}

/** Origens do navegador que o auxiliar aceita conversar. */
export function bridgeAllowedWebOrigins(extra: readonly string[] = []): string[] {
  return [
    'https://redkk123.github.io',
    // Desenvolvimento local do próprio projeto.
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...extra,
  ];
}

/**
 * Resumo legível da allowlist, para a documentação e a tela de ajuda.
 *
 * Existe para que "quais endereços esse programa pode acessar" tenha uma
 * resposta que o usuário lê, em vez de precisar abrir o código.
 */
export function describeBridgeAllowlist(): string[] {
  return BRIDGE_ALLOWED_ORIGINS.map((origin) => (
    `https://${origin.host}${origin.pathPrefix}${origin.pathSuffix ? `…${origin.pathSuffix}` : '…'}`
    + ` — ${origin.purpose}`
  ));
}
