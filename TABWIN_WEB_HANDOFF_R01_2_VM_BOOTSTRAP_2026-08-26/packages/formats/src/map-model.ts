/** Normalized, renderer-independent representation of a legacy TabWin .MAP. */

export type TabwinMapObjectType = 'polygon' | 'polygon-with-seat' | 'line' | 'point';

export interface MapCoordinate {
  x: number;
  y: number;
}

export interface TabwinMapBounds {
  east: number;
  north: number;
  west: number;
  south: number;
}

export interface TabwinMapObject {
  type: TabwinMapObjectType;
  geocode: string;
  name: string;
  labelPoint: MapCoordinate;
  /** Original point sequence, retained for exact archaeology and line/point use. */
  points: MapCoordinate[];
  /** Polygon/line parts split whenever the source closes a ring at its first point. */
  parts: MapCoordinate[][];
}

export interface TabwinMapDefinition {
  /**
   * 100 represents legacy version 1.00, as parsed from a real `.MAP` file.
   * 0 marks a map converted from a non-legacy source (GeoJSON import) —
   * there is no legacy version to preserve. See `geojson-map.ts`.
   */
  version: number;
  bounds: TabwinMapBounds;
  objects: TabwinMapObject[];
  warnings: string[];
}
