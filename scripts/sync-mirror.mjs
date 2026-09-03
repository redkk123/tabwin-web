#!/usr/bin/env node
/**
 * Preenche o espelho R2 e regrava o manifesto público.
 *
 * O que ele faz, em ordem: lê a lista declarada de arquivos, baixa cada um do
 * DATASUS pelo mesmo caminho que o aplicativo usa, confere que o pacote chegou
 * inteiro, extrai o `.dbc`, calcula o SHA-256, envia ao bucket e grava a
 * entrada no manifesto.
 *
 * O manifesto sai em `apps/web/public/mirror.json` — **no repositório**, não no
 * bucket. Essa separação é o que sustenta a confiança: se o hash esperado
 * morasse junto do arquivo, quem controla o bucket controlaria os dois, e
 * verificar não provaria nada. No git, cada hash tem histórico datado.
 *
 * O envio usa `wrangler r2 object put`, que já está instalado e autenticado
 * para o Worker. Nenhuma credencial nova.
 *
 * Uso:
 *   node scripts/sync-mirror.mjs --bucket tabwin-mirror --base https://espelho.tabweb.me
 *   node scripts/sync-mirror.mjs --dry-run          (baixa e calcula, não envia)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';

const PROXY = 'https://tabwin-web-datasus-proxy.tabwin-web.workers.dev';
const ORIGEM = 'https://tabweb.me';
const MANIFESTO = 'apps/web/public/mirror.json';
const LISTA = 'docs/product/mirror-files.json';

const argumentos = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const chave = process.argv[i];
  if (!chave?.startsWith('--')) continue;
  const proximo = process.argv[i + 1];
  argumentos.set(chave.slice(2), proximo?.startsWith('--') || proximo === undefined ? 'true' : proximo);
}
const ensaio = argumentos.get('dry-run') === 'true';
const bucket = argumentos.get('bucket') ?? 'tabwin-mirror';
const base = (argumentos.get('base') ?? '').replace(/\/$/, '');

if (!ensaio && !base) {
  console.error('sync-mirror: informe --base com a URL pública do bucket, ou use --dry-run');
  process.exit(1);
}
if (!fs.existsSync(LISTA)) {
  console.error(`sync-mirror: não achei a lista em ${LISTA}`);
  console.error('sync-mirror: ela declara quais arquivos o espelho guarda.');
  process.exit(1);
}

const postar = async (rota, corpo) => (await fetch(`${PROXY}/${rota}`, {
  method: 'POST',
  headers: { origin: ORIGEM, 'content-type': 'application/x-www-form-urlencoded' },
  body: corpo,
})).json();

/**
 * Espera o pacote existir antes de baixar.
 *
 * O `/prepare` do DATASUS devolve o endereço antes de terminar de escrever o
 * zip; baixar cedo demais traz 404 ou um pacote pela metade.
 */
async function prepararEEsperar(arquivo) {
  const corpo = new URLSearchParams();
  corpo.append('dados[0][arquivo]', arquivo.name);
  corpo.append('dados[0][link]', arquivo.source);
  const url = (await postar('prepare', corpo)).flat(9)
    .find((valor) => typeof valor === 'string' && valor.startsWith('http'));
  if (!url) throw new Error('o DATASUS não devolveu URL preparada');

  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    const sonda = await fetch(url, { headers: { range: 'bytes=0-1' } });
    await sonda.arrayBuffer();
    if (sonda.status !== 404) return url;
    await new Promise((resolver) => setTimeout(resolver, 2000));
  }
  throw new Error('o pacote preparado nunca ficou pronto');
}

