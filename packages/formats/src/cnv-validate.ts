/**
 * Structural diagnostics over a {@link CnvDefinition} model — the same
 * checks `cnv-parser.ts` runs while reading text, reusable by an editor
 * that only ever touches the model, never raw text. `cnv-parser.ts`'s
 * `warnings` array is fixed at parse time; this recomputes the same class
 * of issue (plus a few an editor can newly introduce, like a category with
 * no matching rule at all) against whatever the model currently is —
 * "diagnóstico por linha" for a UI where lines get added, edited and
 * removed, so an original source line number stops being meaningful.
 */

import type { CnvDefinition } from './cnv-model.js';

export interface CnvDiagnostic {
  scope: 'header' | 'category';
  /** Present when scope is 'category'. */
  categorySequence?: number;
  severity: 'warning' | 'error';
  message: string;
}

export function validateCnvDefinition(definition: CnvDefinition): CnvDiagnostic[] {
  const diagnostics: CnvDiagnostic[] = [];

  if (definition.categories.length !== definition.categoryCount) {
    diagnostics.push({
      scope: 'header',
      severity: 'warning',
      message: `header declares ${definition.categoryCount} categories but ${definition.categories.length} are defined`,
    });
  }

  const sequenceCounts = new Map<number, number>();
  for (const category of definition.categories) {
    sequenceCounts.set(category.sequence, (sequenceCounts.get(category.sequence) ?? 0) + 1);
  }

  const sequenceSet = new Set(definition.categories.map((category) => category.sequence));
  const rulesByCategory = new Map(definition.rules.map((rule) => [rule.categorySequence, rule]));

  for (const category of definition.categories) {
    if ((sequenceCounts.get(category.sequence) ?? 0) > 1) {
      diagnostics.push({
        scope: 'category', categorySequence: category.sequence, severity: 'error',
        message: `sequence ${category.sequence} is used by more than one category`,
      });
    }
    if (!category.label.trim()) {
      diagnostics.push({
        scope: 'category', categorySequence: category.sequence, severity: 'warning',
        message: 'category has no label',
      });
    }
    if (category.subtotalTarget !== undefined && !sequenceSet.has(category.subtotalTarget)) {
      diagnostics.push({
        scope: 'category', categorySequence: category.sequence, severity: 'error',
        message: `subtotal target ${category.subtotalTarget} is not a category in this file`,
      });
    }

    const rule = rulesByCategory.get(category.sequence);
    if (!rule) {
      diagnostics.push({
        scope: 'category', categorySequence: category.sequence, severity: 'error',
        message: 'category has no matching rule; no code will ever be classified into it',
      });
      continue;
    }
    if (definition.mode === 'numeric-ranges') {
      if (rule.numericUpperInclusive === undefined) {
        diagnostics.push({
          scope: 'category', categorySequence: category.sequence, severity: 'error',
          message: 'numeric-ranges rule is missing its upper bound',
        });
      }
    } else if (rule.exactCodes.length === 0 && rule.ranges.length === 0) {
      diagnostics.push({
        scope: 'category', categorySequence: category.sequence, severity: 'warning',
        message: 'no codes or ranges assigned; category will never match a real value',
      });
    }
  }

  if (definition.mode === 'numeric-ranges') {
    let previous = Number.NEGATIVE_INFINITY;
    for (const rule of [...definition.rules].sort((a, b) => a.sourceOrder - b.sourceOrder)) {
      if (rule.numericUpperInclusive === undefined) continue;
      if (rule.numericUpperInclusive < previous) {
        diagnostics.push({
          scope: 'category', categorySequence: rule.categorySequence, severity: 'warning',
          message: 'numeric upper bound is lower than an earlier rule\'s — values may match an earlier, wider rule first',
        });
      }
      previous = rule.numericUpperInclusive;
    }
  }

  return diagnostics;
}
