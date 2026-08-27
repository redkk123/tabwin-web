import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTabwinMap } from '../dist/packages/formats/src/index.js';

function fixtureMap() {
  const buffer = new ArrayBuffer(18 + 1 + 1 + 10 + 1 + 25 + 4 + 4 + 2 + (5 * 8));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  view.setUint16(offset, 100, true); offset += 2;
  for (const value of [1, 1, 0, 0]) { view.setFloat32(offset, value, true); offset += 4; }
  view.setUint8(offset++, 0);
  view.setUint8(offset++, 2);
  bytes.set(new TextEncoder().encode('11'.padEnd(10, '\0')), offset); offset += 10;
  view.setUint8(offset++, 2);
  bytes.set(new TextEncoder().encode('RO'.padEnd(25, ' ')), offset); offset += 25;
  view.setFloat32(offset, 0.5, true); offset += 4;
  view.setFloat32(offset, 0.5, true); offset += 4;
  view.setUint16(offset, 5, true); offset += 2;
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) {
    view.setFloat32(offset, x, true); offset += 4;
    view.setFloat32(offset, y, true); offset += 4;
  }
  return new Uint8Array(buffer);
}

test('parses a TabWin 1.00 polygon map and honors Pascal geocode length', () => {
  const map = parseTabwinMap(fixtureMap());
  assert.equal(map.version, 100);
  assert.deepEqual(map.bounds, { east: 1, north: 1, west: 0, south: 0 });
  assert.equal(map.objects.length, 1);
  assert.equal(map.objects[0]?.geocode, '11');
  assert.equal(map.objects[0]?.name, 'RO');
  assert.equal(map.objects[0]?.parts.length, 1);
  assert.equal(map.objects[0]?.parts[0]?.length, 5);
});

test('rejects truncated MAP input with an auditable byte offset', () => {
  const truncated = fixtureMap().subarray(0, -3);
  assert.throws(() => parseTabwinMap(truncated), /MAP offset .*truncated/);
});
