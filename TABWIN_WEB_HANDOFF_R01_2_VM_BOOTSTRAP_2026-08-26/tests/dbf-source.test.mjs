import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSourceDbf, extractedDbfName } from '../dist/packages/export/src/dbf-source.js';

function minimalDbf() {
  const bytes = new Uint8Array(70);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x03;
  bytes[1] = 126; bytes[2] = 8; bytes[3] = 27;
  view.setUint32(4, 1, true);
  view.setUint16(8, 65, true);
  view.setUint16(10, 4, true);
  bytes.set(new TextEncoder().encode('CODE'), 32);
  bytes[43] = 'C'.charCodeAt(0);
  bytes[48] = 3;
  bytes[64] = 0x0d;
  bytes[65] = 0x20;
  bytes.set(new TextEncoder().encode('ABC'), 66);
  bytes[69] = 0x1a;
  return bytes;
}

test('existing DBF extraction validates metadata and returns an isolated copy', () => {
  const input = minimalDbf();
  const result = extractSourceDbf(input, 'amostra.DBF');
  assert.equal(result.filename, 'amostra.dbf');
  assert.equal(result.decompressed, false);
  assert.equal(result.header.recordCount, 1);
  assert.equal(result.header.fields[0].name, 'CODE');
  assert.notEqual(result.bytes, input);
  assert.deepEqual(result.bytes, input);
});

test('DBF extraction names are local and unsupported extensions are rejected', () => {
  assert.equal(extractedDbfName('pasta\\RDAC2401.dbc'), 'RDAC2401.dbf');
  assert.equal(extractedDbfName('sem-extensao'), 'sem-extensao.dbf');
  assert.throws(() => extractSourceDbf(minimalDbf(), 'dados.csv'), /requires a \.dbc or \.dbf/);
});
