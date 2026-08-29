import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GeoJsonMapError,
  convertGeoJsonToTabwinMap,
  listGeoJsonFeatureProperties,
} from '../dist/packages/formats/src/index.js';

function feature(geometry, properties) {
  return { type: 'Feature', properties, geometry };
}

function collection(...features) {
  return { type: 'FeatureCollection', features };
}

const RO_SQUARE = [[[-64, -9], [-63, -9], [-63, -8], [-64, -8], [-64, -9]]];

test('lists the real property names on the first feature, for a picker UI', () => {
  const source = collection(
    feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '11', NM_MUN: 'Rondônia' }),
  );
  assert.deepEqual(listGeoJsonFeatureProperties(source), ['CD_MUN', 'NM_MUN']);
});

test('converts a Polygon FeatureCollection into a TabwinMapDefinition the renderer already understands', () => {
  const source = collection(
    feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '11', NM_MUN: 'Rondônia' }),
  );
  const map = convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' });
  assert.equal(map.version, 0);
  assert.equal(map.objects.length, 1);
  assert.equal(map.objects[0]?.type, 'polygon');
  assert.equal(map.objects[0]?.geocode, '11');
  assert.equal(map.objects[0]?.name, 'Rondônia');
  assert.equal(map.objects[0]?.parts.length, 1);
  assert.equal(map.objects[0]?.points.length, 5);
  assert.deepEqual(map.bounds, { west: -64, east: -63, south: -9, north: -8 });
  assert.deepEqual(map.warnings, []);
});

test('a MultiPolygon stays one logical area with all polygon members as parts', () => {
  const source = collection(
    feature(
      { type: 'MultiPolygon', coordinates: [RO_SQUARE, [[[10, 10], [11, 10], [11, 11], [10, 10]]]] },
      { CD_MUN: '11', NM_MUN: 'Rondônia' },
    ),
  );
  const map = convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' });
  assert.equal(map.objects.length, 1);
  assert.equal(map.objects[0]?.geocode, '11');
  assert.equal(map.objects[0]?.name, 'Rondônia');
  assert.equal(map.objects[0]?.parts.length, 2);
});

test('falls back to the geocode as the label when the name property is empty', () => {
  const source = collection(feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '11', NM_MUN: '' }));
  const map = convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' });
  assert.equal(map.objects[0]?.name, '11');
});

test('a feature missing the geocode property is skipped with a warning, not silently dropped', () => {
  const source = collection(
    feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '', NM_MUN: 'Sem código' }),
    feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '12', NM_MUN: 'Acre' }),
  );
  const map = convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' });
  assert.equal(map.objects.length, 1);
  assert.equal(map.objects[0]?.geocode, '12');
  assert.equal(map.warnings.length, 1);
  assert.match(map.warnings[0], /empty "CD_MUN"/);
});

test('a polygon with interior rings converts but warns that holes render filled', () => {
  const withHole = [
    RO_SQUARE[0],
    [[-63.8, -8.8], [-63.6, -8.8], [-63.6, -8.6], [-63.8, -8.6], [-63.8, -8.8]],
  ];
  const source = collection(feature({ type: 'Polygon', coordinates: withHole }, { CD_MUN: '11', NM_MUN: 'Rondônia' }));
  const map = convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' });
  assert.equal(map.objects[0]?.parts.length, 2);
  assert.equal(map.warnings.length, 1);
  assert.match(map.warnings[0], /render.* filled, not as holes/);
});

test('Point and LineString geometries convert to their matching object type', () => {
  const source = collection(
    feature({ type: 'Point', coordinates: [-63.5, -8.5] }, { CD: 'p1', NM: 'Sede' }),
    feature({ type: 'LineString', coordinates: [[-64, -9], [-63, -8]] }, { CD: 'l1', NM: 'Fronteira' }),
  );
  const map = convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD', nameProperty: 'NM' });
  assert.equal(map.objects[0]?.type, 'point');
  assert.equal(map.objects[1]?.type, 'line');
});

test('an unsupported geometry type fails explicitly, naming the feature', () => {
  const source = collection(feature({ type: 'GeometryCollection', geometries: [] }, { CD_MUN: '11', NM_MUN: 'Rondônia' }));
  assert.throws(
    () => convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' }),
    (error) => error instanceof GeoJsonMapError && /unsupported geometry type "GeometryCollection"/.test(error.message),
  );
});

test('a document that is not a FeatureCollection or Feature is rejected', () => {
  assert.throws(
    () => convertGeoJsonToTabwinMap({ type: 'Polygon', coordinates: RO_SQUARE }, { geocodeProperty: 'x', nameProperty: 'y' }),
    GeoJsonMapError,
  );
});

test('a non-finite coordinate is rejected rather than silently propagated into bounds', () => {
  const bad = collection(
    feature({ type: 'Polygon', coordinates: [[[-64, -9], [NaN, -9], [-63, -8], [-64, -9]]] }, { CD_MUN: '11', NM_MUN: 'X' }),
  );
  assert.throws(() => convertGeoJsonToTabwinMap(bad, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' }), GeoJsonMapError);
});

test('an empty result set fails explicitly instead of producing a map with no objects', () => {
  const source = collection(feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '', NM_MUN: 'X' }));
  assert.throws(
    () => convertGeoJsonToTabwinMap(source, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN' }),
    (error) => error instanceof GeoJsonMapError && /no usable features/.test(error.message),
  );
});

test('the object-count safety limit is enforced', () => {
  const many = collection(
    feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '1', NM_MUN: 'A' }),
    feature({ type: 'Polygon', coordinates: RO_SQUARE }, { CD_MUN: '2', NM_MUN: 'B' }),
  );
  assert.throws(
    () => convertGeoJsonToTabwinMap(many, { geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN', maxObjects: 1 }),
    (error) => error instanceof GeoJsonMapError && /safety limit 1/.test(error.message),
  );
});

test('the point safety limit applies to the whole logical polygon, not separately to each ring', () => {
  const withTwoRings = collection(feature({
    type: 'Polygon',
    coordinates: [RO_SQUARE[0], [[-63.8, -8.8], [-63.6, -8.8], [-63.8, -8.6]]],
  }, { CD_MUN: '11', NM_MUN: 'Rondônia' }));
  assert.throws(
    () => convertGeoJsonToTabwinMap(withTwoRings, {
      geocodeProperty: 'CD_MUN', nameProperty: 'NM_MUN', maxPointsPerObject: 6,
    }),
    (error) => error instanceof GeoJsonMapError && /exceeds safety limit of 6 points/.test(error.message),
  );
});
