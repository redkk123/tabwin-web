import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMaterializedDbfFits,
  expectedDecodedDbfBytes,
  MAX_MATERIALIZED_DBF_BYTES,
} from '../dist/packages/acquisition/src/decode-limits.js';

test('decoded DBC size guard accepts bounded materialization', () => {
  const metadata = { headerSize: 321, recordCount: 1_000, recordSize: 100 };
  assert.equal(expectedDecodedDbfBytes(metadata), 100_322);
  assert.equal(assertMaterializedDbfFits(metadata), 100_322);
});

test('decoded DBC size guard reports capacity without accusing an official file of corruption', () => {
  const metadata = { headerSize: 0, recordCount: 535_688_090, recordSize: 1 };
  assert.ok(expectedDecodedDbfBytes(metadata) > MAX_MATERIALIZED_DBF_BYTES);
  assert.throws(
    () => assertMaterializedDbfFits(metadata, 'DENGBR25.dbc'),
    (error) => error instanceof Error
      && /DENGBR25\.dbc é um arquivo oficial grande/.test(error.message)
      && /processamento em blocos/.test(error.message)
      && /não foi tratado como corrompido/.test(error.message),
  );
});
