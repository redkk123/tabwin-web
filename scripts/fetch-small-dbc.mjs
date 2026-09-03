#!/usr/bin/env node
/**
 * Traz um DBC pequeno para medir entradas pequenas.
 *
 * O conjunto de fixtures do pacote tem um arquivo só, de 4.315 registros. Um
 * DBC de poucas centenas paga proporcionalmente muito mais pela montagem das
 * tabelas Huffman, e é justamente onde uma otimização voltada para arquivos
 * grandes pode ter regredido.
 *
 * O arquivo NÃO entra no repositório: fica em `.cache/`, e o que se registra é
 * o hash e os números. É a regra que o próprio plano do decompressor declara.
 *
 * Uso: node scripts/fetch-small-dbc.mjs [DNAC2023]
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';

const PROXY = 'https://tabwin-web-datasus-proxy.tabwin-web.workers.dev';
const ORIGEM = 'https://tabweb.me';

const alvo = process.argv[2] ?? 'DNAC2023';
const uf = alvo.slice(2, 4);
const ano = alvo.slice(4);
const nome = `${alvo}.dbc`;
const source = `ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/1996_/Dados/DNRES/${nome}`;

const postar = async (rota, corpo) => (await fetch(`${PROXY}/${rota}`, {
  method: 'POST',
  headers: { origin: ORIGEM, 'content-type': 'application/x-www-form-urlencoded' },
  body: corpo,
})).json();

const preparo = new URLSearchParams();
preparo.append('dados[0][arquivo]', nome);
preparo.append('dados[0][link]', source);

const inicio = Date.now();
const url = (await postar('prepare', preparo)).flat(9)
  .find((valor) => typeof valor === 'string' && valor.startsWith('http'));
if (!url) {
  console.error(`não consegui preparar ${nome} (UF ${uf}, ano ${ano})`);
  process.exit(1);
}

for (let i = 0; i < 30; i += 1) {
  const sonda = await fetch(url, { headers: { range: 'bytes=0-1' } });
  await sonda.arrayBuffer();
  if (sonda.status !== 404) break;
  await new Promise((r) => setTimeout(r, 2000));
}

const resposta = await fetch(`${PROXY}/archive?url=${encodeURIComponent(url)}`, {
  headers: { origin: ORIGEM },
});
if (!resposta.ok) {
  console.error(`download falhou: HTTP ${resposta.status}`);
  process.exit(1);
}

const zip = new Uint8Array(await resposta.arrayBuffer());
const conteudo = unzipSync(zip);
const interno = Object.keys(conteudo).find((n) => n.toLowerCase() === nome.toLowerCase())
  ?? Object.keys(conteudo)[0];
const bytes = conteudo[interno];

const destino = path.resolve('.cache', 'manual', nome);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, bytes);

const sha256 = createHash('sha256').update(bytes).digest('hex');
console.log(`${interno} -> ${destino}`);
console.log(`  ${(bytes.byteLength / 1024).toFixed(0)} KB · sha256 ${sha256}`);
console.log(`  origem: ${source}`);
console.log(`  obtido em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
