import type { MapCoordinate, TabwinMapDefinition } from '../../formats/src/map-model.js';
import type { DataRecord } from '../../core/src/model.js';

export type DistanceModel =
  | { kind: 'geographic-haversine'; earthRadiusKm?: number }
  | { kind: 'planar'; unitLabel?: string };

export interface FlowEdge {
  origin: string;
  destination: string;
  value: number;
  records: number;
}

export interface FlowBuildResult {
  flows: FlowEdge[];
  recordsSeen: number;
  recordsAccepted: number;
  missingOrigin: number;
  missingDestination: number;
  unknownOrigin: number;
  unknownDestination: number;
  invalidWeight: number;
}

export interface BuildFlowOptions {
  originField: string;
  destinationField: string;
  weightField?: string;
  /** Optional namespace of valid geocodes from the active map/lookup. */
  knownGeocodes?: ReadonlySet<string>;
  /** Unknown geocodes are diagnostic by default and excluded from edges. */
  unknownPolicy?: 'exclude' | 'include';
}

export interface FlowWithDistance extends FlowEdge {
  distance: number | undefined;
  distanceUnit: string;
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * Explicit distance contract. We never infer whether MAP coordinates are
 * degrees or projected units: callers must choose a model.
 */
export function distanceBetween(
  a: MapCoordinate,
  b: MapCoordinate,
  model: DistanceModel,
): number {
  if (model.kind === 'planar') return Math.hypot(b.x - a.x, b.y - a.y);
  const radius = model.earthRadiusKm ?? 6371.0088;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('earth radius must be positive and finite');
  const radians = Math.PI / 180;
  const lat1 = a.y * radians;
  const lat2 = b.y * radians;
  const deltaLat = (b.y - a.y) * radians;
  const deltaLon = (b.x - a.x) * radians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Uses the map's explicit label/seat point as the representative coordinate. */
export function mapGeocodePoints(map: TabwinMapDefinition): Map<string, MapCoordinate> {
  const points = new Map<string, MapCoordinate>();
  for (const object of map.objects) {
    const geocode = object.geocode.trim();
    if (!geocode) continue;
    const existing = points.get(geocode);
    if (existing && (existing.x !== object.labelPoint.x || existing.y !== object.labelPoint.y)) {
      throw new Error(`map geocode ${geocode} has conflicting representative points`);
    }
    points.set(geocode, object.labelPoint);
  }
  return points;
}

export interface FlowAccumulator {
  push(records: Iterable<DataRecord>): void;
  finish(): FlowBuildResult;
}

/**
 * Batch-at-a-time aggregation, so the Worker can stream a 63 MiB file past
 * this without ever holding its records. `buildOriginDestinationFlows` is the
 * same thing in one call, for callers that already have the records in hand.
 */
export function createFlowAccumulator(options: BuildFlowOptions): FlowAccumulator {
  const originField = options.originField.trim();
  const destinationField = options.destinationField.trim();
  if (!originField || !destinationField) throw new Error('origin and destination fields are required');
  const weightField = options.weightField?.trim();
  const unknownPolicy = options.unknownPolicy ?? 'exclude';
  const known = options.knownGeocodes;
  const totals = new Map<string, FlowEdge>();
  let recordsSeen = 0;
  let recordsAccepted = 0;
  let missingOrigin = 0;
  let missingDestination = 0;
  let unknownOrigin = 0;
  let unknownDestination = 0;
  let invalidWeight = 0;

  return {
    push(records) {
      for (const record of records) {
        recordsSeen++;
        const origin = textValue(record[originField]);
        const destination = textValue(record[destinationField]);
        if (!origin) missingOrigin++;
        if (!destination) missingDestination++;
        if (!origin || !destination) continue;

        const originUnknown = known !== undefined && !known.has(origin);
        const destinationUnknown = known !== undefined && !known.has(destination);
        if (originUnknown) unknownOrigin++;
        if (destinationUnknown) unknownDestination++;
        if (unknownPolicy === 'exclude' && (originUnknown || destinationUnknown)) continue;

        let weight = 1;
        if (weightField) {
          const rawWeight = record[weightField];
          weight = typeof rawWeight === 'number' ? rawWeight : Number(String(rawWeight ?? '').replace(',', '.'));
          if (!Number.isFinite(weight)) {
            invalidWeight++;
            continue;
          }
        }

        const key = `${origin}\u0000${destination}`;
        const edge = totals.get(key);
        if (edge) {
          edge.value += weight;
          edge.records++;
        } else {
          totals.set(key, { origin, destination, value: weight, records: 1 });
        }
        recordsAccepted++;
      }
    },
    finish() {
      return {
        flows: [...totals.values()].sort((a, b) => b.value - a.value
          || a.origin.localeCompare(b.origin, 'en', { numeric: true })
          || a.destination.localeCompare(b.destination, 'en', { numeric: true })),
        recordsSeen,
        recordsAccepted,
        missingOrigin,
        missingDestination,
        unknownOrigin,
        unknownDestination,
        invalidWeight,
      };
    },
  };
}

export function buildOriginDestinationFlows(
  records: Iterable<DataRecord>,
  options: BuildFlowOptions,
): FlowBuildResult {
  const accumulator = createFlowAccumulator(options);
  accumulator.push(records);
  return accumulator.finish();
}
export function addFlowDistances(
  flows: readonly FlowEdge[],
  points: ReadonlyMap<string, MapCoordinate>,
  model: DistanceModel,
): FlowWithDistance[] {
  const unit = model.kind === 'geographic-haversine' ? 'km' : (model.unitLabel ?? 'map-unit');
  return flows.map((flow) => {
    const origin = points.get(flow.origin);
    const destination = points.get(flow.destination);
    return {
      ...flow,
      distance: origin && destination ? distanceBetween(origin, destination, model) : undefined,
      distanceUnit: unit,
    };
  });
}
