import assert from 'node:assert/strict';
import test from 'node:test';
import { mapObjectAtPoint, mapObjectContainsPoint, pointInMapRing } from '../dist/packages/visualization/src/map-hit-test.js';

const square = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 },
];
const object = {
  type: 'polygon', geocode: '5300108', name: 'Teste', labelPoint: { x: 5, y: 5 }, points: square, parts: [square],
};

test('map hit testing follows polygon geometry and topmost object order', () => {
  assert.equal(pointInMapRing({ x: 5, y: 5 }, square), true);
  assert.equal(pointInMapRing({ x: 20, y: 5 }, square), false);
  assert.equal(mapObjectContainsPoint(object, { x: 5, y: 5 }), true);
  const top = { ...object, geocode: 'top' };
  assert.equal(mapObjectAtPoint([object, top], { x: 5, y: 5 })?.geocode, 'top');
});
