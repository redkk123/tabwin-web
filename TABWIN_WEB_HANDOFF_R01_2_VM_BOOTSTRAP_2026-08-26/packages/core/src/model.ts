export type CompatibilityProfile = 'tabwin-4.15' | 'modern';

export interface SourceFingerprint {
  name: string;
  size: number;
  sha256: string;
  source: 'local' | 'official' | 'mirror';
  sourceUrl?: string;
}

export interface DimensionSpec {
  field: string;
  conversionId?: string;
  /** 1-based initial character position inside the source field, as in DEF Campo D. */
  startPosition?: number;
}

export interface FilterSpec {
  field: string;
  /** Category sequence ids as strings when conversionId is present; otherwise raw values. */
  acceptedCategories: string[];
  conversionId?: string;
  /** 1-based initial character position inside the source field, as in DEF Campo D. */
  startPosition?: number;
}

export type TotalPolicy =
  | 'none'
  | 'sum'
  | 'product'
  | 'mean'
  | 'initial'
  | 'final'
  | 'min'
  | 'max'
  | 'precalculated';

export interface MeasureSpec {
  kind: 'count' | 'sum';
  field?: string;
  /** DEF G semantics: grouped records contribute this field instead of a literal 1 to frequency. */
  weightField?: string;
  totalPolicy?: TotalPolicy;
}

export interface TabulationSpec {
  compatibilityProfile: CompatibilityProfile;
  rows: DimensionSpec;
  columns?: DimensionSpec;
  measure: MeasureSpec;
  filters: FilterSpec[];
  suppressZeroRows?: boolean;
}

export interface QueryPlan {
  version: 1;
  spec: TabulationSpec;
  warnings: string[];
}

export interface ResultAxisItem {
  key: string;
  label: string;
  source: 'raw' | 'conversion' | 'derived';
  subtotalTargetKey?: string;
  excludeFromTotal?: boolean;
  /** Explicit display policy for a post-tabulation derived column. */
  totalPolicy?: TotalPolicy;
}

export interface TabulationResult {
  rows: ResultAxisItem[];
  columns: ResultAxisItem[];
  cells: number[][];
  warnings: string[];
  recordsSeen: number;
  recordsAccepted: number;
}

export interface DerivedColumnSpec {
  key: string;
  label: string;
  totalPolicy: Exclude<TotalPolicy, 'precalculated'>;
}

export type TableOperation =
  | {
      kind: 'binary';
      operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'minimum' | 'maximum' | 'percentage';
      leftColumnKey: string;
      rightColumnKey: string;
      output: DerivedColumnSpec;
      divisionByZero: 'error' | 'zero';
    }
  | {
      kind: 'factor';
      sourceColumnKey: string;
      factor: number;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'cumulative';
      sourceColumnKey: string;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'absolute';
      sourceColumnKey: string;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'integer';
      sourceColumnKey: string;
      rounding: 'truncate' | 'round' | 'floor' | 'ceil';
      output: DerivedColumnSpec;
    }
  | {
      kind: 'sequence';
      start: number;
      step: number;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'constant';
      value: number;
      output: DerivedColumnSpec;
    };

export type DataRecord = Record<string, unknown>;
