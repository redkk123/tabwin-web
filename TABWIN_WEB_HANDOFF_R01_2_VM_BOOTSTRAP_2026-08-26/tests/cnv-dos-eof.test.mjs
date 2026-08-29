/**
 * The DOS end-of-file marker (0x1A, Ctrl-Z) that real official CNVs close with.
 *
 * Found by acquiring the official SIH auxiliary bundle: 53 of its 865 CNVs
 * were rejected by strict parsing with "legacy fixed-column row is 1 chars",
 * including core geography tables (UF.CNV, REGIAO.CNV, CAPITAL.CNV,
 * MUNICBRG.CNV). None of them is malformed — they are MS-DOS text files ending
 * with the conventional terminator, the same optional marker the DBF reader
 * already tolerates.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCnv, parseCnv } from '../dist/packages/formats/src/index.js';

const DOS_EOF = String.fromCharCode(0x1a);

function row(sequence, label, codes) {
  return `${''.padStart(3)}${String(sequence).padStart(4)}  ${label.padEnd(50).slice(0, 50)} ${codes}`;
}

const BODY = ['2 2', row(1, 'Acre', '12'), row(2, 'São Paulo', '35')].join('\r\n');

test('a CNV closing with the DOS EOF marker parses instead of being rejected as a 1-char row', () => {
  const cnv = parseCnv(`${BODY}\r\n${DOS_EOF}\r\n`);
  assert.equal(cnv.categories.length, 2);
  assert.deepEqual(classifyCnv(cnv, '12'), { sequence: 1, label: 'Acre' });
  assert.deepEqual(classifyCnv(cnv, '35'), { sequence: 2, label: 'São Paulo' });
});

test('the marker is honored with or without a trailing newline after it', () => {
  for (const suffix of [DOS_EOF, `${DOS_EOF}\r\n`, `\r\n${DOS_EOF}`, `\r\n${DOS_EOF}\r\n`]) {
    const cnv = parseCnv(`${BODY}${suffix}`);
    assert.equal(cnv.categories.length, 2, `suffix ${JSON.stringify(suffix)} should not change the result`);
  }
});

test('a file with no DOS marker is unaffected', () => {
  const cnv = parseCnv(`${BODY}\r\n`);
  assert.equal(cnv.categories.length, 2);
  assert.deepEqual(classifyCnv(cnv, '12'), { sequence: 1, label: 'Acre' });
});

test('content after the marker is terminated, not parsed — that is what end-of-file means', () => {
  // Nothing legitimate follows a DOS EOF. If anything does, it is not content.
  const cnv = parseCnv(`${BODY}\r\n${DOS_EOF}\r\n${row(3, 'Depois do fim', '99')}\r\n`);
  assert.equal(cnv.categories.length, 2);
  assert.equal(classifyCnv(cnv, '99'), undefined);
});

test('the marker does not mask a genuinely malformed row before it', () => {
  assert.throws(() => parseCnv(`2 2\r\nlinha curta\r\n${DOS_EOF}`), /expected at least 61/);
});