/** Baixa o pacote e confere que ele chegou inteiro antes de acreditar nele. */
async function baixarPacote(url) {
  const resposta = await fetch(`${PROXY}/archive?url=${encodeURIComponent(url)}`, {
    headers: { origin: ORIGEM },
  });
  if (!resposta.ok) throw new Error(`download falhou: HTTP ${resposta.status}`);
  const zip = new Uint8Array(await resposta.arrayBuffer());

  // Fim de diretório central: um zip cortado extrairia menos arquivos em
  // silêncio, e o espelho passaria a servir um dado incompleto para sempre.
  const cauda = zip.subarray(Math.max(0, zip.length - 22 - 0xffff));
  const assinatura = [0x50, 0x4b, 0x05, 0x06];
  let inteiro = false;
  for (let i = cauda.length - 4; i >= 0 && !inteiro; i -= 1) {
    inteiro = assinatura.every((byte, j) => cauda[i + j] === byte);
  }
  if (!inteiro) throw new Error('o pacote veio cortado');
  return zip;
}

const lista = JSON.parse(fs.readFileSync(LISTA, 'utf8'));
const entries = [];
const falhas = [];

console.log(`${lista.length} arquivo(s) declarados${ensaio ? ' · ensaio, nada é enviado' : ` · bucket ${bucket}`}\n`);

for (const arquivo of lista) {
  try {
    const url = await prepararEEsperar(arquivo);
    const zip = await baixarPacote(url);
    const conteudo = unzipSync(zip);
    const nomeInterno = Object.keys(conteudo)
      .find((nome) => nome.toLowerCase() === arquivo.name.toLowerCase())
      ?? Object.keys(conteudo)[0];
    const bytes = conteudo[nomeInterno];
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const destino = `${arquivo.path ?? arquivo.name}`;

    if (!ensaio) {
      const temporario = path.join('.cache', 'mirror', arquivo.name);
      fs.mkdirSync(path.dirname(temporario), { recursive: true });
      fs.writeFileSync(temporario, bytes);
      execFileSync('npx', ['wrangler', 'r2', 'object', 'put',
        `${bucket}/${destino}`, '--file', temporario, '--remote'], { stdio: 'pipe' });
      fs.rmSync(temporario, { force: true });
    }

    entries.push({
      name: arquivo.name,
      path: destino,
      sha256,
      bytes: bytes.byteLength,
      fetchedAt: new Date().toISOString(),
      source: arquivo.source,
    });
    console.log(`  ${arquivo.name.padEnd(16)} ${(bytes.byteLength / 1048576).toFixed(1)} MB · ${sha256.slice(0, 12)}`);
  } catch (erro) {
    falhas.push(`${arquivo.name}: ${erro instanceof Error ? erro.message : String(erro)}`);
    console.log(`  ${arquivo.name.padEnd(16)} FALHOU — ${erro instanceof Error ? erro.message : erro}`);
  }
}

// Uma falha não apaga o que já estava espelhado: o manifesto novo herda as
// entradas antigas que não foram refeitas nesta execução.
const anterior = fs.existsSync(MANIFESTO)
  ? JSON.parse(fs.readFileSync(MANIFESTO, 'utf8')).entries ?? []
  : [];
const porNome = new Map(anterior.map((entrada) => [entrada.name.toLowerCase(), entrada]));
for (const entrada of entries) porNome.set(entrada.name.toLowerCase(), entrada);

fs.mkdirSync(path.dirname(MANIFESTO), { recursive: true });
fs.writeFileSync(MANIFESTO, `${JSON.stringify({
  schema: 'tabwin-web.mirror',
  version: 1,
  baseUrl: base || (JSON.parse(fs.existsSync(MANIFESTO) ? fs.readFileSync(MANIFESTO, 'utf8') : '{}').baseUrl ?? ''),
  updatedAt: new Date().toISOString(),
  entries: [...porNome.values()].sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2)}\n`);

console.log(`\n${entries.length} espelhado(s) · ${porNome.size} no manifesto · ${MANIFESTO}`);
if (falhas.length) {
  console.error(`\n${falhas.length} falharam:`);
  for (const falha of falhas) console.error(`  ${falha}`);
  process.exit(1);
}
