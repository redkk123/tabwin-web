#!/usr/bin/env node
/**
 * Refaz as capturas do manual dirigindo o aplicativo de verdade.
 *
 * Sem isto as figuras envelhecem em silêncio: a interface muda, o manual
 * continua mostrando a versão anterior, e quem lê aprende uma tela que não
 * existe mais. Rodar este script depois de mexer na interface é mais barato do
 * que descobrir a defasagem por reclamação.
 *
 * Uso: `npm run web:build && node scripts/capture-manual.mjs [arquivo.dbc]`
 * O arquivo padrão é o DOINF23 usado no manual; qualquer DBC serve, mas as
 * legendas do manual falam desse.
 *
 * Cada passo é isolado: uma captura que falha não pode levar as outras junto,
 * porque aí o custo de uma tela quebrada vira o manual inteiro sem figuras.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const RAIZ = path.resolve('dist-web');
const DESTINO = path.resolve('docs/product/manual');
const DADOS = process.argv[2] ?? path.resolve('.cache/manual/DOINF23.dbc');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.map': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
};

if (!fs.existsSync(path.join(RAIZ, 'index.html'))) {
  console.error('capture-manual: rode `npm run web:build` antes.');
  process.exit(1);
}
if (!fs.existsSync(DADOS)) {
  console.error(`capture-manual: não achei o arquivo de dados em ${DADOS}`);
  console.error('capture-manual: passe o caminho de um .dbc como argumento.');
  process.exit(1);
}

const servidor = http.createServer((requisicao, resposta) => {
  let alvo = path.join(RAIZ, decodeURIComponent(requisicao.url.split('?')[0]));
  if (fs.existsSync(alvo) && fs.statSync(alvo).isDirectory()) alvo = path.join(alvo, 'index.html');
  if (!alvo.startsWith(RAIZ) || !fs.existsSync(alvo)) return void resposta.writeHead(404).end();
  resposta.writeHead(200, { 'content-type': TIPOS[path.extname(alvo)] ?? 'application/octet-stream' });
  fs.createReadStream(alvo).pipe(resposta);
});

await new Promise((r) => servidor.listen(4174, r));
const BASE = 'http://127.0.0.1:4174';
const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 940 } });

const feitas = [];
const falhas = [];

/** Cada captura por sua conta: uma tela quebrada não derruba as outras. */
async function capturar(nome, descricao, acao) {
  try {
    const alvo = await acao();
    const destino = path.join(DESTINO, `${nome}.png`);
    await (alvo ?? pagina).screenshot({ path: destino });
    feitas.push(nome);
    console.log(`  ${nome} — ${descricao}`);
  } catch (erro) {
    falhas.push(`${nome}: ${erro.message.split('\n')[0]}`);
    console.log(`  ${nome} FALHOU — ${erro.message.split('\n')[0]}`);
  }
}

/** Abre um `<details>` recolhido; interagir com o conteúdo exige isso. */
async function abrirSecao(seletor) {
  const secao = pagina.locator(seletor);
  if (!await secao.evaluate((e) => e.open)) await secao.locator('> summary').click();
  await pagina.waitForTimeout(180);
  return secao;
}

fs.mkdirSync(DESTINO, { recursive: true });
await pagina.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

console.log('capturando:');
await capturar('01-inicio', 'tela inicial, antes de qualquer arquivo',
  async () => pagina.locator('.workspace'));

await capturar('13-busca-datasus', 'diálogo de busca no catálogo oficial', async () => {
  await pagina.locator('#catalog-button').click();
  await pagina.waitForTimeout(400);
  return pagina.locator('dialog[open]').first();
});
await pagina.keyboard.press('Escape');

// A partir daqui existe um conjunto aberto, e a área de trabalho muda de forma.
await pagina.locator('#file-input').setInputFiles(DADOS);
await pagina.locator('#run-button').waitFor({ state: 'attached' });
await pagina.waitForFunction(() => !document.querySelector('#run-button').disabled, null, { timeout: 120_000 });

await capturar('02-arquivo-aberto', 'registros, campos e SHA-256 do arquivo',
  async () => pagina.locator('.dataset-stats'));

await capturar('03-tabela-cruzada', 'sexo cruzado com raça/cor', async () => {
  await pagina.locator('#row-field').selectOption('SEXO');
  await pagina.locator('#column-field').selectOption('RACACOR');
  await pagina.locator('#run-button').click();
  await pagina.locator('#result-table tbody tr').first().waitFor();
  return pagina.locator('.result-panel, #result-table').first();
});

await capturar('04-controles', 'painel de configuração, com o avançado recolhido',
  async () => pagina.locator('.workspace'));

await capturar('05-filtro', 'filtro por valores do campo', async () => {
  const secao = pagina.locator('.filter-builder').filter({ has: pagina.locator('#filter-field') });
    if (!await secao.evaluate((e) => e.open)) await secao.locator('> summary').click();
    await pagina.waitForTimeout(180);
  await pagina.locator('#filter-field').selectOption('SEXO');
  await pagina.waitForTimeout(250);
  return secao;
});

await capturar('06-transformar', 'etapas de transformação, dentro do avançado', async () => {
  await abrirSecao('#group-advanced');
  return abrirSecao('.transform-builder');
});

const abas = [
  ['07-grafico', 'aba de gráfico', 'chart'],
  ['08-estatistica', 'aba de estatística', 'statistics'],
  ['09-investigar', 'aba investigar', 'investigate'],
  ['12-auditoria', 'aba de auditoria', 'audit'],
];
for (const [nome, descricao, aba] of abas) {
  await capturar(nome, descricao, async () => {
    await pagina.locator(`.view-tabs button[data-view="${aba}"]`).click();
    await pagina.waitForTimeout(400);
    return pagina.locator('.results');
  });
}

await capturar('10-consulta-vazia', 'aba de consulta antes de carregar', async () => {
  await pagina.locator('.view-tabs button[data-view="query"]').click();
  await pagina.waitForTimeout(400);
  return pagina.locator('.results');
});

await navegador.close();
servidor.close();

console.log(`\n${feitas.length} capturas em ${DESTINO}`);
if (falhas.length) {
  console.error(`\n${falhas.length} falharam:`);
  for (const falha of falhas) console.error(`  ${falha}`);
  process.exit(1);
}
