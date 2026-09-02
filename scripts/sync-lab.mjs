#!/usr/bin/env node
/**
 * Traz o Tabwin Lab para dentro do site, em `/lab/`.
 *
 * O Lab vive em outro repositório e não tem etapa de build: é HTML, CSS e
 * módulos ES servidos como estão. Publicá-lo junto do TabWin Web evita um
 * segundo domínio e um segundo deploy, ao custo de manter uma cópia versionada
 * aqui. A cópia registra o commit de origem em `lab/ORIGEM.json`, para que
 * "está velha?" seja uma pergunta com resposta em vez de um palpite.
 *
 * Uso: `node scripts/sync-lab.mjs [caminho-do-lab]` (padrão: ../tabwin-lab).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ORIGEM = process.argv[2] ?? path.resolve('..', 'tabwin-lab');
const DESTINO = path.resolve('apps/web/public/lab');

// Lista explícita em vez de "copie tudo menos": um arquivo novo no Lab que
// ninguém pensou em publicar não deve escapar para o site por omissão.
const ARQUIVOS = ['index.html'];
const PASTAS = ['src'];

if (!fs.existsSync(path.join(ORIGEM, 'index.html'))) {
  console.error(`sync-lab: não encontrei o Lab em ${ORIGEM}`);
  console.error('sync-lab: passe o caminho como argumento se ele estiver em outro lugar');
  process.exit(1);
}

function commitDeOrigem() {
  try {
    const saida = execFileSync('git', ['-C', ORIGEM, 'log', '-1', '--format=%H %cI'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split(' ');
    return { commit: saida[0], data: saida[1] };
  } catch {
    // Um Lab sem git ainda pode ser publicado; só não dá para datar a cópia.
    return { commit: null, data: null };
  }
}

function copiarPasta(de, para) {
  fs.mkdirSync(para, { recursive: true });
  for (const entrada of fs.readdirSync(de, { withFileTypes: true })) {
    const origem = path.join(de, entrada.name);
    const destino = path.join(para, entrada.name);
    if (entrada.isDirectory()) copiarPasta(origem, destino);
    else if (entrada.isFile()) fs.copyFileSync(origem, destino);
  }
}

fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(DESTINO, { recursive: true });

let total = 0;
for (const arquivo of ARQUIVOS) {
  fs.copyFileSync(path.join(ORIGEM, arquivo), path.join(DESTINO, arquivo));
  total++;
}
for (const pasta of PASTAS) {
  copiarPasta(path.join(ORIGEM, pasta), path.join(DESTINO, pasta));
  total += fs.readdirSync(path.join(DESTINO, pasta), { recursive: true })
    .filter((n) => fs.statSync(path.join(DESTINO, pasta, n)).isFile()).length;
}

const { commit, data } = commitDeOrigem();
fs.writeFileSync(
  path.join(DESTINO, 'ORIGEM.json'),
  `${JSON.stringify({ repositorio: 'tabwin-lab', commit, data, sincronizadoEm: new Date().toISOString() }, null, 2)}\n`,
);

// Caminho absoluto vira 404 sob `/lab/`, e o erro só aparece no navegador de
// quem visita. Barato conferir aqui.
const html = fs.readFileSync(path.join(DESTINO, 'index.html'), 'utf8');
const absolutos = [...html.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
if (absolutos.length) {
  throw new Error(`lab/index.html usa caminho absoluto, que quebra sob /lab/: ${absolutos.join(', ')}`);
}

console.log(`lab: ${total} arquivos de ${ORIGEM}${commit ? ` (${commit.slice(0, 7)})` : ''}`);
