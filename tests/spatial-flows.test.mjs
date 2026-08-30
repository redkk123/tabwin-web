import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addFlowDistances,
  buildOriginDestinationFlows,
  distanceBetween,
  mapGeocodePoints,
} from '../dist/packages/analysis/src/spatial-flows.js';

test('distance model is explicit: planar and haversine never get guessed', () => {
  assert.equal(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 }, { kind: 'planar' }), 5);
  const oneDegreeEquator = distanceBetween(
    { x: 0, y: 0 }, { x: 1, y: 0 }, { kind: 'geographic-haversine' },
  );
  assert.ok(Math.abs(oneDegreeEquator - 111.195) < 0.01);
});

test('OD aggregation reports missing, unknown and invalid-weight records separately', () => {
  const records = [
    { O: 'A', D: 'B', W: 2 },
    { O: 'A', D: 'B', W: '3' },
    { O: 'A', D: '', W: 9 },
    { O: 'X', D: 'B', W: 4 },
    { O: 'A', D: 'B', W: 'oops' },
  ];
  const result = buildOriginDestinationFlows(records, {
    originField: 'O', destinationField: 'D', weightField: 'W', knownGeocodes: new Set(['A', 'B']),
  });
  assert.deepEqual(result.flows, [{ origin: 'A', destination: 'B', value: 5, records: 2 }]);
  assert.equal(result.recordsSeen, 5);
  assert.equal(result.recordsAccepted, 2);
  assert.equal(result.missingDestination, 1);
  assert.equal(result.unknownOrigin, 1);
  assert.equal(result.invalidWeight, 1);
});

test('map representative points feed distances and missing points stay explicit', () => {
  const map = {
    version: 0,
    bounds: { west: 0, east: 4, south: 0, north: 4 },
    warnings: [],
    objects: [
      { type: 'point', geocode: 'A', name: 'A', labelPoint: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }], parts: [[{ x: 0, y: 0 }]] },
      { type: 'point', geocode: 'B', name: 'B', labelPoint: { x: 3, y: 4 }, points: [{ x: 3, y: 4 }], parts: [[{ x: 3, y: 4 }]] },
    ],
  };
  const points = mapGeocodePoints(map);
  const enriched = addFlowDistances([
    { origin: 'A', destination: 'B', value: 2, records: 2 },
    { origin: 'A', destination: 'C', value: 1, records: 1 },
  ], points, { kind: 'planar', unitLabel: 'km-projected' });
  assert.equal(enriched[0].distance, 5);
  assert.equal(enriched[0].distanceUnit, 'km-projected');
  assert.equal(enriched[1].distance, undefined);
});
