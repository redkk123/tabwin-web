#!/usr/bin/env node
/**
 * Traz o DOINF23 usado nas figuras do manual.
 *
 * O manual fala desse arquivo pelo nome e pelos números — 32.017 registros, as
 * causas básicas mais frequentes. Refazer as capturas com outro conjunto
 * deixaria texto e figura discordando, que é pior que figura velha.
 *
 * Pede ao DATASUS pelo mesmo caminho do aplicativo, inclusive esperando o
 * pacote ficar pronto: o `/prepare` responde antes de terminar de montá-lo.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PROXY = 'https://tabwin-web-datasus-proxy.tabwin-web.workers.dev';
const ORIGEM = 'https://tabweb.me';
const DESTINO = path.resolve('.cache/manual/DOINF23.dbc');

const postar = async (rota, corpo) => (await fetch(`${PROXY}/${rota}`, {
  method: 'POST',
  headers: { origin: ORIGEM, 'content-type': 'application/x-www-form-urlencoded' },
  body: corpo,
})).json();

const busca = new URLSearchParams();
for (const [chave, valor] of [
  ['tipo_arquivo[]', 'DOINF'], ['modalidade[]', '1'],
  ['fonte[]', 'SIM'], ['ano[]', '2023'], ['uf[]', 'BR'],
]) busca.append(chave, valor);

const catalogo = await postar('catalog', busca);
const arquivo = catalogo.find((item) => /^DOINF23/i.test(item.arquivo));
if (!arquivo) {
  console.error('não achei DOINF23 no catálogo:', JSON.stringify(catalogo).slice(0, 200));
  process.exit(1);
}

const preparo = new URLSearchParams();
preparo.append('dados[0][arquivo]', arquivo.arquivo);
preparo.append('dados[0][link]', arquivo.endereco);
const url = (await postar('prepare', preparo)).flat(9)
  .find((valor) => typeof valor === 'string' && valor.startsWith('http'));

// A mesma espera que o aplicativo faz: o endereço existe antes do pacote.
for (let tentativa = 1; tentativa <= 20; tentativa++) {
  const sonda = await fetch(url, { headers: { range: 'bytes=0-1' } });
  await sonda.arrayBuffer();
  if (sonda.status !== 404) break;
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 2000));
}

const resposta = await fetch(`${PROXY}/archive?url=${encodeURIComponent(url)}`, { headers: { origin: ORIGEM } });
if (!resposta.ok) {
  console.error(`\ndownload falhou: HTTP ${resposta.status}`);
  process.exit(1);
}

const zip = Buffer.from(await resposta.arrayBuffer());
const fim = zip.subarray(Math.max(0, zip.length - 22 - 0xffff));
if (!fim.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))) {
  console.error('\no pacote veio cortado; rode de novo');
  process.exit(1);
}

// O ZIP traz um arquivo só. Lê o nome e o tamanho pelo cabeçalho local, sem
// dependência: o conteúdo já vem armazenado, não comprimido de novo.
const tamanhoNome = zip.readUInt16LE(26);
const extras = zip.readUInt16LE(28);
const nome = zip.subarray(30, 30 + tamanhoNome).toString('latin1');
const inicio = 30 + tamanhoNome + extras;
const comprimido = zip.readUInt32LE(18);
const metodo = zip.readUInt16LE(8);

// O DATASUS embala o .dbc com deflate. O .dbc em si continua comprimido por
// dentro, com o algoritmo antigo da PKWARE — quem desfaz aquilo é o aplicativo.
const bruto = zip.subarray(inicio, inicio + comprimido);
const conteudo = metodo === 0 ? bruto
  : metodo === 8 ? zlib.inflateRawSync(bruto)
    : null;
if (!conteudo) {
  console.error(`\no ZIP usa compressão ${metodo}, que este script não conhece`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, conteudo);
console.log(`\n${nome} → ${DESTINO} (${(conteudo.length / 1048576).toFixed(1)} MB)`);
