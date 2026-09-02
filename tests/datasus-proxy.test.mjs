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
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'tabwin-datasus-proxy',
    // O corpo ganhou a revisão no ar; sem binding os campos saem nulos.
    version: null,
    tag: null,
    deployedAt: null,
  });
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

test('com tamanho declarado, o corpo não passa pelo JavaScript do Worker', async () => {
  // Esta é a regra que impede o corte. Contar byte a byte custa um callback por
  // pedaço; num arquivo de dezenas de MB o Worker estoura o limite de CPU no
  // meio do stream e o cliente recebe um corpo cortado, sem erro. Medido em
  // 02/09: pela mesma URL preparada, direto do DATASUS 3/3 inteiros, pelo
  // proxy 1/3, em quatro faixas 0/3, com `outcome: exceededCpu` no log.
  //
  // O teste verifica a identidade do stream: se o corpo repassado for o mesmo
  // objeto que veio de cima, nenhum pedaço passou por JavaScript.
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  let corpoDeCima = null;
  await withMockFetch(async () => {
    corpoDeCima = new Response(zip).body;
    return new Response(corpoDeCima, {
      status: 200,
      headers: { 'Content-Type': 'application/zip', 'Content-Length': String(zip.byteLength) },
    });
  }, async () => {
    const response = await handleRequest(
      request('/archive?url=' + encodeURIComponent('https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip')),
      ENVIRONMENT,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body, corpoDeCima,
      'o corpo precisa ser repassado como veio; embrulhá-lo custa CPU por pedaço');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), zip);
  });
});

test('sem tamanho declarado, o limite volta a ser contado pedaço a pedaço', async () => {
  // O caminho raro: sem Content-Length não há como conferir o tamanho antes, e
  // então a contagem é o único jeito de ter limite. O custo de CPU é o preço.
  const grande = new Uint8Array(4096);
  grande.set([0x50, 0x4b, 0x03, 0x04], 0);
  await withMockFetch(async () => new Response(grande, {
    status: 200,
    headers: { 'Content-Type': 'application/zip' },
  }), async () => {
    const response = await handleRequest(
      request('/archive?url=' + encodeURIComponent('https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip')),
      { ...ENVIRONMENT, MAX_ARCHIVE_BYTES: String(1024 * 1024) },
    );
    assert.equal(response.status, 200);
    const recebido = new Uint8Array(await response.arrayBuffer());
    assert.equal(recebido.byteLength, grande.byteLength);
  });
});

test('a rota do TabNet repassa a tabulação agregada', async () => {
  const html = '<TABLE CLASS="tabdados"><TR><TH>Sexo<TH>Total<TR><TD>Masc<TD>10</TABLE>';
  let alvo = null;
  await withMockFetch(async (input) => {
    // O mock recebe string, URL ou Request conforme o caminho; Request tem
    // `.url`, URL tem `.href`, e `String()` cobre os dois primeiros.
    alvo = input?.url ?? String(input);
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }, async () => {
    const response = await handleRequest(request('/tabnet?def=sinasc/cnv/nvuf.def', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'Linha=Sexo',
    }), ENVIRONMENT);
    assert.equal(response.status, 200);
    assert.equal(alvo, 'https://tabnet.datasus.gov.br/cgi/tabcgi.exe?sinasc/cnv/nvuf.def');
    assert.match(await response.text(), /tabdados/);
  });
});

