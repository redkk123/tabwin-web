const DATASUS_ORIGIN = 'https://datasus.saude.gov.br';
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const ARCHIVE_PATH = /^\/wp-content\/zipupload\/[^/]+\/arquivo\.zip$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ARCHIVE_CONTENT_TYPES = new Set([
  'application/zip',
  'application/octet-stream',
  'application/x-zip-compressed',
]);

const ROUTES = Object.freeze({
  '/health': Object.freeze({ name: 'health', method: 'GET' }),
  '/catalog': Object.freeze({ name: 'catalog', method: 'POST' }),
  '/prepare': Object.freeze({ name: 'prepare', method: 'POST' }),
  '/archive': Object.freeze({ name: 'archive', method: 'GET' }),
});

const DEFAULTS = Object.freeze({
  maxFormBytes: 64 * 1024,
  maxFormResponseBytes: 4 * 1024 * 1024,
  maxArchiveBytes: 512 * 1024 * 1024,
  formTimeoutMs: 30_000,
  // Prazo para o DATASUS ENTREGAR A RESPOSTA, não para o cliente terminar de
  // baixar. Ver `handleArchive`: já foi a segunda coisa, e cortava o corpo no
  // meio de quem estava numa conexão lenta.
  archiveTimeoutMs: 180_000,
  // Quanto se espera por UM pedaço do DATASUS, com a leitura já pendente.
  // Limita origem travada sem punir cliente lento.
  archiveIdleTimeoutMs: 60_000,
  maxRedirects: 3,
});

class ProxyFailure extends Error {
  constructor(status, code, message, headers = undefined) {
    super(message);
    this.name = 'ProxyFailure';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function numericSetting(environment, name, fallback, minimum, maximum) {
  const raw = environment?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) return fallback;
  return value;
}

function settings(environment) {
  return {
    maxFormBytes: numericSetting(environment, 'MAX_FORM_BYTES', DEFAULTS.maxFormBytes, 1024, 1024 * 1024),
    maxFormResponseBytes: numericSetting(
      environment,
      'MAX_FORM_RESPONSE_BYTES',
      DEFAULTS.maxFormResponseBytes,
      64 * 1024,
      16 * 1024 * 1024,
    ),
    maxArchiveBytes: numericSetting(
      environment,
      'MAX_ARCHIVE_BYTES',
      DEFAULTS.maxArchiveBytes,
      1024 * 1024,
      1024 * 1024 * 1024,
    ),
    formTimeoutMs: numericSetting(environment, 'FORM_TIMEOUT_MS', DEFAULTS.formTimeoutMs, 1000, 120_000),
    archiveTimeoutMs: numericSetting(
      environment,
      'ARCHIVE_TIMEOUT_MS',
      DEFAULTS.archiveTimeoutMs,
      10_000,
      600_000,
    ),
    archiveIdleTimeoutMs: numericSetting(
      environment,
      'ARCHIVE_IDLE_TIMEOUT_MS',
      DEFAULTS.archiveIdleTimeoutMs,
      5_000,
      300_000,
    ),
    maxRedirects: numericSetting(environment, 'MAX_REDIRECTS', DEFAULTS.maxRedirects, 0, 5),
  };
}

function canonicalConfiguredOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredAllowedOrigins(environment = {}) {
  const raw = environment.ALLOWED_ORIGINS ?? environment.ALLOWED_ORIGIN ?? '';
  return [...new Set(String(raw).split(',')
    .map((value) => canonicalConfiguredOrigin(value.trim()))
    .filter((value) => value !== null))];
}

function acceptedOrigin(request, environment) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return configuredAllowedOrigins(environment).includes(origin) ? origin : null;
}

