const DATASUS_ORIGIN = 'https://datasus.saude.gov.br';

export function targetForRequest(requestUrl) {
  const url = new URL(requestUrl);
  if (url.pathname === '/catalog') return `${DATASUS_ORIGIN}/wp-content/ftp.php`;
  if (url.pathname === '/prepare') return `${DATASUS_ORIGIN}/wp-content/download.php`;
  if (url.pathname === '/archive') {
    const target = new URL(url.searchParams.get('url') ?? '');
    if (target.protocol !== 'https:' || target.hostname !== 'datasus.saude.gov.br'
      || !target.pathname.startsWith('/wp-content/zipupload/') || !target.pathname.endsWith('/arquivo.zip')) {
      throw new Error('archive target is not an official prepared DATASUS URL');
    }
    return target.href;
  }
  throw new Error('unknown proxy route');
}

function corsHeaders(origin, allowedOrigin) {
  const accepted = origin === allowedOrigin ? origin : allowedOrigin;
  return {
    'Access-Control-Allow-Origin': accepted,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, environment) {
    const origin = request.headers.get('Origin') ?? '';
    const allowedOrigin = environment.ALLOWED_ORIGIN;
    if (!allowedOrigin || origin !== allowedOrigin) return new Response('origin not allowed', { status: 403 });
    const headers = corsHeaders(origin, allowedOrigin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let target;
    try {
      target = targetForRequest(request.url);
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 400, headers });
    }
    const archive = new URL(request.url).pathname === '/archive';
    const upstream = await fetch(target, archive ? { method: 'GET' } : {
      method: 'POST',
      body: await request.arrayBuffer(),
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? 'application/x-www-form-urlencoded' },
    });
    const responseHeaders = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(headers)) responseHeaders.set(key, value);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};