test('a rota do TabNet recusa qualquer caminho fora da forma de um .def', async () => {
  // Sem esta trava, a rota viraria um encaminhador aberto para todo o host do
  // TabNet — e o proxy existe justamente para NÃO ser isso.
  for (const def of [
    '../../etc/passwd',
    'sinasc/cnv/nvuf.def/../../x',
    'https://exemplo.com/x.def',
    'sinasc/nvuf.def',
    'sinasc/cnv/nvuf.exe',
    '',
  ]) {
    const response = await handleRequest(request(`/tabnet?def=${encodeURIComponent(def)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'Linha=Sexo',
    }), ENVIRONMENT);
    assert.equal(response.status, 400, `aceitou "${def}"`);
    assert.equal(await errorCode(response), 'invalid_tabnet_def');
  }
});

test('um 404 do DATASUS chega como 404, e não escondido dentro de um 502', async () => {
  // O DATASUS devolve o endereço do pacote preparado antes de terminar de
  // escrevê-lo, e nesse intervalo o arquivo responde 404. O cliente usa esse
  // status para esperar; achatado em 502, ele lê "falha do servidor" e tenta
  // de novo à toa, sem nunca dar tempo de o pacote ficar pronto.
  await withMockFetch(async () => new Response('nao encontrado', { status: 404 }), async () => {
    const response = await handleRequest(
      request('/archive?url=' + encodeURIComponent('https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip')),
      ENVIRONMENT,
    );
    assert.equal(response.status, 404);
    assert.equal(await errorCode(response), 'upstream_not_found');
  });
});

test('erros do DATASUS que não são 404 continuam virando 502', async () => {
  // A distinção só vale se for estreita: 500, 403 e afins são problema de
  // verdade lá em cima, e o cliente não deve ficar esperando por eles.
  for (const status of [403, 500, 503]) {
    await withMockFetch(async () => new Response('erro', { status }), async () => {
      const response = await handleRequest(
        request('/archive?url=' + encodeURIComponent('https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip')),
        ENVIRONMENT,
      );
      assert.equal(response.status, 502, `status ${status} devia virar 502`);
      assert.equal(await errorCode(response), 'upstream_http_error');
    });
  }
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

/**
 * Origem que entrega um pedaço e depois espera, sob controle do teste.
 *
 * Serve para colocar o proxy no estado que o defeito exigia: resposta já
 * recebida, cliente ainda baixando.
 */
function origemQueSegura(primeiroPedaco, resto) {
  let liberar;
  const espera = new Promise((resolve) => { liberar = resolve; });
  const corpo = new ReadableStream({
    async pull(controller) {
      if (!this.entregouPrimeiro) {
        this.entregouPrimeiro = true;
        controller.enqueue(primeiroPedaco);
        return;
      }
      if (!this.entregouResto) {
        this.entregouResto = true;
        await espera;
        controller.enqueue(resto);
        return;
      }
      controller.close();
    },
  });
  return { corpo, liberar: () => liberar() };
}

async function deixarFluir() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

test('o prazo do proxy não limita quanto o cliente demora para baixar', async (t) => {
  // O defeito que isto tranca: o prazo era armado antes do `fetch` e desarmado
  // só no fim do fluxo, e como o sinal aborta a resposta de origem, ele dava ao
  // CLIENTE um limite de tempo. A 0,6 MB/s o teto era ~108 MB; o que passava
  // disso chegava truncado e o navegador dizia "invalid zip data", sem nenhuma
  // pista de que a causa era um relógio nosso.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const inicio = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const fim = new Uint8Array([0x01, 0x02, 0x03]);
  const origem = origemQueSegura(inicio, fim);
  let sinal = null;

  await withMockFetch(async (_input, init) => {
    sinal = init.signal;
    return new Response(origem.corpo, { headers: { 'Content-Type': 'application/zip' } });
  }, async () => {
    const response = await handleRequest(
      request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, { method: 'GET' }),
      { ...ENVIRONMENT, ARCHIVE_TIMEOUT_MS: '10000' },
    );
    assert.equal(response.status, 200);
    const leitor = response.body.getReader();
    const recebido = [...(await leitor.read()).value];
    // Deixa o fluxo pedir o próximo pedaço: é só com uma leitura pendente que
    // o relógio de ociosidade chega a ser armado. Sem isto o teste passaria
    // por não haver relógio nenhum correndo, que não é o que se quer provar.
    await deixarFluir();

    // Passa muito do prazo de resposta, sem chegar perto do de ociosidade.
    t.mock.timers.tick(30_000);
    await deixarFluir();
    assert.equal(sinal.aborted, false, 'lentidão do cliente não pode abortar a origem');

    origem.liberar();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      recebido.push(...value);
    }
    assert.deepEqual(Uint8Array.from(recebido), Uint8Array.from([...inicio, ...fim]),
      'o cliente lento precisa receber o arquivo INTEIRO, não um pedaço');
  });
});

test('origem que para de responder ainda é cortada, por ociosidade', async (t) => {
  // O prazo antigo também servia para isto, e trocá-lo por nada deixaria o
  // proxy segurando uma conexão morta. A diferença é o que o relógio mede:
  // agora ele só corre com uma leitura pendente ao DATASUS.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const origem = origemQueSegura(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), new Uint8Array([0x09]));
  let sinal = null;

  await withMockFetch(async (_input, init) => {
    sinal = init.signal;
    return new Response(origem.corpo, { headers: { 'Content-Type': 'application/zip' } });
  }, async () => {
    const response = await handleRequest(
      request(`/archive?url=${encodeURIComponent(ARCHIVE_URL)}`, { method: 'GET' }),
      { ...ENVIRONMENT, ARCHIVE_TIMEOUT_MS: '10000', ARCHIVE_IDLE_TIMEOUT_MS: '20000' },
    );
    const leitor = response.body.getReader();
    await leitor.read();
    // A leitura seguinte fica pendente na origem: aqui o relógio corre.
    await deixarFluir();
    t.mock.timers.tick(25_000);
    await deixarFluir();
    assert.equal(sinal.aborted, true, 'origem travada precisa ser cortada');
    origem.liberar();
  });
});

test('/health diz qual revisão está no ar, porque "ok" sozinho não serve', async () => {
  // Esta necessidade custou horas: produção rodava uma revisão antiga do
  // Worker e a única forma de descobrir era medir comportamento. Um endpoint
  // de saúde que responde "ok" sem dizer o que é "ok" não serve para o que ele
  // existe.
  const comVersao = {
    ...ENVIRONMENT,
    CF_VERSION_METADATA: { id: '0accdd6f-4c6e-4921-a452-5d28fb52166e', tag: 'v7', timestamp: '2026-09-02T15:00:00Z' },
  };
  const resposta = await handleRequest(request('/health', { method: 'GET', origin: null }), comVersao);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), {
    status: 'ok',
    service: 'tabwin-datasus-proxy',
    version: '0accdd6f-4c6e-4921-a452-5d28fb52166e',
    tag: 'v7',
    deployedAt: '2026-09-02T15:00:00Z',
  });
});

test('sem o binding a versão sai como nula, e não some do corpo', async () => {
  // Ausência declarada é informação; campo que some parece que nunca existiu,
  // e quem consulta não sabe se o Worker é antigo ou se o campo é novo.
  const resposta = await handleRequest(request('/health', { method: 'GET', origin: null }), ENVIRONMENT);
  const corpo = await resposta.json();
  assert.equal(corpo.status, 'ok');
  assert.equal(corpo.version, null);
  assert.ok('version' in corpo && 'deployedAt' in corpo);
});
