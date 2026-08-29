/**
 * Converts a GeoJSON `FeatureCollection` of geographic areas into the same
 * renderer-independent {@link TabwinMapDefinition} the legacy `.MAP` parser
 * produces (see `map-model.ts`). The choropleth map view, zoom/pan, hit
 * testing and PNG export all operate on that shared model already, so this
 * is the entire integration surface: no renderer code changes.
 *
 * Deliberately does not guess which GeoJSON property carries the area code
 * or the display name. DATASUS/IBGE boundary files use different property
 * names depending on the source (`CD_MUN`, `GEOCODIGO`, `codarea`, `id`...),
 * and guessing wrong silently mislabels every area with no visible error —
 * exactly the kind of invented semantics this project avoids elsewhere (see
 * `explicit-manual-auxiliary-selection-without-rule-guessing`). The caller
 * names both properties explicitly; {@link listGeoJsonFeatureProperties}
 * exists so a UI can present the real property names found in the file for
 * a person to pick from, instead of the code picking for them.
 */

import type {
  MapCoordinate,
  TabwinMapDefinition,
  TabwinMapObject,
} from './map-model.js';

export class GeoJsonMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoJsonMapError';
  }
}

export interface ConvertGeoJsonOptions {
  geocodeProperty: string;
  nameProperty: string;
  maxObjects?: number;
  maxPointsPerObject?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertyToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function featuresOf(source: unknown): unknown[] {
  if (!isRecord(source)) throw new GeoJsonMapError('not a GeoJSON object');
  if (source.type === 'FeatureCollection') {
    if (!Array.isArray(source.features)) {
      throw new GeoJsonMapError('FeatureCollection is missing a "features" array');
    }
    return source.features;
  }
  if (source.type === 'Feature') return [source];
  throw new GeoJsonMapError('expected a GeoJSON FeatureCollection or Feature');
}

/**
 * Property keys observed on the first feature carrying a `properties`
 * object — for a picker UI, never a guess at which one is the geocode.
 */
export function listGeoJsonFeatureProperties(source: unknown): string[] {
  for (const feature of featuresOf(source)) {
    if (isRecord(feature) && isRecord(feature.properties)) {
      return Object.keys(feature.properties);
    }
  }
  return [];
}

function ring(coordinates: unknown, maxPoints: number, context: string): MapCoordinate[] {
  if (!Array.isArray(coordinates)) {
    throw new GeoJsonMapError(`${context}: malformed ring, expected an array of positions`);
  }
  if (coordinates.length > maxPoints) {
    throw new GeoJsonMapError(`${context}: ring exceeds safety limit of ${maxPoints} points`);
  }
  return coordinates.map((position, index) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new GeoJsonMapError(`${context}: malformed position at index ${index}`);
    }
    const x = Number(position[0]);
    const y = Number(position[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new GeoJsonMapError(`${context}: non-finite coordinate at index ${index}`);
    }
    return { x, y };
  });
}

