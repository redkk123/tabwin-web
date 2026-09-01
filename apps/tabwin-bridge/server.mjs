#!/usr/bin/env node
/**
 * TabWin Bridge — auxiliar local e opcional de download.
 *
 * Resolve downloads do DATASUS que o navegador não consegue concluir: CORS,
 * instabilidade do FTP/HTTP oficial, timeout de proxy, arquivo muito grande,
 * conexão que cai no meio. O TabWin Web continua funcionando inteiro sem ele.
 *
 * ## O que este processo é, e o que não é
 *
 * É um executor de **uma** tarefa: baixar uma URL que já passou pela allowlist
 * do projeto, para uma pasta que ele mesmo escolhe. Não é um proxy, não abre
 * shell, não recebe comando, não escolhe executável e não aceita destino.
 *
 * Decisões de segurança, e o porquê de cada uma:
 *
 * - **escuta só em 127.0.0.1** — nunca em 0.0.0.0, senão a máquina viraria um
 *   downloader para a rede local inteira;
 * - **token efêmero** impresso no terminal ao iniciar — sem ele nenhuma página
 *   fala com o auxiliar, então um site qualquer aberto noutra aba não comanda
 *   nada;
 * - **allowlist compartilhada com o aplicativo** (`bridge-policy.ts`), aplicada
 *   aqui de novo: o frontend validar não basta, porque quem chama a API pode
 *   não ser o frontend;
 * - **`curl.exe` por array de argumentos**, nunca por linha de comando
 *   interpolada — é o que impede injeção de comando;
 * - **nome do arquivo derivado da URL**, nunca aceito do cliente;
 * - **`.part` + rename atômico**: só existe arquivo final quando o download
 *   terminou inteiro, então um download interrompido nunca se disfarça de
 *   completo.
 *
 * Uso:
 *   node apps/tabwin-bridge/server.mjs [--port 8787] [--dir <pasta>]
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  bridgeAllowedWebOrigins,
  bridgeFilenameFromUrl,
  describeBridgeAllowlist,
  describeBridgeRejection,
  validateBridgeUrl,
} from '../../dist/packages/acquisition/src/bridge-policy.js';

export const BRIDGE_PROTOCOL_VERSION = 1;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

/** curl é padrão no Windows 10+ e na maioria dos Unix; não embarcamos binário. */
function curlExecutable() {
  return process.platform === 'win32' ? 'curl.exe' : 'curl';
}

/**
 * Um download em andamento.
 *
 * O estado é observável de fora porque a interface precisa dizer o que está
 * acontecendo — "baixando" sem número é indistinguível de "travado".
 */
class DownloadJob {
  constructor({ id, url, filename, directory }) {
    this.id = id;
    this.url = url;
    this.filename = filename;
    this.partPath = path.join(directory, `${filename}.part`);
    this.finalPath = path.join(directory, filename);
    this.status = 'pending';
    this.receivedBytes = 0;
    this.totalBytes = null;
    this.bytesPerSecond = null;
    this.attempts = 0;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.error = null;
    this.child = null;
  }

  toJson() {
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      status: this.status,
      receivedBytes: this.receivedBytes,
      totalBytes: this.totalBytes,
      bytesPerSecond: this.bytesPerSecond,
      attempts: this.attempts,
      startedAt: new Date(this.startedAt).toISOString(),
      finishedAt: this.finishedAt ? new Date(this.finishedAt).toISOString() : null,
      error: this.error,
      // O caminho é informado para o usuário achar o arquivo. O cliente nunca
      // escolhe onde gravar - ele só descobre onde foi gravado.
      path: this.status === 'done' ? this.finalPath : null,
    };
  }
}