function baseHeaders(origin = null, cacheControl = 'no-store') {
  const headers = new Headers({
    'Cache-Control': cacheControl,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Vary': 'Origin',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    // Accept-Ranges e Content-Range: sem expor, o navegador esconde do
    // JavaScript e o download em partes não teria como se verificar.
    headers.set(
      'Access-Control-Expose-Headers',
      'Accept-Ranges, Content-Disposition, Content-Length, Content-Range, Content-Type, ETag, Last-Modified',
    );
  }
  return headers;
}

function errorResponse(failure, origin = null) {
  const headers = baseHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (failure.headers) {
    for (const [name, value] of Object.entries(failure.headers)) headers.set(name, value);
  }
  return new Response(JSON.stringify({
    error: {
      code: failure.code,
      message: failure.message,
    },
  }), { status: failure.status, headers });
}

function routeForRequest(requestUrl) {
  const url = new URL(requestUrl);
  const route = ROUTES[url.pathname];
  if (!route) throw new ProxyFailure(404, 'route_not_found', 'Proxy route not found');
  if (route.name !== 'archive' && url.search) {
    throw new ProxyFailure(400, 'unexpected_query', 'This proxy route does not accept query parameters');
  }
  return { ...route, url };
}

export function validateArchiveTarget(candidate) {
  let target;
  try {
    target = new URL(candidate);
  } catch {
    throw new ProxyFailure(400, 'invalid_archive_target', 'Archive target is not a valid URL');
  }
  if (target.protocol !== 'https:' || target.hostname !== 'datasus.saude.gov.br'
    || target.port || target.username || target.password || target.search || target.hash
    || !ARCHIVE_PATH.test(target.pathname)) {
    throw new ProxyFailure(
      400,
      'invalid_archive_target',
      'Archive target is not an official prepared DATASUS URL',
    );
  }
  return target;
}

export function targetForRequest(requestUrl) {
  const { name, url } = routeForRequest(requestUrl);
  if (name === 'catalog') return `${DATASUS_ORIGIN}/wp-content/ftp.php`;
  if (name === 'prepare') return `${DATASUS_ORIGIN}/wp-content/download.php`;
  if (name === 'archive') {
    const candidate = url.searchParams.get('url');
    if (!candidate || [...url.searchParams.keys()].some((key) => key !== 'url')
      || url.searchParams.getAll('url').length !== 1) {
      throw new ProxyFailure(400, 'invalid_archive_target', 'Archive route requires exactly one url parameter');
    }
    return validateArchiveTarget(candidate).href;
  }
  throw new ProxyFailure(400, 'route_has_no_target', 'This proxy route has no upstream target');
}

function validateUpstreamTarget(routeName, target) {
  if (routeName === 'catalog' && target.href === `${DATASUS_ORIGIN}/wp-content/ftp.php`) return;
  if (routeName === 'prepare' && target.href === `${DATASUS_ORIGIN}/wp-content/download.php`) return;
  if (routeName === 'archive') {
    validateArchiveTarget(target.href);
    return;
  }
  throw new ProxyFailure(502, 'upstream_redirect_rejected', 'DATASUS redirected outside the approved route');
}

/**
 * Aceita apenas uma faixa simples de bytes, com início e fim explícitos.
 *
 * Nada de faixa aberta, faixa múltipla ou sufixo. Cada uma dessas formas tem
 * resposta diferente (multipart, por exemplo), e repassar sem entender daria
 * ao cliente um corpo que ele montaria errado. O que o aplicativo usa é
 * exatamente esta forma; o resto é recusado e vira download inteiro.
 */
function safeRangeHeader(value) {
  if (!value) return null;
  const match = /^bytes=(\d{1,15})-(\d{1,15})$/.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) return null;
  return `bytes=${start}-${end}`;
}

function contentLength(headers, failureStatus, failureCode) {
  const raw = headers.get('Content-Length');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new ProxyFailure(failureStatus, failureCode, 'Invalid Content-Length header');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ProxyFailure(failureStatus, failureCode, 'Invalid Content-Length header');
  return value;
}

