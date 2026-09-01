#!/usr/bin/env node
/**
 * Confere que o caminho rápido e o caminho lento do descompressor DCL
 * produzem exatamente os mesmos bytes, sobre DBC reais.
 *
 * Por que é um script e não um teste: exige arquivos `.dbc` reais, que não
 * entram neste repositório. É o mesmo motivo — e o mesmo padrão — dos outros
 * `verify:*` que dependem de ativo privado.
 *
 * Por que existe: a tabela rápida resolve quase todo símbolo, então o caminho
 * lento quase nunca roda. Ele já saiu de alinhamento uma vez exatamente por
 * isso: ficou sem exercício e ninguém percebeu até um arquivo real bater nele.
 *
 *   node scripts/verify-implode-paths.mjs <pasta-com-dbc>
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readDbcMetadata, readDbfHeader } from '@precisa-saude/datasus-dbc';
import { implodeDecompressChunks } from '../dist/packages/acquisition/src/implode-stream.js';

const root = process.argv[2];
if (!root) throw new Error('usage: node scripts/verify-implode-paths.mjs <pasta-com-dbc>');

function collect(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...collect(target));
    else if (/\.dbc$/i.test(entry.name)) found.push(target);
  }
  return found;
}

function digest(dbc, forceSlowPath) {
  const metadata = readDbcMetadata(dbc);
  const header = readDbfHeader(dbc.subarray(0, metadata.headerSize));
  const hash = createHash('sha256');
  let bytes = 0;
  implodeDecompressChunks(
    dbc.subarray(metadata.headerSize + 4),
    header.recordCount * header.recordLength + 1,
    (chunk) => { bytes += chunk.byteLength; hash.update(chunk); },
    { allowMissingFinalByte: true, forceSlowPath },
  );
  return { bytes, sha256: hash.digest('hex') };
}

const files = collect(root);
if (!files.length) throw new Error(`nenhum .dbc encontrado em ${root}`);

let divergentes = 0;
for (const file of files) {
  const dbc = new Uint8Array(fs.readFileSync(file));
  const rapido = digest(dbc, false);
  const lento = digest(dbc, true);
  const igual = rapido.sha256 === lento.sha256 && rapido.bytes === lento.bytes;
  if (!igual) divergentes++;
  console.log(
    `${igual ? 'IGUAL   ' : 'DIVERGIU'}  ${path.basename(file).padEnd(18)}`
    + ` ${(rapido.bytes / 1048576).toFixed(1).padStart(7)} MB  ${rapido.sha256.slice(0, 16)}`,
  );
}

console.log(`\n${files.length} arquivo(s); ${divergentes} divergência(s).`);
if (divergentes) process.exitCode = 1;
