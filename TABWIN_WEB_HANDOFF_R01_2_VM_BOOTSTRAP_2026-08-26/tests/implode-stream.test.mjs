import test from 'node:test';
import assert from 'node:assert/strict';
import { implodeDecompress } from '@precisa-saude/datasus-dbc';
import { implodeDecompressChunks } from '../dist/packages/acquisition/src/implode-stream.js';

test('chunked DCL decoder matches the reference decoder on the blast.c vector', () => {
  const compressed = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]);
  const expected = implodeDecompress(compressed, 13);
  const chunks = [];
  const produced = implodeDecompressChunks(compressed, expected.length, (chunk, offset) => {
    assert.equal(offset, chunks.reduce((total, item) => total + item.length, 0));
    assert.ok(chunk.length <= 4096);
    chunks.push(chunk);
  });
  assert.equal(produced, expected.length);
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(expected));
  assert.equal(new TextDecoder().decode(Buffer.concat(chunks)), 'AIAIAIAIAIAIA');
});

test('chunked DCL decoder rejects declared-size mismatch and output bombs', () => {
  const compressed = Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]);
  assert.throws(() => implodeDecompressChunks(compressed, 14, () => {}), /produziu 13 bytes/);
  assert.equal(implodeDecompressChunks(compressed, 14, () => {}, { allowMissingFinalByte: true }), 13);
  assert.throws(() => implodeDecompressChunks(compressed, 13, () => {}, { maxOutputBytes: 12 }), /acima do limite/);
});