async function readBoundedBody(body, maximum, failure) {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw failure;
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readFormBody(request, maximum) {
  const mediaType = (request.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== FORM_CONTENT_TYPE) {
    throw new ProxyFailure(415, 'unsupported_media_type', `Content-Type must be ${FORM_CONTENT_TYPE}`);
  }
  const declared = contentLength(request.headers, 400, 'invalid_content_length');
  if (declared !== null && declared > maximum) {
    throw new ProxyFailure(413, 'request_too_large', 'Form request exceeds the proxy size limit');
  }
  const body = await readBoundedBody(
    request.body,
    maximum,
    new ProxyFailure(413, 'request_too_large', 'Form request exceeds the proxy size limit'),
  );
  if (body.byteLength === 0) throw new ProxyFailure(400, 'empty_form', 'Form request cannot be empty');
  return body;
}

function timeoutController(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('upstream timeout'), milliseconds);
  return {
    controller,
    dispose: () => clearTimeout(timer),
  };
}

async function fetchWithValidatedRedirects(routeName, initialTarget, init, signal, maximumRedirects) {
  let target = new URL(initialTarget);
  let redirects = 0;
  while (true) {
    validateUpstreamTarget(routeName, target);
    const response = await fetch(target, { ...init, redirect: 'manual', signal });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects >= maximumRedirects) {
      await response.body?.cancel();
      throw new ProxyFailure(502, 'too_many_redirects', 'DATASUS returned too many redirects');
    }
    if (init.method === 'POST' && ![307, 308].includes(response.status)) {
      await response.body?.cancel();
      throw new ProxyFailure(502, 'upstream_redirect_rejected', 'DATASUS attempted to change the approved POST request');
    }
    const location = response.headers.get('Location');
    await response.body?.cancel();
    if (!location) throw new ProxyFailure(502, 'invalid_upstream_redirect', 'DATASUS returned a redirect without a location');
    target = new URL(location, target);
    validateUpstreamTarget(routeName, target);
    redirects++;
  }
}

function normalizedUnexpectedFailure(error, signal) {
  if (error instanceof ProxyFailure) return error;
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
    return new ProxyFailure(504, 'upstream_timeout', 'DATASUS did not respond before the proxy timeout');
  }
  return new ProxyFailure(502, 'upstream_unavailable', 'DATASUS could not be reached by the proxy');
}

function upstreamHttpFailure(status) {
  // Um 404 passa como 404. O DATASUS responde o endereço do pacote preparado
  // antes de terminar de escrevê-lo, e nesse intervalo o arquivo não existe:
  // "ainda não" é informação que o cliente usa para esperar, enquanto 502 diz
  // apenas "deu ruim lá em cima" e faz ele tentar de novo à toa.
  if (status === 404) {
    return new ProxyFailure(404, 'upstream_not_found', 'DATASUS returned HTTP 404');
  }
  return new ProxyFailure(502, 'upstream_http_error', `DATASUS returned HTTP ${status}`);
}

function safeUpstreamHeader(source, name) {
  const value = source.get(name);
  return value && !/[\r\n]/.test(value) ? value : null;
}

async function handleForm(routeName, request, environment, origin, proxySettings) {
  const body = await readFormBody(request, proxySettings.maxFormBytes);
  const timed = timeoutController(proxySettings.formTimeoutMs);
  try {
    const upstream = await fetchWithValidatedRedirects(routeName, targetForRequest(request.url), {
      method: 'POST',
      body,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': FORM_CONTENT_TYPE,
      },
    }, timed.controller.signal, proxySettings.maxRedirects);
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw upstreamHttpFailure(upstream.status);
    }
    const declared = contentLength(upstream.headers, 502, 'invalid_upstream_length');
    if (declared !== null && declared > proxySettings.maxFormResponseBytes) {
      await upstream.body?.cancel();
      throw new ProxyFailure(502, 'upstream_response_too_large', 'DATASUS response exceeds the proxy size limit');
    }
    const bytes = await readBoundedBody(
      upstream.body,
      proxySettings.maxFormResponseBytes,
      new ProxyFailure(502, 'upstream_response_too_large', 'DATASUS response exceeds the proxy size limit'),
    );
    const headers = baseHeaders(origin);
    headers.set('Content-Type', safeUpstreamHeader(upstream.headers, 'Content-Type') ?? 'text/plain; charset=utf-8');
    headers.set('Content-Length', String(bytes.byteLength));
    return new Response(bytes, { status: 200, headers });
  } catch (error) {
    throw normalizedUnexpectedFailure(error, timed.controller.signal);
  } finally {
    timed.dispose();
  }
}

