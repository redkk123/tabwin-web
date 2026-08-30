/**
 * Normalized representation of a TabWin code-conversion table (.CNV).
 *
 * The model deliberately preserves rule-line source order. That is required for
 * compatibility because overlap precedence is observable behavior in TabWin.
 */

export type CnvMode = 'short' | 'literal' | 'numeric-ranges' | 'new-format';
export type CnvPrecedence = 'first-match-wins' | 'last-match-wins';

export interface CnvCodeRange {
  from: string;
  to: string;
}

export interface CnvCategory {
  /** 1-based category sequence in the legacy file. */
  sequence: number;
  label: string;
  /** Only meaningful when the CNV is used as a row dimension. */
  subtotalTarget?: number;
  /** Legacy # marker: row is informational and excluded from column totals. */
  excludeFromTotal?: boolean;
}

export interface CnvRuleLine {
  categorySequence: number;
  exactCodes: string[];
  ranges: CnvCodeRange[];
  /** Numeric-ranges mode uses one inclusive upper bound per source line. */
  numericUpperInclusive?: number;
  sourceOrder: number;
  sourceLine: number;
}

export interface CnvDefinition {
  categoryCount: number;
  codeLength: number;
  mode: CnvMode;
  precedence: CnvPrecedence;
  categories: CnvCategory[];
  rules: CnvRuleLine[];
  comments: string[];
  warnings: string[];
  headerLine: number;
}

export interface CnvMatch {
  sequence: number;
  label: string;
}
