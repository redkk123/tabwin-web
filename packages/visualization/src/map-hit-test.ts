import type { MapCoordinate, TabwinMapObject } from '../../formats/src/map-model.js';

/** Ray-casting test used by the canvas renderer and by spatial-selection tools. */
export function pointInMapRing(point: MapCoordinate, ring: readonly MapCoordinate[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const denominator = previousPoint.y - currentPoint.y;
    const intersects = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
        / denominator + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Legacy MAP/normalized GeoJSON objects can contain several polygon parts.
 * Even-odd parity matches the canvas `fill('evenodd')` behavior already used
 * by the web renderer and therefore keeps hit testing visually consistent.
 */
export function mapObjectContainsPoint(object: TabwinMapObject, point: MapCoordinate): boolean {
  if (object.type === 'point') return object.labelPoint.x === point.x && object.labelPoint.y === point.y;
  if (object.type === 'line') return false;
  let inside = false;
  for (const part of object.parts) if (pointInMapRing(point, part)) inside = !inside;
  return inside;
}

export function mapObjectAtPoint(
  objects: readonly TabwinMapObject[],
  point: MapCoordinate,
): TabwinMapObject | undefined {
  for (let index = objects.length - 1; index >= 0; index--) {
    const object = objects[index];
    if (object && mapObjectContainsPoint(object, point)) return object;
  }
  return undefined;
}
