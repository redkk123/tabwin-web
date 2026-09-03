#!/usr/bin/env node
/**
 * Extrai nomes de estado e município dos mapas incluídos.
 *
 * O filtro geográfico precisa mostrar "Belém", não `150140`. Os nomes já estão
 * nos mapas do TabWin que o projeto distribui — mas `br_municip.MAP` tem 5 MB
 * de polígonos, e carregá-lo só para ler nomes seria cobrar cinco megabytes de
 * quem quer filtrar por município sem abrir mapa nenhum.
 *
 * Este script tira só os nomes: 129 kB para os 5.570 municípios e as 27
 * unidades da federação.
 *
 * A geração acontece no build, e não à mão, para os nomes não divergirem dos
 * mapas. Se um dia um mapa for atualizado, o arquivo de nomes acompanha na
 * mesma publicação — e nunca sobra um nome que o mapa não desenha.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseTabwinMap } from '../dist/packages/formats/src/map-parser.js';

const MAPAS = 'apps/web/public/maps';
const DESTINO = 'apps/web/public/geografia.json';

/**
 * Nome por extenso das unidades da federação.
 *
 * O mapa guarda a sigla (`RO`), que serve para rotular uma área desenhada mas
 * não para escolher numa lista: "RO" e "RR" são fáceis de confundir num menu,
 * "Rondônia" e "Roraima" não.
 */
const NOME_DA_UF = {
  11: 'Rondônia', 12: 'Acre', 13: 'Amazonas', 14: 'Roraima', 15: 'Pará',
  16: 'Amapá', 17: 'Tocantins', 21: 'Maranhão', 22: 'Piauí', 23: 'Ceará',
  24: 'Rio Grande do Norte', 25: 'Paraíba', 26: 'Pernambuco', 27: 'Alagoas',
  28: 'Sergipe', 29: 'Bahia', 31: 'Minas Gerais', 32: 'Espírito Santo',
  33: 'Rio de Janeiro', 35: 'São Paulo', 41: 'Paraná', 42: 'Santa Catarina',
  43: 'Rio Grande do Sul', 50: 'Mato Grosso do Sul', 51: 'Mato Grosso',
  52: 'Goiás', 53: 'Distrito Federal',
};

function lerMapa(nome) {
  const caminho = path.join(MAPAS, nome);
  if (!fs.existsSync(caminho)) {
    console.error(`build-geografia: não achei ${caminho}`);
    process.exit(1);
  }
  return parseTabwinMap(new Uint8Array(fs.readFileSync(caminho)));
}

const ufs = lerMapa('br_ufsigla.MAP');
const municipios = lerMapa('br_municip.MAP');

const saida = {
  schema: 'tabwin-web.geografia',
  version: 1,
  ufs: {},
  municipios: {},
};

for (const objeto of ufs.objects) {
  const codigo = objeto.geocode.trim();
  const sigla = objeto.name.trim();
  if (!codigo) continue;
  saida.ufs[codigo] = { sigla, nome: NOME_DA_UF[codigo] ?? sigla };
}
for (const objeto of municipios.objects) {
  const codigo = objeto.geocode.trim();
  if (!codigo) continue;
  saida.municipios[codigo] = objeto.name.trim();
}

// Guardas altas de propósito: um arquivo de nomes cortado pela metade daria um
// filtro que simplesmente não lista metade dos municípios, e ninguém
// perceberia até procurar um que faltasse.
const contaUf = Object.keys(saida.ufs).length;
const contaMunicipio = Object.keys(saida.municipios).length;
if (contaUf !== 27) {
  console.error(`build-geografia: esperava 27 unidades da federação, achei ${contaUf}`);
  process.exit(1);
}
if (contaMunicipio < 5_500) {
  console.error(`build-geografia: só ${contaMunicipio} municípios; o mapa deve estar incompleto`);
  process.exit(1);
}
const semNomeDeUf = Object.entries(saida.ufs).filter(([, v]) => !v.nome || v.nome === v.sigla);
if (semNomeDeUf.length) {
  console.error(`build-geografia: sem nome por extenso: ${semNomeDeUf.map(([c]) => c).join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(DESTINO, `${JSON.stringify(saida)}\n`);
const kb = (fs.statSync(DESTINO).size / 1024).toFixed(0);
console.log(`geografia: ${DESTINO} (${kb} kB, ${contaUf} UF, ${contaMunicipio} municípios)`);
