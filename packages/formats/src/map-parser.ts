import type {
  MapCoordinate,
  TabwinMapDefinition,
  TabwinMapObject,
  TabwinMapObjectType,
} from './map-model.js';

export class TabwinMapParseError extends Error {
  constructor(message: string, readonly offset?: number) {
    super(offset === undefined ? message : `MAP offset ${offset}: ${message}`);
    this.name = 'TabwinMapParseError';
  }
}

export interface ParseTabwinMapOptions {
  strict?: boolean;
  maxObjects?: number;
  maxPointsPerObject?: number;
}

const OBJECT_TYPES: TabwinMapObjectType[] = [
  'polygon',
  'polygon-with-seat',
  'line',
  'point',
];

class Reader {
  readonly view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  ensure(length: number, context: string): void {
    if (this.offset + length > this.bytes.length) {
      throw new TabwinMapParseError(`truncated while reading ${context}`, this.offset);
    }
  }

  uint8(context: string): number {
    this.ensure(1, context);
    return this.view.getUint8(this.offset++);
  }

  uint16(context: string): number {
    this.ensure(2, context);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  float32(context: string): number {
    this.ensure(4, context);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    if (!Number.isFinite(value)) {
      throw new TabwinMapParseError(`non-finite ${context}`, this.offset - 4);
    }
    return value;
  }

  fixedText(byteLength: number, logicalLength: number, context: string): string {
    this.ensure(byteLength, context);
    const raw = this.bytes.subarray(this.offset, this.offset + byteLength);
    this.offset += byteLength;
    const boundedLength = Math.min(logicalLength, byteLength);
    return new TextDecoder('windows-1252')
      .decode(raw.subarray(0, boundedLength))
      .replace(/\0+$/g, '')
      .trimEnd();
  }
}

function samePoint(a: MapCoordinate, b: MapCoordinate): boolean {
  return Object.is(a.x, b.x) && Object.is(a.y, b.y);
}

function splitParts(points: MapCoordinate[]): MapCoordinate[][] {
  const parts: MapCoordinate[][] = [];
  let current: MapCoordinate[] = [];

  for (const point of points) {
    current.push(point);
    if (current.length > 2 && samePoint(point, current[0]!)) {
      parts.push(current);
      current = [];
    }
  }
  if (current.length) parts.push(current);
  return parts;
}

export function parseTabwinMap(
  source: Uint8Array,
  options: ParseTabwinMapOptions = {},
): TabwinMapDefinition {
  const strict = options.strict ?? true;
  const maxObjects = options.maxObjects ?? 100_000;
  const maxPointsPerObject = options.maxPointsPerObject ?? 1_000_000;
  const reader = new Reader(source);
  const warnings: string[] = [];

  if (source.byteLength < 18) throw new TabwinMapParseError('file is smaller than the 18-byte header');

  const version = reader.uint16('version');
  const bounds = {
    east: reader.float32('east bound'),
    north: reader.float32('north bound'),
    west: reader.float32('west bound'),
    south: reader.float32('south bound'),
  };
  if (version !== 100) {
    const message = `unverified MAP version ${version}; expected 100 (1.00)`;
    if (strict) throw new TabwinMapParseError(message, 0);
    warnings.push(message);
  }

  const objects: TabwinMapObject[] = [];
  while (reader.offset < source.byteLength) {
    if (objects.length >= maxObjects) {
      throw new TabwinMapParseError(`object count exceeds safety limit ${maxObjects}`, reader.offset);
    }
    const objectOffset = reader.offset;
    const typeCode = reader.uint8('object type');
    const type = OBJECT_TYPES[typeCode];
    if (!type) throw new TabwinMapParseError(`unknown object type ${typeCode}`, objectOffset);

    const geocodeLength = reader.uint8('geocode length');
    if (geocodeLength > 10) {
      throw new TabwinMapParseError(`geocode length ${geocodeLength} exceeds fixed width 10`, reader.offset - 1);
    }
    const geocode = reader.fixedText(10, geocodeLength, 'geocode');
    const nameLength = reader.uint8('name length');
    if (nameLength > 25) {
      throw new TabwinMapParseError(`name length ${nameLength} exceeds fixed width 25`, reader.offset - 1);
    }
    const name = reader.fixedText(25, nameLength, 'name');
    const labelPoint = {
      x: reader.float32('label x coordinate'),
      y: reader.float32('label y coordinate'),
    };
    const pointCount = reader.uint16('point count');
    if (pointCount > maxPointsPerObject) {
      throw new TabwinMapParseError(
        `point count ${pointCount} exceeds safety limit ${maxPointsPerObject}`,
        reader.offset - 2,
      );
    }

    const points: MapCoordinate[] = [];
    for (let index = 0; index < pointCount; index++) {
      points.push({
        x: reader.float32(`point ${index + 1} x coordinate`),
        y: reader.float32(`point ${index + 1} y coordinate`),
      });
    }
    if (strict && (type === 'polygon' || type === 'polygon-with-seat') && points.length < 3) {
      throw new TabwinMapParseError('polygon has fewer than three points', objectOffset);
    }

    objects.push({ type, geocode, name, labelPoint, points, parts: splitParts(points) });
  }

  return { version, bounds, objects, warnings };
}
