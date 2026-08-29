import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWindows1252 } from '../dist/packages/formats/src/index.js';

test('every one of the 256 possible input bytes round-trips through decode then encode', () => {
  const decoder = new TextDecoder('windows-1252');
  for (let byte = 0; byte < 256; byte++) {
    const original = new Uint8Array([byte]);
    const text = decoder.decode(original);
    const encoded = encodeWindows1252(text);
    assert.deepEqual([...encoded], [...original], `byte 0x${byte.toString(16).padStart(2, '0')} did not round-trip`);
  }
});

test('the accented Portuguese characters real CNV labels use encode correctly', () => {
  const text = 'Média complexidade não se aplica – São Paulo';
  const decoded = new TextDecoder('windows-1252').decode(encodeWindows1252(text));
  assert.equal(decoded, text);
});

test('smart-quote and em-dash characters in the 0x80-0x9F cp1252 range round-trip', () => {
  const text = '“curly quotes” — em dash • bullet € euro';
  const decoded = new TextDecoder('windows-1252').decode(encodeWindows1252(text));
  assert.equal(decoded, text);
});

test('a character with no Windows-1252 representation is rejected, not substituted', () => {
  assert.throws(() => encodeWindows1252('日本語'), /no Windows-1252 representation/);
});

test('an empty string encodes to an empty byte array', () => {
  assert.deepEqual([...encodeWindows1252('')], []);
});
