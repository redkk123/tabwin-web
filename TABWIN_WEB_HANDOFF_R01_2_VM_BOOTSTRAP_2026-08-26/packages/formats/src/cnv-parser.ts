import type {
  CnvCategory,
  CnvCodeRange,
  CnvDefinition,
  CnvMode,
  CnvRuleLine,
} from './cnv-model.js';

export class CnvParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line ? `CNV line ${line}: ${message}` : message);
    this.name = 'CnvParseError';
  }
}

export interface ParseCnvOptions {
  /**
   * Compatibility work should be strict. Lenient mode is reserved for a future
   * import-assistant that can repair community-authored files interactively.
   */
  strict?: boolean;
}

interface ParsedHeader {
  categoryCount: number;
  codeLength: number;
  mode: CnvMode;
}

function splitComment(line: string): { body: string; comment?: string } {
  const index = line.indexOf(';');
  if (index < 0) return { body: line };
  return {
    body: line.slice(0, index),
    comment: line.slice(index + 1).trim(),
  };
}

function parseHeader(body: string, lineNumber: number): ParsedHeader | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  // TabWin 3.7a+: N in the first position announces the wider CNV layout.
  const isNew = /^N/i.test(body);
  const withoutNewMarker = isNew ? body.slice(1) : body;
  const match = withoutNewMarker.trim().match(/^(\d+)\s+(\d+)(?:\s+(\S+))?$/i);
  if (!match) return null;

  const categoryCount = Number(match[1]);
  const codeLength = Number(match[2]);
  const modifier = match[3]?.toUpperCase();

  if (!Number.isInteger(categoryCount) || categoryCount <= 0) {
    throw new CnvParseError('category count must be a positive integer', lineNumber);
  }
  if (!Number.isInteger(codeLength) || codeLength <= 0) {
    throw new CnvParseError('code length must be a positive integer', lineNumber);
  }

  let mode: CnvMode;
  if (isNew) mode = 'new-format';
  else if (modifier === 'L') mode = 'literal';
  else if (modifier === 'F' || modifier === 'FAIXAS') mode = 'numeric-ranges';
  else mode = codeLength > 4 ? 'literal' : 'short';

  return { categoryCount, codeLength, mode };
}

function parseRuleLine(
  body: string,
  sourceLine: number,
  mode: CnvMode,
  sourceOrder: number,
): { category: CnvCategory; rule: CnvRuleLine } {
  // Legacy columns (1-based): subtotal 1-3, sequence 4-7,
  // description 10-59, codes 61+. The N layout widens sequence, description
  // and codes: sequence 6-9, description 12-111, codes 113+. All 41,897 body
  // rows across the 89 official N files in TAB_SIH satisfy these offsets.
  //
  // The subtotal indicator stays **4 columns wide** in N (1-4), proven by a
  // controlled experiment against the real engine rather than inferred. The
  // real NATJUR.CNV writes its indicators right-aligned in what looks like a
  // 5-wide field ("   56"), so TabWin reads only "   5" and resolves the
  // parent to sequence 5, not 56 — which is exactly why the real G012 export
  // shows a derived "104-0" row (sequence 5) carrying 399-9's 524 records,
  // even though no record in RDAC2401.dbc has code 1040 at all.
  //
  // The experiment: three byte-identical copies of NATJUR.CNV differing only
  // in that one indicator, each predicting a different visible row under the
  // 3-, 4- and 5-column readings. Writing "  105" moved the derived 524 to
  // "110-4 Autarquia Federal" (sequence 10 = "  10"), which only the 4-column
  // reading predicts; the 104-0 row disappeared and the total stayed 4,315.
  // Evidence in docs/handoffs/R10_6_G012_SUBTOTAL_WIDTH_RESOLVED.md.
  const isNew = mode === 'new-format';
  const subtotalRaw = body.slice(0, isNew ? 4 : 3).trim();
  const sequenceRaw = body.slice(isNew ? 5 : 3, isNew ? 9 : 7).trim();
  const label = body.slice(isNew ? 11 : 9, isNew ? 111 : 59).trim();
  const codesRaw = body.slice(isNew ? 112 : 60).trim();

  if (!/^\d+$/.test(sequenceRaw)) {
    throw new CnvParseError(
      'expected numeric category sequence in fixed columns 4-7',
      sourceLine,
    );
  }
  const sequence = Number(sequenceRaw);
  if (sequence <= 0) {
    throw new CnvParseError('category sequence must be positive', sourceLine);
  }

  let subtotalTarget: number | undefined;
  let excludeFromTotal = false;
  if (subtotalRaw) {
    if (subtotalRaw === '#') excludeFromTotal = true;
    // "0" is what a truncated N indicator degrades to (e.g. "   01" read as
    // "   0"). Sequence 0 never exists, so treat it as "no parent" rather
    // than as a dangling pointer warning on every such row.
    else if (/^\d+$/.test(subtotalRaw)) {
      const target = Number(subtotalRaw);
      if (target > 0) subtotalTarget = target;
    } else throw new CnvParseError('invalid subtotal field', sourceLine);
  }

  const category: CnvCategory = {
    sequence,
    label,
    ...(subtotalTarget !== undefined ? { subtotalTarget } : {}),
    ...(excludeFromTotal ? { excludeFromTotal: true } : {}),
  };

  const exactCodes: string[] = [];
  const ranges: CnvCodeRange[] = [];
  let numericUpperInclusive: number | undefined;

  if (mode === 'numeric-ranges') {
    if (!codesRaw) throw new CnvParseError('numeric range row has no upper bound', sourceLine);
    const value = Number(codesRaw);
    if (!Number.isFinite(value)) {
      throw new CnvParseError(`invalid numeric upper bound: ${codesRaw}`, sourceLine);
    }
    numericUpperInclusive = value;
  } else if (codesRaw) {
    for (const rawToken of codesRaw.split(',')) {
      const token = rawToken.trim();
      if (!token) continue;
      const hyphen = token.indexOf('-');
      if (hyphen > 0 && hyphen < token.length - 1) {
        ranges.push({ from: token.slice(0, hyphen).trim(), to: token.slice(hyphen + 1).trim() });
      } else {
        exactCodes.push(token);
      }
    }
  }

  const rule: CnvRuleLine = {
    categorySequence: sequence,
    exactCodes,
    ranges,
    ...(numericUpperInclusive !== undefined ? { numericUpperInclusive } : {}),
    sourceOrder,
    sourceLine,
  };

  return { category, rule };
}