export function createBridge({
  directory,
  token,
  curlPath = curlExecutable(),
  /**
   * Argumentos que precedem os do download.
   *
   * Existe para o teste poder apontar para um curl falso sem abrir exceção na
   * allowlist - a política continua sendo a de produção; o que muda é a
   * ferramenta que ela manda executar.
   */
  curlArgsPrefix = [],
  extraWebOrigins = [],
} = {}) {
  const dir = directory ?? path.join(os.homedir(), 'Downloads', 'TabWin');
  fs.mkdirSync(dir, { recursive: true });
  const sessionToken = token ?? crypto.randomBytes(24).toString('base64url');
  const allowedOrigins = new Set(bridgeAllowedWebOrigins(extraWebOrigins));
  const jobs = new Map();

  const authorized = (request) => {
    const header = request.headers['authorization'] ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Comparação de tempo constante: um token vazado por timing seria o mesmo
    // que não ter token.
    const expected = Buffer.from(sessionToken);
    const got = Buffer.from(provided);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  };

  const applyCors = (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'origin');
      response.setHeader('access-control-allow-headers', 'authorization, content-type');
      response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      // Private Network Access: sem este cabeçalho o Chrome recusa uma página
      // pública falando com 127.0.0.1, mesmo com o CORS correto.
      if (request.headers['access-control-request-private-network'] === 'true') {
        response.setHeader('access-control-allow-private-network', 'true');
      }
      return true;
    }
    return false;
  };

  const send = (response, status, body) => {
    const payload = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(payload);
  };

  function startJob(rawUrl) {
    const verdict = validateBridgeUrl(rawUrl);
    if (!verdict.ok) {
      const error = new Error(describeBridgeRejection(verdict.reason));
      error.code = verdict.reason;
      throw error;
    }
    const filename = bridgeFilenameFromUrl(verdict.url);
    const job = new DownloadJob({
      id: crypto.randomUUID(), url: verdict.url, filename, directory: dir,
    });
    jobs.set(job.id, job);

    // Se o arquivo final já existe e está íntegro, não há o que baixar.
    if (fs.existsSync(job.finalPath)) {
      job.status = 'done';
      job.finishedAt = Date.now();
      job.receivedBytes = fs.statSync(job.finalPath).size;
      job.totalBytes = job.receivedBytes;
      return job;
    }

    // Argumentos como array: nada passa por shell, então não há interpolação
    // para injetar. `--continue-at -` retoma o `.part` de uma tentativa
    // anterior em vez de recomeçar do zero.
    const args = [
      '--fail', '--location',
      '--proto', '=https',
      '--proto-redir', '=https',
      '--retry', '10', '--retry-delay', '3', '--retry-all-errors',
      '--connect-timeout', '30',
      '--continue-at', '-',
      '--output', job.partPath,
      '--silent', '--show-error',
      '--write-out', '%{http_code} %{size_download} %{speed_download}\\n',
      verdict.url,
    ];

    job.status = 'downloading';
    job.attempts = 1;
    // `shell: false` é o que impede injeção: nada aqui passa por interpretador.
    const child = spawn(curlPath, [...curlArgsPrefix, ...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    job.child = child;

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });

    const poll = setInterval(() => {
      try {
        job.receivedBytes = fs.statSync(job.partPath).size;
      } catch { /* o arquivo ainda não existe */ }
    }, 400);

    child.on('close', (code) => {
      clearInterval(poll);
      job.child = null;
      job.finishedAt = Date.now();
      if (job.status === 'cancelled') {
        // O `.part` fica de propósito: é o que permite retomar depois.
        return;
      }
      if (code === 0) {
        try {
          // Só agora o arquivo passa a existir com o nome final. Antes disso,
          // um download interrompido não tem como se passar por completo.
          fs.renameSync(job.partPath, job.finalPath);
          const stats = fs.statSync(job.finalPath);
          job.receivedBytes = stats.size;
          job.totalBytes = stats.size;
          const [, size, speed] = stdout.trim().split(/\s+/);
          if (size) job.totalBytes = Number(size) || stats.size;
          if (speed) job.bytesPerSecond = Math.round(Number(speed)) || null;
          job.status = 'done';
        } catch (error) {
          job.status = 'failed';
          job.error = `download concluído, mas o arquivo não pôde ser renomeado: ${error.message}`;
        }
        return;
      }
      job.status = 'failed';
      job.error = stderr.trim() || `curl terminou com código ${code}`;
    });

    child.on('error', (error) => {
      clearInterval(poll);
      job.status = 'failed';
      job.finishedAt = Date.now();
      job.error = error.code === 'ENOENT'
        ? 'curl não foi encontrado neste sistema'
        : error.message;
    });

    return job;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const corsOk = applyCors(request, response);

    if (request.method === 'OPTIONS') {
      response.writeHead(corsOk ? 204 : 403).end();
      return;
    }
    // Uma origem desconhecida não recebe nem o /health: saber que o auxiliar
    // existe já é informação.
    if (request.headers.origin && !corsOk) {
      send(response, 403, { error: 'origem não autorizada' });
      return;
    }

    // /health é o único sem token: é como o aplicativo descobre que o auxiliar
    // está rodando. Ele não revela nada além da versão e da allowlist, que são
    // públicas de qualquer forma.
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, {
        service: 'tabwin-bridge',
        protocol: BRIDGE_PROTOCOL_VERSION,
        allowlist: describeBridgeAllowlist(),
        directory: dir,
      });
      return;
    }

    if (!authorized(request)) {
      send(response, 401, { error: 'token ausente ou inválido' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/downloads') {
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
        // Um corpo enorme aqui só pode ser abuso: o pedido é uma URL.
        if (body.length > 8192) request.destroy();
      });
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const job = startJob(String(parsed.url ?? ''));
          send(response, 202, job.toJson());
        } catch (error) {
          send(response, 400, { error: error.message, code: error.code ?? 'bad-request' });
        }
      });
      return;
    }

    const jobMatch = /^\/downloads\/([0-9a-f-]{36})(\/cancel)?$/.exec(url.pathname);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) { send(response, 404, { error: 'download desconhecido' }); return; }
      if (jobMatch[2] && request.method === 'POST') {
        if (job.child) {
          job.status = 'cancelled';
          job.child.kill();
        }
        send(response, 200, job.toJson());
        return;
      }
      if (request.method === 'GET') { send(response, 200, job.toJson()); return; }
    }

    send(response, 404, { error: 'rota desconhecida' });
  });

  return {
    server,
    token: sessionToken,
    directory: dir,
    listen: (port = 0) => new Promise((resolve) => {
      // 127.0.0.1 explícito: nunca 0.0.0.0.
      server.listen(port, '127.0.0.1', () => resolve(server.address()));
    }),
    close: () => new Promise((resolve) => {
      for (const job of jobs.values()) job.child?.kill();
      server.close(() => resolve());
    }),
    jobs,
  };
}

// Execução direta: sobe o servidor e imprime o token no terminal.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('server.mjs')) {
  const bridge = createBridge({
    ...(argument('--dir') ? { directory: argument('--dir') } : {}),
  });
  const port = Number(argument('--port', '8787'));
  bridge.listen(port).then((address) => {
    console.log('TabWin Bridge — auxiliar local de download');
    console.log(`  escutando em    http://127.0.0.1:${address.port} (somente esta máquina)`);
    console.log(`  salvando em     ${bridge.directory}`);
    console.log('  origens aceitas:');
    for (const line of describeBridgeAllowlist()) console.log(`    ${line}`);
    console.log('');
    console.log('  Cole este token no TabWin Web para autorizar esta sessão:');
    console.log(`    ${bridge.token}`);
    console.log('');
    console.log('  Ctrl+C encerra. Nada fica rodando depois.');
  });
}
