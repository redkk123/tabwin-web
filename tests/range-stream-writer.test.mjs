import assert from 'node:assert/strict';
import test from 'node:test';

import { createRangeStreamWriter } from '../dist/packages/acquisition/src/range-stream-writer.js';

test('escreve chunks diretamente no offset e relata cada progresso', () => {
  const destination = new Uint8Array(10).fill(0xff);
  const progress = [];
  const writer = createRangeStreamWriter(
    destination,
    { start: 2, end: 7 },
    (event) => progress.push(event),
  );
  writer.push(Uint8Array.of(1, 2));
  writer.push(Uint8Array.of(3, 4, 5, 6));
  writer.finish();

  assert.deepEqual([...destination], [255, 255, 1, 2, 3, 4, 5, 6, 255, 255]);
  assert.deepEqual(progress.map((event) => event.partReceivedBytes), [2, 6]);
  assert.equal(writer.receivedBytes, 6);
  assert.equal(writer.expectedBytes, 6);
});

test('recusa parte curta, longa ou fora do destino', () => {
  const short = createRangeStreamWriter(new Uint8Array(8), { start: 0, end: 3 });
  short.push(Uint8Array.of(1, 2, 3));
  assert.throws(() => short.finish(), /3 de 4/);

  const long = createRangeStreamWriter(new Uint8Array(8), { start: 0, end: 3 });
  assert.throws(() => long.push(new Uint8Array(5)), /ultrapassou/);

  assert.throws(
    () => createRangeStreamWriter(new Uint8Array(8), { start: 4, end: 8 }),
    /não cabe/,
  );
});

test('finish é idempotente e escrita posterior é recusada', () => {
  const writer = createRangeStreamWriter(new Uint8Array(2), { start: 0, end: 1 });
  writer.push(Uint8Array.of(1, 2));
  writer.finish();
  writer.finish();
  assert.throws(() => writer.push(Uint8Array.of(3)), /já foi encerrada/);
});

