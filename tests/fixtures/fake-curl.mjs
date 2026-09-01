#!/usr/bin/env node
/**
 * Um `curl` falso, para exercitar o ciclo de vida do download sem rede e sem
 * afrouxar a allowlist do Bridge.
 *
 * A alternativa seria abrir uma brecha na política só para o teste, o que
 * anularia justamente a garantia que os outros testes provam. Aqui a política
 * continua intacta: o que se troca é a ferramenta que ela manda executar.
 *
 * Comportamento controlado por variável de ambiente:
 *   FAKE_CURL_MODE=ok      grava o conteúdo e sai com 0
 *   FAKE_CURL_MODE=fail    escreve em stderr e sai com 22 (como --fail faz)
 *   FAKE_CURL_MODE=hang    fica vivo até ser morto (caso de cancelamento)
 *   FAKE_CURL_BYTES        conteúdo a gravar (padrão: "conteudo")
 */
import fs from 'node:fs';
import process from 'node:process';

const args = process.argv.slice(2);
const output = args[args.indexOf('--output') + 1];
const mode = process.env.FAKE_CURL_MODE ?? 'ok';
const body = process.env.FAKE_CURL_BYTES ?? 'conteudo';

if (mode === 'fail') {
  process.stderr.write('curl: (22) The requested URL returned error: 500\n');
  process.exit(22);
}

if (mode === 'hang') {
  // Grava um pedaço para haver `.part` observável, e depois espera.
  if (output) fs.writeFileSync(output, body.slice(0, 3));
  setInterval(() => {}, 1000);
} else {
  if (!output) { process.stderr.write('sem --output\n'); process.exit(2); }
  fs.writeFileSync(output, body);
  // Mesmo formato do --write-out que o servidor pede.
  process.stdout.write(`200 ${Buffer.byteLength(body)} 1048576\n`);
  process.exit(0);
}
