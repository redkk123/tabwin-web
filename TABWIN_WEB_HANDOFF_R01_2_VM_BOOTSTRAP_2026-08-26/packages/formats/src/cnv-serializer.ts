/**
 * Deterministic writer for the fixed-column `.CNV` layout `cnv-parser.ts`
 * reads — the model-level counterpart that lets the editor (Faixa 3.2) save
 * a `CnvDefinition` back to the exact byte layout TabWin 4.15 itself reads,
 * via `windows-1252.ts` for the encoding.
 *
 * Deliberately refuses to serialize `new-format` (the `N` marker): its
 * widened column layout is not specified well enough to write, matching
 * `cnv-parser.ts`'s own refusal to interpret it on read. Never speculate a
 * format nobody has confirmed byte-for-byte.
 *
 * Source-line comments are not reproduced. `cnv-model.ts` already collapses
 * every comment in the file — header and body alike — into one flat list
 * with no record of which line it came from, so there is nothing left here
 * to place back on a specific line. That loss happens at parse time, not
 * here; this writer does not pretend otherwise.
 */

import type { CnvCategory, CnvDefinition, CnvRuleLine } from './cnv-model.js';

export class CnvSerializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CnvSerializeError';
  }
}

const SUBTOTAL_WIDTH = 3;
const SEQUENCE_WIDTH = 4;
const LABEL_WIDTH = 50;

function assertNoSemicolon(value: string, fieldName: string): string {
  if (value.includes(';')) {
    // The parser treats everything after the first `;` on a line as a
    // trailing comment (splitComment in cnv-parser.ts) — a label or code
    // list containing one would silently truncate itself on reparse.
    throw new CnvSerializeError(`${fieldName} "${value}" contains ";", which the format reads as a comment marker`);
  }
  return value;
}

function fitField(value: string, width: number, fieldName: string): string {
  assertNoSemicolon(value, fieldName);
  if (value.length > width) {
    throw new CnvSerializeError(
      `${fieldName} "${value}" is ${value.length} chars, exceeds the fixed field width of ${width}`,
    );
  }
  return value;
}

function subtotalToken(category: CnvCategory): string {
  if (category.excludeFromTotal) return '#';
  if (category.subtotalTarget !== undefined) return String(category.subtotalTarget);
  return '';
}

function codesToken(rule: CnvRuleLine, mode: CnvDefinition['mode'], categorySequence: number): string {
  if (mode === 'numeric-ranges') {
    if (rule.numericUpperInclusive === undefined) {
      throw new CnvSerializeError(`category ${categorySequence}: numeric-ranges rule is missing its upper bound`);
    }
    return String(rule.numericUpperInclusive);
  }
  return [...rule.exactCodes, ...rule.ranges.map((range) => `${range.from}-${range.to}`)].join(',');
}

function headerLine(definition: CnvDefinition): string {
  const modifier = definition.mode === 'numeric-ranges'
    ? ' F'
    : definition.mode === 'literal' && definition.codeLength <= 4
      ? ' L'
      : '';
  return `${definition.categoryCount} ${definition.codeLength}${modifier}`;
}

/**
 * Serializes `definition` to the fixed-column `.CNV` text `cnv-parser.ts`
 * reads. Throws rather than truncating when a field (label, sequence,
 * subtotal) no longer fits its fixed width — silent truncation would save
 * a file that quietly misclassifies codes the next time TabWin reads it.
 */
export function serializeCnv(definition: CnvDefinition): string {
  if (definition.mode === 'new-format') {
    throw new CnvSerializeError('new-format (N) CNV layout is not specified well enough to write; see cnv-parser.ts');
  }

  const categoryBySequence = new Map(definition.categories.map((category) => [category.sequence, category]));
  const lines: string[] = [headerLine(definition)];

  const orderedRules = [...definition.rules].sort((a, b) => a.sourceOrder - b.sourceOrder);
  for (const rule of orderedRules) {
    const category = categoryBySequence.get(rule.categorySequence);
    if (!category) {
      throw new CnvSerializeError(`rule references category ${rule.categorySequence}, which is not in categories`);
    }
    const subtotal = fitField(subtotalToken(category), SUBTOTAL_WIDTH, `category ${category.sequence} subtotal`);
    const sequence = fitField(String(category.sequence), SEQUENCE_WIDTH, `category ${category.sequence} sequence`);
    const label = fitField(category.label, LABEL_WIDTH, `category ${category.sequence} label`);
    const codes = assertNoSemicolon(codesToken(rule, definition.mode, category.sequence), `category ${category.sequence} codes`);
    const built = subtotal.padStart(SUBTOTAL_WIDTH)
      + sequence.padStart(SEQUENCE_WIDTH)
      + '  '
      + label.padEnd(LABEL_WIDTH)
      + ' '
      + codes;
    // The parser's strict mode rejects any body line shorter than 61 chars
    // *before* it pads — a rule with empty codes would otherwise produce a
    // 60-char line that fails to reparse. Floor, never truncate: codes past
    // column 61 always win.
    lines.push(built.length < 61 ? built.padEnd(61) : built);
  }

  return lines.join('\r\n') + '\r\n';
}
