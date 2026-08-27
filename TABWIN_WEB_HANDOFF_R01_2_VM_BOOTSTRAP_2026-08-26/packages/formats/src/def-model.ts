/**
 * Normalized representation of a TabWin definition file (.DEF).
 *
 * The representation is deliberately loss-aware: source line, directive and
 * unsupported lines are retained so compatibility work can be audited instead
 * of silently normalizing legacy semantics away.
 */

export type DefDirective = 'A' | 'R' | 'S' | 'L' | 'C' | 'Q' | 'D' | 'T' | 'I' | 'G';
export type DefRole = 'selection' | 'row' | 'column' | 'quad';

export interface DefDataSource {
  pattern: string;
  /** TabWin 3.x+ optional SQL query associated with the A directive. */
  sqlQuery?: string;
  sourceLine: number;
}

interface DefOptionBase {
  directive: 'S' | 'L' | 'C' | 'Q' | 'D' | 'T';
  label: string;
  field: string;
  roles: DefRole[];
  sourceLine: number;
}

/** Standard DEF option backed by a CNV conversion table. */
export interface DefConversionOption extends DefOptionBase {
  kind: 'conversion';
  /** 1-based initial character position inside the DBF field. */
  startPosition: number;
  conversionFile: string;
}

/** Legacy option that relates the source field to another DBF lookup table. */
export interface DefDbfLookupOption extends DefOptionBase {
  kind: 'dbf-lookup';
  lookupLabelField: string;
  lookupFile: string;
}

export type DefOption = DefConversionOption | DefDbfLookupOption;

export interface DefIncrement {
  label: string;
  field: string;
  sourceLine: number;
}

export interface DefUnknownLine {
  directive: string;
  raw: string;
  sourceLine: number;
}

export interface DefDefinition {
  /** First semicolon-comment description, per the historical manual. */
  description?: string;
  dataSources: DefDataSource[];
  options: DefOption[];
  increments: DefIncrement[];
  /** G directive: each record contributes the value of this field to frequency. */
  groupedCountField?: string;
  /** R directive, retained for old TABDOS compatibility even though Web does not use it. */
  reportFile?: string;
  comments: string[];
  unknownLines: DefUnknownLine[];
  warnings: string[];
}
