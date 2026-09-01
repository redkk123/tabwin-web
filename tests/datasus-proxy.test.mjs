import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configuredAllowedOrigins,
  handleRequest,
  targetForRequest,
  validateArchiveTarget,
} from '../apps/datasus-proxy/worker.mjs';

const APP_ORIGIN = 'https://redkk123.github.io';
const ENVIRONMENT = Object.freeze({ ALLOWED_ORIGINS: APP_ORIGIN });
const ARCHIVE_URL = 'https://datasus.saude.gov.br/wp-content/zipupload/Arq_123/arquivo.zip';

function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.origin !== null) headers.set('Origin', options.origin ?? APP_ORIGIN);
  return new Request(`https://proxy.example${path}`, {
    ...options,
    headers,
  });
}

async function errorCode(response) {
  return (await response.json()).error.code;
}

async function withMockFetch(mock, operation) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await operation();
  } finally {
    globalThis.fetch = original;
  }
}

test('DATASUS proxy exposes only fixed official catalog routes', () => {
  assert.equal(targetForRequest('https://proxy.example/catalog'), 'https://datasus.saude.gov.br/wp-content/ftp.php');
  assert.equal(targetForRequest('https://proxy.example/prepare'), 'https://datasus.saude.gov.br/wp-content/download.php');
  assert.throws(() => targetForRequest('https://proxy.example/catalog?target=other'), /does not accept query parameters/);
  assert.throws(() => targetForRequest('https://proxy.example/other'), /route not found/i);
});

test('DATASUS proxy archive route accepts one exact official prepared URL', () => {
  assert.equal(targetForRequest(`https://proxy.example/archive?url=${encodeURIComponent(ARCHIVE_URL)}`), ARCHIVE_URL);
  assert.equal(validateArchiveTarget(ARCHIVE_URL).href, ARCHIVE_URL);
  for (const invalid of [
    'https://example.com/arquivo.zip',
    'http://datasus.saude.gov.br/wp-content/zipupload/Arq_123/arquivo.zip',
    'https://datasus.saude.gov.br:444/wp-content/zipupload/Arq_123/arquivo.zip',
    'https://user@datasus.saude.gov.br/wp-content/zipupload/Arq_123/arquivo.zip',
    'https://datasus.saude.gov.br/wp-content/zipupload/Arq_123/nested/arquivo.zip',
    'https://datasus.saude.gov.br/wp-content/zipupload/Arq_123/arquivo.zip?other=1',
  ]) assert.throws(() => validateArchiveTarget(invalid), /not an official prepared DATASUS URL/i);
  assert.throws(
    () => targetForRequest(`https://proxy.example/archive?url=${encodeURIComponent(ARCHIVE_URL)}&extra=1`),
    /exactly one url parameter/,
  );
});

test('origin configuration is canonical, exact and deduplicated', () => {
  assert.deepEqual(configuredAllowedOrigins({
    ALLOWED_ORIGINS: `${APP_ORIGIN}, http://127.0.0.1:5173,${APP_ORIGIN},https://example.com/path`,
  }), [APP_ORIGIN, 'http://127.0.0.1:5173']);
  assert.deepEqual(configuredAllowedOrigins({ ALLOWED_ORIGIN: APP_ORIGIN }), [APP_ORIGIN]);
  assert.deepEqual(configuredAllowedOrigins({ ALLOWED_ORIGINS: '*' }), []);
});

test('health is available without an Origin while proxy routes require configuration and allowlisting', async () => {
  const health = await handleRequest(request('/health', { method: 'GET', origin: null }), {});
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'tabwin-datasus-proxy' });
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), null);

  const unconfigured = await handleRequest(request('/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  }), {});
  assert.equal(unconfigured.status, 503);
  assert.equal(await errorCode(unconfigured), 'proxy_not_configured');

  const rejected = await handleRequest(request('/catalog', {
    method: 'POST',
    origin: 'https://attacker.example',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'x=1',
  }), ENVIRONMENT);
  assert.equal(rejected.status, 403);
  assert.equal(await errorCode(rejected), 'origin_not_allowed');
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
});

test('route methods and CORS preflight are constrained per endpoint', async () => {
  const wrongMethod = await handleRequest(request('/archive', { method: 'POST' }), ENVIRONMENT);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'GET');

  const preflight = await handleRequest(request('/catalog', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, Accept',
    },
  }), ENVIRONMENT);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), APP_ORIGIN);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST');
  assert.equal(preflight.headers.get('Vary'), 'Origin');

  const rejectedHeader = await handleRequest(request('/catalog', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization',
    },
  }), ENVIRONMENT);
  assert.equal(rejectedHeader.status, 400);
  assert.equal(await errorCode(rejectedHeader), 'header_not_allowed');
});

test('form routes enforce media type and request length before calling DATASUS', async () => {
  const unsupported = await handleRequest(request('/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }), ENVIRONMENT);
  assert.equal(unsupported.status, 415);
  assert.equal(await errorCode(unsupported), 'unsupported_media_type');

  const oversized = await handleRequest(request('/catalog', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': '65537',
    },
    body: 'x=1',
  }), ENVIRONMENT);
  assert.equal(oversized.status, 413);
  assert.equal(await errorCode(oversized), 'request_too_large');
});