function centroidOf(points: readonly MapCoordinate[]): MapCoordinate {
  if (!points.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function polygonObject(
  rings: unknown[],
  geocode: string,
  name: string,
  maxPointsPerObject: number,
  context: string,
  warnings: string[],
): TabwinMapObject {
  if (rings.length > 1) {
    // The shared map model (and the legacy renderer built on it) has no
    // hole concept — every part is drawn as its own filled shape. A real
    // interior ring (a lake inside a municipality, say) converts without
    // error, but renders solid instead of punched out. Same limitation the
    // native .MAP format already has for genuinely multi-part objects, so
    // this is flagged, not silently misrepresented.
    warnings.push(`${context}: polygon has ${rings.length} rings; interior rings render filled, not as holes`);
  }
  const parts = rings.map((r, index) => ring(r, maxPointsPerObject, `${context} ring ${index + 1}`));
  const points = parts.flat();
  if (points.length > maxPointsPerObject) {
    throw new GeoJsonMapError(`${context}: polygon exceeds safety limit of ${maxPointsPerObject} points`);
  }
  if (points.length < 3) {
    throw new GeoJsonMapError(`${context}: polygon ring has fewer than three points`);
  }
  return { type: 'polygon', geocode, name, labelPoint: centroidOf(parts[0] ?? points), points, parts };
}

function objectsFromGeometry(
  geometry: unknown,
  geocode: string,
  name: string,
  maxPointsPerObject: number,
  warnings: string[],
): TabwinMapObject[] {
  const context = `feature ${geocode}`;
  if (!isRecord(geometry)) throw new GeoJsonMapError(`${context}: missing geometry`);
  const type = geometry.type;
  const coordinates = geometry.coordinates;

  if (type === 'Polygon') {
    if (!Array.isArray(coordinates)) throw new GeoJsonMapError(`${context}: malformed Polygon coordinates`);
    return [polygonObject(coordinates, geocode, name, maxPointsPerObject, context, warnings)];
  }
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates)) throw new GeoJsonMapError(`${context}: malformed MultiPolygon coordinates`);
    // A GeoJSON feature is one logical area even when it has disconnected
    // islands. Keep one object with several parts, as the shared .MAP model
    // already supports. Returning one object per member made the UI report
    // duplicate "areas associated" and made hit-testing choose among several
    // copies of the same geocode.
    const members = coordinates.map((polygon, index) => {
      if (!Array.isArray(polygon)) {
        throw new GeoJsonMapError(`${context}: malformed MultiPolygon member ${index + 1}`);
      }
      return polygonObject(polygon, geocode, name, maxPointsPerObject, `${context} polygon ${index + 1}`, warnings);
    });
    const points = members.flatMap((member) => member.points);
    if (points.length > maxPointsPerObject) {
      throw new GeoJsonMapError(`${context}: MultiPolygon exceeds safety limit of ${maxPointsPerObject} points`);
    }
    if (!members.length) throw new GeoJsonMapError(`${context}: MultiPolygon has no polygon members`);
    return [{
      type: 'polygon',
      geocode,
      name,
      labelPoint: members[0]!.labelPoint,
      points,
      parts: members.flatMap((member) => member.parts),
    }];
  }
  if (type === 'Point') {
    if (!Array.isArray(coordinates)) throw new GeoJsonMapError(`${context}: malformed Point coordinates`);
    const point = ring([coordinates], 1, context)[0]!;
    return [{ type: 'point', geocode, name, labelPoint: point, points: [point], parts: [[point]] }];
  }
  if (type === 'LineString') {
    if (!Array.isArray(coordinates)) throw new GeoJsonMapError(`${context}: malformed LineString coordinates`);
    const points = ring(coordinates, maxPointsPerObject, context);
    return [{ type: 'line', geocode, name, labelPoint: centroidOf(points), points, parts: [points] }];
  }
  throw new GeoJsonMapError(
    `${context}: unsupported geometry type "${String(type)}" — only Polygon, MultiPolygon, `
      + 'LineString and Point convert; GeometryCollection and 3D coordinates do not',
  );
}

/**
 * Converts a parsed GeoJSON document (already `JSON.parse`d — this module
 * never touches file I/O) into a {@link TabwinMapDefinition}. Every feature
 * missing a non-empty value at `geocodeProperty` is skipped with a warning,
 * never silently dropped without a trace.
 */
export function convertGeoJsonToTabwinMap(
  source: unknown,
  options: ConvertGeoJsonOptions,
): TabwinMapDefinition {
  if (!options.geocodeProperty) throw new GeoJsonMapError('geocodeProperty is required');
  if (!options.nameProperty) throw new GeoJsonMapError('nameProperty is required');
  const maxObjects = options.maxObjects ?? 100_000;
  const maxPointsPerObject = options.maxPointsPerObject ?? 1_000_000;

  const warnings: string[] = [];
  const objects: TabwinMapObject[] = [];
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (const feature of featuresOf(source)) {
    if (!isRecord(feature)) throw new GeoJsonMapError('malformed feature entry');
    const properties = isRecord(feature.properties) ? feature.properties : {};
    const geocode = propertyToText(properties[options.geocodeProperty]).trim();
    const name = propertyToText(properties[options.nameProperty]).trim();
    if (!geocode) {
      warnings.push(`feature skipped: empty "${options.geocodeProperty}" value`);
      continue;
    }

    for (const object of objectsFromGeometry(feature.geometry, geocode, name || geocode, maxPointsPerObject, warnings)) {
      if (objects.length >= maxObjects) {
        throw new GeoJsonMapError(`object count exceeds safety limit ${maxObjects}`);
      }
      objects.push(object);
      for (const point of object.points) {
        if (point.x < west) west = point.x;
        if (point.x > east) east = point.x;
        if (point.y < south) south = point.y;
        if (point.y > north) north = point.y;
      }
    }
  }

  if (!objects.length) {
    throw new GeoJsonMapError('no usable features found — check the chosen geocode property');
  }

  return {
    // 0 marks a map not sourced from a legacy .MAP file (see map-model.ts);
    // there is no "version" to preserve from a GeoJSON import.
    version: 0,
    bounds: { east, north, west, south },
    objects,
    warnings,
  };
}
