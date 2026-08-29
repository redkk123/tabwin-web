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
  /** Explicit handling when a raw value is empty or has no CNV match. */
  unclassifiedPolicy?: 'omit' | 'discriminate';
}

interface FilterSpecBase {
  field: string;
  /** Modern provenance marker; execution remains identical to an ordinary explicit filter. */
  origin?: 'data-quality';
  /** Include matches by default; exclude inverts the predicate. */
  mode?: 'include' | 'exclude';
  conversionId?: string;
  /** 1-based initial character position inside the source field, as in DEF Campo D. */
  startPosition?: number;
}

export type FilterSpec = FilterSpecBase & (
  | {
      kind?: 'categories';
      /** Category sequence ids when conversionId is present; otherwise raw values. */
      acceptedCategories: string[];
      /** Treat a missing CNV match as another selected category. */
      includeUnclassified?: boolean;
    }
  | {
      kind: 'numeric-range';
      minimum?: number;
      maximum?: number;
      includeMinimum?: boolean;
      includeMaximum?: boolean;
    }
);

/**
 * A record-level implausibility rule spanning more than one field.
 *
 * Single-field filters intersect, so they cannot express "this combination is
 * implausible": excluding A and excluding B keeps only records that are
 * neither, while the rule needs to reject records that are both. Conditions
 * reuse {@link FilterSpec} verbatim, so no new matching semantics exist here —
 * only the conjunction and the action are new.
 *
 * This is a modern, user-authored policy. The kernel never ships clinical
 * meaning of its own: it evaluates exactly the combination the user wrote.
 */
export interface CrossFieldRuleSpec {
  id: string;
  label: string;
  /** Every condition must accept the record for the rule to match. */
  conditions: FilterSpec[];
  /** `flag` only counts; `exclude` also removes the record from the tabulation. */
  action: 'flag' | 'exclude';
}

/** Per-rule outcome, counted over every record seen, not over the filtered subset. */
export interface DataQualityRuleOutcome {
  id: string;
  label: string;
  action: 'flag' | 'exclude';
  matchedRecords: number;
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
  /**
   * Column header for a sum, taken verbatim from the DEF increment (`I`)
   * whose field this is — "Valor Total" for `VAL_TOT`, not a generic word.
   * Established by G003 against the real engine, which labels the column with
   * the increment's own name. Absent when a sum runs over a raw field with no
   * DEF increment behind it; there is no TabWin precedent for that case, so
   * the executor falls back to a neutral header rather than inventing one.
   */
  label?: string;
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
  suppressZeroColumns?: boolean;
  /** Modern, user-authored implausibility rules spanning more than one field. */
  crossFieldRules?: CrossFieldRuleSpec[];
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
  /** Present only when the spec declared cross-field rules, so existing
   *  golden and portable-table payloads stay byte-identical. */
  dataQuality?: DataQualityRuleOutcome[];
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
    }
  | {
      kind: 'expression';
      expression: string;
      divisionByZero: 'error' | 'zero';
      output: DerivedColumnSpec;
    }
  | { kind: 'rename-column'; columnKey: string; label: string }
  | { kind: 'move-column'; columnKey: string; direction: 'left' | 'right' }
  | { kind: 'delete-column'; columnKey: string }
  | { kind: 'transpose' }
  | {
      /** Self-contained, strict row-key join. This is a modern explicit policy until golden-tested. */
      kind: 'include-table';
      sourceLabel: string;
      requireMatchingLabels: boolean;
      rows: Array<Pick<ResultAxisItem, 'key' | 'label'>>;
      columns: ResultAxisItem[];
      cells: number[][];
    }
  | { kind: 'suppress-rows'; rowKeys: string[] }
  | {
      kind: 'aggregate-rows';
      rowKeys: string[];
      outputRow: { key: string; label: string; excludeFromTotal: boolean };
      removeSources: boolean;
    };

export type DataRecord = Record<string, unknown>;