/**
 * Repassa o corpo contando bytes, com relógio de OCIOSIDADE em vez de prazo total.
 *
 * O relógio corre apenas enquanto uma leitura ao DATASUS está pendente. Cliente
 * lento não o aciona: com contrapressão, `pull` simplesmente demora a ser
 * chamado de novo, e nesse intervalo não há leitura correndo. Origem travada,
 * essa sim, deixa uma leitura pendente para sempre — e é o que se quer cortar.
 *
 * A versão anterior usava um prazo único armado antes do `fetch` e desarmado
 * só no fim do fluxo. Como o sinal aborta a resposta de origem, ele limitava o
 * download INTEIRO do cliente: a 0,6 MB/s o teto era ~108 MB, e o que passava
 * disso chegava truncado — "invalid zip data" no navegador, sem pista nenhuma
 * de que a causa era um relógio nosso.
 */
function boundedArchiveStream(body, maximum, guard) {
  const reader = body.getReader();
  let size = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
  };
  return new ReadableStream({
    async pull(controller) {
      let ocioso = null;
      try {
        ocioso = setTimeout(() => guard.abortStalled(), guard.idleMs);
        const { done, value } = await reader.read();
        clearTimeout(ocioso);
        ocioso = null;
        if (done) {
          finish();
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel('archive exceeded proxy size limit');
          finish();
          controller.error(new Error('archive exceeded proxy size limit'));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        if (ocioso !== null) clearTimeout(ocioso);
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}

/**
 * Repassa o pacote oficial.
 *
 * O prazo vale até a RESPOSTA do DATASUS chegar e ser validada; a partir daí
 * quem manda no ritmo é o cliente, e cliente lento não pode ser tratado como
 * origem travada. Ver `boundedArchiveStream` para o que substitui o prazo
 * depois disso.
 */
async function handleArchive(request, environment, origin, proxySettings) {
  const timed = timeoutController(proxySettings.archiveTimeoutMs);
  try {
    // Uma faixa pedida pelo cliente é repassada como veio. O proxy não inventa
    // faixa nem a reescreve: se o DATASUS não suportar, ele responde 200 e o
    // cliente decide o que fazer com isso.
    const requestedRange = safeRangeHeader(request.headers.get('Range'));
    const upstream = await fetchWithValidatedRedirects('archive', targetForRequest(request.url), {
      method: 'GET',
      headers: {
        Accept: 'application/zip, application/octet-stream',
        ...(requestedRange ? { Range: requestedRange } : {}),
      },
    }, timed.controller.signal, proxySettings.maxRedirects);
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw upstreamHttpFailure(upstream.status);
    }
    const partial = upstream.status === 206;
    const contentType = (upstream.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (!ARCHIVE_CONTENT_TYPES.has(contentType)) {
      await upstream.body?.cancel();
      throw new ProxyFailure(502, 'invalid_archive_content_type', 'DATASUS archive response was not a ZIP file');
    }
    const declared = contentLength(upstream.headers, 502, 'invalid_upstream_length');
    if (declared !== null && declared > proxySettings.maxArchiveBytes) {
      await upstream.body?.cancel();
      throw new ProxyFailure(502, 'archive_too_large', 'DATASUS archive exceeds the proxy size limit');
    }
    if (!upstream.body) throw new ProxyFailure(502, 'empty_archive', 'DATASUS returned an empty archive response');

    const headers = baseHeaders(origin, 'private, max-age=300');
    headers.set('Content-Type', contentType);
    if (declared !== null) headers.set('Content-Length', String(declared));
    for (const name of ['Content-Disposition', 'ETag', 'Last-Modified']) {
      const value = safeUpstreamHeader(upstream.headers, name);
      if (value) headers.set(name, value);
    }
    for (const name of ['Accept-Ranges', 'Content-Range']) {
      const value = safeUpstreamHeader(upstream.headers, name);
      if (value) headers.set(name, value);
    }
    // A resposta chegou e passou pela validação: o prazo cumpriu o papel dele.
    // Deixá-lo armado daqui para a frente seria dar ao CLIENTE um limite de
    // tempo para terminar de baixar — que é exatamente o defeito consertado.
    timed.dispose();
    const stream = boundedArchiveStream(upstream.body, proxySettings.maxArchiveBytes, {
      idleMs: proxySettings.archiveIdleTimeoutMs,
      // O mesmo controlador continua servindo: desarmar o relógio não o aborta,
      // então ele ainda é o jeito de cortar uma origem que parou de responder.
      abortStalled: () => timed.controller.abort('upstream stalled'),
    });
    // 206 é repassado como 206: transformar em 200 faria o cliente montar um
    // arquivo com um pedaço só, achando que tinha o inteiro.
    return new Response(stream, { status: partial ? 206 : 200, headers });
  } catch (error) {
    timed.dispose();
    throw normalizedUnexpectedFailure(error, timed.controller.signal);
  }
}

/**
 * O corpo do /health, com a revisão que está realmente no ar.
 *
 * `version_metadata` é preenchido pela Cloudflare a cada deploy. Se o binding
 * não estiver configurado, o campo sai como null em vez de sumir — ausência
 * declarada é informação; campo que some parece que nunca existiu.
 */
function healthBody(environment) {
  const versao = environment?.CF_VERSION_METADATA;
  return {
    status: 'ok',
    service: 'tabwin-datasus-proxy',
    version: versao?.id ?? null,
    tag: versao?.tag ?? null,
    deployedAt: versao?.timestamp ?? null,
  };
}

function preflightResponse(route, request, origin) {
  const requestedMethod = request.headers.get('Access-Control-Request-Method')?.toUpperCase();
  if (requestedMethod !== route.method) {
    throw new ProxyFailure(405, 'method_not_allowed', `Expected ${route.method} for this route`, { Allow: route.method });
  }
  const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  // `range` entra na lista porque o download em partes precisa dele. A lista
  // continua fechada: qualquer outro cabeçalho é recusado no preflight, antes
  // de a requisição de verdade sair.
  if (requestedHeaders.some((name) => !['accept', 'content-type', 'range'].includes(name))) {
    throw new ProxyFailure(400, 'header_not_allowed', 'Preflight requested a header outside the proxy allowlist');
  }
  const headers = baseHeaders(origin);
  headers.set('Access-Control-Allow-Methods', route.method);
  headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type, Range');
  headers.set('Access-Control-Max-Age', '600');
  return new Response(null, { status: 204, headers });
}

export async function handleRequest(request, environment = {}) {
  let origin = null;
  try {
    const route = routeForRequest(request.url);
    origin = acceptedOrigin(request, environment);
    const suppliedOrigin = request.headers.get('Origin');

    if (route.name === 'health' && !suppliedOrigin) {
      if (request.method !== 'GET') {
        throw new ProxyFailure(405, 'method_not_allowed', 'Expected GET for this route', { Allow: 'GET' });
      }
      const headers = baseHeaders();
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(healthBody(environment)), { status: 200, headers });
    }

    const configuredOrigins = configuredAllowedOrigins(environment);
    if (configuredOrigins.length === 0) {
      throw new ProxyFailure(503, 'proxy_not_configured', 'Proxy origin allowlist is not configured');
    }
    if (!origin) throw new ProxyFailure(403, 'origin_not_allowed', 'Request origin is not allowed');
    if (request.method === 'OPTIONS') return preflightResponse(route, request, origin);
    if (request.method !== route.method) {
      throw new ProxyFailure(405, 'method_not_allowed', `Expected ${route.method} for this route`, { Allow: route.method });
    }

    if (route.name === 'health') {
      const headers = baseHeaders(origin);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(healthBody(environment)), { status: 200, headers });
    }

    const proxySettings = settings(environment);
    if (route.name === 'archive') return await handleArchive(request, environment, origin, proxySettings);
    return await handleForm(route.name, request, environment, origin, proxySettings);
  } catch (error) {
    return errorResponse(normalizedUnexpectedFailure(error), origin);
  }
}

export default {
  fetch: handleRequest,
};
