import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidDatasusArchiveError,
  TruncatedDatasusArchiveError,
  validateDatasusZipArchive,
} from '../dist/packages/acquisition/src/archive-validation.js';

/** Monta um ZIP mínimo: assinatura local, um byte de conteúdo e o fim central. */
function zipCompleto() {
  const bytes = new Uint8Array(40);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  bytes.set([0x50, 0x4b, 0x05, 0x06], 18);
  return bytes;
}

/** O mesmo pacote cortado antes do fim de diretório central. */
function zipCortado() {
  const bytes = new Uint8Array(40);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  return bytes;
}

test('um ZIP com fim de diretório central passa', () => {
  validateDatasusZipArchive(zipCompleto(), 'application/zip');
});

test('um ZIP cortado é recusado como truncado, não como inválido genérico', () => {
  assert.throws(
    () => validateDatasusZipArchive(zipCortado(), 'application/zip'),
    (erro) => {
      assert.ok(erro instanceof TruncatedDatasusArchiveError,
        'o corte precisa ter classe própria: é dele que depende a retentativa automática');
      assert.match(erro.message, /veio incompleto/);
      return true;
    },
  );
});

test('o truncado continua sendo um arquivo inválido, para quem só trata o caso geral', () => {
  // A hierarquia importa: código antigo que pega InvalidDatasusArchiveError não
  // pode deixar de ver um corte só porque ele ganhou uma subclasse.
  assert.throws(
    () => validateDatasusZipArchive(zipCortado(), 'application/zip'),
    InvalidDatasusArchiveError,
  );
});

test('HTML no lugar do ZIP não é tratado como corte', () => {
  // Distinção que decide o desfecho: repetir um pedido errado nunca acerta,
  // então este caso não pode cair na retentativa automática.
  const html = new TextEncoder().encode('<!DOCTYPE html><html><body>erro</body></html>');
  assert.throws(
    () => validateDatasusZipArchive(html, 'text/html'),
    (erro) => {
      assert.ok(erro instanceof InvalidDatasusArchiveError);
      assert.ok(!(erro instanceof TruncatedDatasusArchiveError),
        'HTML é pedido errado, não pacote cortado');
      return true;
    },
  );
});

test('um arquivo vazio não é corte: não há pacote nenhum para completar', () => {
  assert.throws(
    () => validateDatasusZipArchive(new Uint8Array(0), 'application/zip'),
    (erro) => {
      assert.ok(erro instanceof InvalidDatasusArchiveError);
      assert.ok(!(erro instanceof TruncatedDatasusArchiveError));
      return true;
    },
  );
});