export function parseCnv(text: string, options: ParseCnvOptions = {}): CnvDefinition {
  const strict = options.strict ?? true;
  // Real official CNVs are MS-DOS text files and many close with the DOS
  // end-of-file marker (0x1A, Ctrl-Z) on its own line. It terminates the
  // content; it is not a rule row. Without this, strict mode rejected 53 of
  // the 865 CNVs in the official SIH auxiliary bundle - including core
  // geography tables like UF.CNV, REGIAO.CNV and CAPITAL.CNV - with
  // "legacy fixed-column row is 1 chars". Same optional-terminator policy
  // the DBF reader already applies (see dbf-record-stream.ts).
  const withoutDosEof = text.split('\u001A')[0]!;
  const normalized = withoutDosEof.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const comments: string[] = [];
  const warnings: string[] = [];

  let header: ParsedHeader | undefined;
  let headerLine = 0;
  let bodyStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const { body, comment } = splitComment(raw);
    if (comment) comments.push(comment);
    if (!body.trim()) continue;
    const candidate = parseHeader(body, i + 1);
    if (!candidate) {
      throw new CnvParseError('first non-comment content must be a CNV header', i + 1);
    }
    header = candidate;
    headerLine = i + 1;
    bodyStartIndex = i + 1;
    break;
  }

  if (!header) throw new CnvParseError('missing CNV header');

  const categories = new Map<number, CnvCategory>();
  const rules: CnvRuleLine[] = [];
  let sourceOrder = 0;

  for (let i = bodyStartIndex; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const { body, comment } = splitComment(raw);
    if (comment) comments.push(comment);
    if (!body.trim()) continue;

    // Fixed-column CNV rows need enough width to reach the code field. A short
    // line may still be valid if it contains no codes, but that is not useful as
    // a conversion rule, so strict compatibility mode rejects it.
    const minimumLength = header.mode === 'new-format' ? 113 : 61;
    if (strict && body.length < minimumLength) {
      throw new CnvParseError(
        `${header.mode === 'new-format' ? 'new-format' : 'legacy fixed-column'} row is ${body.length} chars; expected at least ${minimumLength}`,
        i + 1,
      );
    }

    const parsed = parseRuleLine(body.padEnd(minimumLength), i + 1, header.mode, sourceOrder++);
    const existing = categories.get(parsed.category.sequence);
    if (!existing) {
      categories.set(parsed.category.sequence, parsed.category);
    } else {
      if (!existing.label && parsed.category.label) existing.label = parsed.category.label;
      if (
        existing.subtotalTarget !== undefined &&
        parsed.category.subtotalTarget !== undefined &&
        existing.subtotalTarget !== parsed.category.subtotalTarget
      ) {
        warnings.push(
          `category ${existing.sequence} has conflicting subtotal targets (${existing.subtotalTarget} vs ${parsed.category.subtotalTarget})`,
        );
      } else if (existing.subtotalTarget === undefined && parsed.category.subtotalTarget !== undefined) {
        existing.subtotalTarget = parsed.category.subtotalTarget;
      }
      if (parsed.category.excludeFromTotal) existing.excludeFromTotal = true;
    }
    rules.push(parsed.rule);
  }

  const categoryList = [...categories.values()].sort((a, b) => a.sequence - b.sequence);
  if (categoryList.length !== header.categoryCount) {
    warnings.push(
      `header declares ${header.categoryCount} categories but ${categoryList.length} unique category sequences were parsed`,
    );
  }

  const sequenceSet = new Set(categoryList.map((category) => category.sequence));
  for (const category of categoryList) {
    if (category.subtotalTarget !== undefined && !sequenceSet.has(category.subtotalTarget)) {
      warnings.push(
        `category ${category.sequence} points to missing subtotal target ${category.subtotalTarget}`,
      );
    }
  }

  if (header.mode === 'numeric-ranges') {
    let previous = Number.NEGATIVE_INFINITY;
    for (const rule of rules) {
      const upper = rule.numericUpperInclusive;
      if (upper === undefined) continue;
      if (upper < previous) {
        warnings.push('numeric-range upper bounds are not monotonic in source order');
        break;
      }
      previous = upper;
    }
  }
  if (header.mode === 'new-format') {
    warnings.push(
      'new-format N layout: fixed columns and the 4-wide subtotal indicator are proven by G012; writing this layout back out is still refused',
    );
  }

  return {
    categoryCount: header.categoryCount,
    codeLength: header.codeLength,
    mode: header.mode,
    // Documented short-code example says a later row overrides an earlier broad
    // range. The supplied documentation separately notes first-index behavior for
    // long/literal codes. We preserve that distinction explicitly.
    precedence: header.mode === 'literal' ? 'first-match-wins' : 'last-match-wins',
    categories: categoryList,
    rules,
    comments,
    warnings,
    headerLine,
  };
}