test('successful form responses expose only deliberate upstream headers', async () => {
  await withMockFetch(async (input, init) => {
    assert.equal(String(input), 'https://datasus.saude.gov.br/wp-content/ftp.php');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(new TextDecoder().decode(init.body), 'x=1');
    return new Response('["ok"]', {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'private=1',
        'X-Upstream-Internal': 'secret',
      },
    });
  }, async () => {
    const response = await handleRequest(request('/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: 'x=1',
    }), ENVIRONMENT);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '["ok"]');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), APP_ORIGIN);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('X-Upstream-Internal'), null);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
});

test('POST redirects that change semantics and off-allowlist redirects are rejected', async () => {
  await withMockFetch(async () => new Response(null, {
    status: 302,
    headers: { Location: 'https://example.com/steal' },
  }), async () => {
    const response = await handleRequest(request('/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'x=1',
    }), ENVIRONMENT);
    assert.equal(response.status, 502);
    assert.equal(await errorCode(response), 'upstream_redirect_rejected');
  });
});

test('upstream failures use normalized JSON instead of leaking response bodies', async () => {
  await withMockFetch(async () => new Response('sensitive upstream detail', { status: 500 }), async () => {
    const response = await handleRequest(request('/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'x=1',
    }), ENVIRONMENT);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: { code: 'upstream_http_error', message: 'DATASUS returned HTTP 500' },
    });
  });
});

test('archive responses are content-checked, bounded and streamed with safe headers', async () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  await withMockFetch(async (input, init) => {
    assert.equal(String(input), ARCHIVE_URL);
    assert.equal(init.method, 'GET');
    return new Response(zip, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(zip.byteLength),
        'Content-Disposition': 'attachment; filename="arquivo.zip"',
        'Set-Cookie': 'private=1',
      },
    });
  }, async () => {
    const response = await handleRequest(request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, {
      method: 'GET',
    }), ENVIRONMENT);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), zip);
    assert.equal(response.headers.get('Content-Type'), 'application/zip');
    assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="arquivo.zip"');
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('Cache-Control'), 'private, max-age=300');
  });
});

test('archive route rejects non-ZIP and oversized upstream envelopes', async () => {
  await withMockFetch(async () => new Response('<html>error</html>', {
    headers: { 'Content-Type': 'text/html' },
  }), async () => {
    const response = await handleRequest(request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, {
      method: 'GET',
    }), ENVIRONMENT);
    assert.equal(response.status, 502);
    assert.equal(await errorCode(response), 'invalid_archive_content_type');
  });

  await withMockFetch(async () => new Response(new Uint8Array([0x50]), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(1024 * 1024 + 1),
    },
  }), async () => {
    const response = await handleRequest(request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, {
      method: 'GET',
    }), { ...ENVIRONMENT, MAX_ARCHIVE_BYTES: String(1024 * 1024) });
    assert.equal(response.status, 502);
    assert.equal(await errorCode(response), 'archive_too_large');
  });
});

test('o proxy repassa uma faixa de bytes e devolve 206 como 206', async () => {
  // Sem isto o download em partes não existe: o cliente pediria uma faixa, o
  // proxy mandaria o arquivo inteiro, e cada "parte" seria o arquivo todo.
  const parte = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  let rangeRecebido = null;
  await withMockFetch(async (input, init) => {
    rangeRecebido = init.headers?.Range ?? null;
    return new Response(parte, {
      status: 206,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(parte.byteLength),
        'Content-Range': 'bytes 0-3/1024',
        'Accept-Ranges': 'bytes',
      },
    });
  }, async () => {
    const response = await handleRequest(request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, {
      method: 'GET',
      headers: { Range: 'bytes=0-3' },
    }), ENVIRONMENT);

    assert.equal(rangeRecebido, 'bytes=0-3', 'a faixa precisa chegar ao DATASUS');
    // Transformar 206 em 200 faria o cliente montar um arquivo com um pedaço
    // só, achando que tinha o inteiro.
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/1024');
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
    // E o navegador precisa poder LER esses cabeçalhos.
    const exposed = response.headers.get('Access-Control-Expose-Headers') ?? '';
    assert.match(exposed, /Content-Range/);
    assert.match(exposed, /Accept-Ranges/);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), parte);
  });
});

test('faixa malformada não é repassada — vira download inteiro', async () => {
  // Faixa aberta, múltipla ou por sufixo têm resposta diferente (multipart,
  // por exemplo). Repassar sem entender daria ao cliente um corpo que ele
  // montaria errado.
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  for (const hostil of ['bytes=0-', 'bytes=-500', 'bytes=0-1,5-9', 'bytes=abc', 'items=0-1', 'bytes=9-1']) {
    let rangeRecebido = 'não chamado';
    await withMockFetch(async (_input, init) => {
      rangeRecebido = init.headers?.Range ?? null;
      return new Response(zip, {
        headers: { 'Content-Type': 'application/zip', 'Content-Length': String(zip.byteLength) },
      });
    }, async () => {
      const response = await handleRequest(request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, {
        method: 'GET',
        headers: { Range: hostil },
      }), ENVIRONMENT);
      assert.equal(rangeRecebido, null, `${hostil} não podia ser repassada`);
      assert.equal(response.status, 200);
    });
  }
});

test('o preflight passa a aceitar Range, senão o navegador barraria antes de tentar', async () => {
  const response = await handleRequest(request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'range',
    },
  }), ENVIRONMENT);
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Access-Control-Allow-Headers') ?? '', /Range/i);
});
