import type { CnvDefinition, CnvMatch, CnvRuleLine } from './cnv-model.js';

function normalizeCode(raw: unknown, codeLength: number): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).slice(0, codeLength);
}

function matchesRule(code: string, rule: CnvRuleLine): boolean {
  if (rule.exactCodes.includes(code)) return true;
  return rule.ranges.some((range) => code >= range.from && code <= range.to);
}

export function classifyCnv(definition: CnvDefinition, raw: unknown): CnvMatch | undefined {
  if (definition.mode === 'numeric-ranges') {
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(value)) return undefined;
    for (const rule of definition.rules) {
      if (rule.numericUpperInclusive !== undefined && value <= rule.numericUpperInclusive) {
        const category = definition.categories.find(
          (candidate) => candidate.sequence === rule.categorySequence,
        );
        return category ? { sequence: category.sequence, label: category.label } : undefined;
      }
    }
    return undefined;
  }

  const code = normalizeCode(raw, definition.codeLength);
  if (!code) return undefined;

  const orderedRules =
    definition.precedence === 'first-match-wins'
      ? definition.rules
      : [...definition.rules].reverse();

  const matched = orderedRules.find((rule) => matchesRule(code, rule));
  if (!matched) return undefined;
  const category = definition.categories.find(
    (candidate) => candidate.sequence === matched.categorySequence,
  );
  return category ? { sequence: category.sequence, label: category.label } : undefined;
}
