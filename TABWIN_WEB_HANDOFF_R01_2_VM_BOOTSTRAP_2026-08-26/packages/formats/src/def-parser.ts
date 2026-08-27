import type {
  DefDataSource,
  DefDbfLookupOption,
  DefDefinition,
  DefDirective,
  DefExternalLookupOption,
  DefIncrement,
  DefOption,
  DefRole,
  DefUnknownLine,
} from './def-model.js';

export class DefParseError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line ? `DEF line ${line}: ${message}` : message);
    this.name = 'DefParseError';
  }
}

export interface ParseDefOptions {
  /**
   * Strict mode validates documented fields for recognized directives. Unknown
   * directive letters are still retained as comments/unknown lines because the
   * TabWin manual explicitly treats undefined first-position characters as comments.
   */
  strict?: boolean;
}

const OPTION_DIRECTIVES = new Set(['S', 'L', 'C', 'Q', 'D', 'T']);

function rolesForDirective(directive: DefOption['directive']): DefRole[] {
  switch (directive) {
    case 'S':
      return ['selection'];
    case 'L':
      return ['row'];
    case 'C':
      return ['column'];
    case 'Q':
      return ['quad'];
    case 'D':
      return ['row', 'quad'];
    case 'T':
      return ['row', 'column', 'quad'];
  }
}

function splitCommaFields(rest: string): string[] {
  // DEF syntax predates CSV quoting and its documented examples use comma as an
  // unconditional separator. Preserve empty fields rather than filtering them.
  return rest.split(',').map((value) => value.trim());
}

function parseDataSource(rest: string, sourceLine: number, strict: boolean): DefDataSource {
  const fields = splitCommaFields(rest);
  const pattern = fields[0] ?? '';
  if (strict && !pattern) throw new DefParseError('A directive has no data-file pattern', sourceLine);
  if (strict && fields.length > 2) {
    throw new DefParseError('A directive has more than the documented pattern + SQL fields', sourceLine);
  }
  const sqlQuery = fields[1];
  return {
    pattern,
    ...(sqlQuery ? { sqlQuery } : {}),
    sourceLine,
  };
}

function parseOption(
  directive: DefOption['directive'],
  rest: string,
  sourceLine: number,
  strict: boolean,
): DefOption {
  const fields = splitCommaFields(rest);
  if (strict && fields.length !== 4) {
    throw new DefParseError(
      `${directive} directive expects 4 comma-separated fields after the directive; got ${fields.length}`,
      sourceLine,
    );
  }

  const [label = '', field = '', third = '', fourth = ''] = fields;
  if (strict && !label) throw new DefParseError(`${directive} directive has no display label`, sourceLine);
  if (strict && !field) throw new DefParseError(`${directive} directive has no DBF field`, sourceLine);
  if (strict && !third) throw new DefParseError(`${directive} directive has an empty third field`, sourceLine);
  if (strict && !fourth) throw new DefParseError(`${directive} directive has no conversion/lookup file`, sourceLine);

  const roles = rolesForDirective(directive);
  if (/^\d+$/.test(third)) {
    const startPosition = Number(third);
    if (!Number.isInteger(startPosition) || startPosition <= 0) {
      throw new DefParseError('CNV start position must be a positive integer', sourceLine);
    }
    return {
      kind: 'conversion',
      directive,
      label,
      field,
      roles,
      startPosition,
      conversionFile: fourth,
      sourceLine,
    };
  }

  if (/\.dbf$/i.test(fourth)) {
    const option: DefDbfLookupOption = {
      kind: 'dbf-lookup',
      directive,
      label,
      field,
      roles,
      lookupLabelField: third,
      lookupFile: fourth,
      sourceLine,
    };
    return option;
  }

  // Contemporary real-world DEF files also pair a textual third field with a
  // CNV resource (for example DS_TPFIN + TP_FINAN.CNV). That is observably not
  // the documented DBF lookup form. Preserve it as unsupported executable
  // metadata instead of rejecting it or guessing that it is an ordinary CNV.
  const option: DefExternalLookupOption = {
    kind: 'external-lookup',
    directive,
    label,
    field,
    roles,
    lookupLabelField: third,
    resourceFile: fourth,
    sourceLine,
  };
  return option;
}

function parseIncrement(rest: string, sourceLine: number, strict: boolean): DefIncrement {
  const fields = splitCommaFields(rest);
  if (strict && fields.length !== 2) {
    throw new DefParseError(`I directive expects label,field; got ${fields.length} fields`, sourceLine);
  }
  const [label = '', field = ''] = fields;
  if (strict && (!label || !field)) throw new DefParseError('I directive requires label and field', sourceLine);
  return { label, field, sourceLine };
}

export function parseDef(text: string, options: ParseDefOptions = {}): DefDefinition {
  const strict = options.strict ?? true;
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  const dataSources: DefDataSource[] = [];
  const defOptions: DefOption[] = [];
  const increments: DefIncrement[] = [];
  const comments: string[] = [];
  const unknownLines: DefUnknownLine[] = [];
  const warnings: string[] = [];
  let description: string | undefined;
  let groupedCountField: string | undefined;
  let reportFile: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const sourceLine = i + 1;
    if (!raw.trim()) continue;

    const first = raw[0] ?? '';
    if (first === ';') {
      const comment = raw.slice(1).trim();
      if (comment) {
        comments.push(comment);
        if (description === undefined) description = comment;
      }
      continue;
    }

    // Historical docs say blank in position 1 means comment. Do not trim first.
    if (/\s/.test(first)) {
      comments.push(raw.trim());
      continue;
    }

    const directive = first.toUpperCase();
    const rest = raw.slice(1).trim();

    if (directive === 'A') {
      dataSources.push(parseDataSource(rest, sourceLine, strict));
      continue;
    }
    if (OPTION_DIRECTIVES.has(directive)) {
      defOptions.push(
        parseOption(directive as DefOption['directive'], rest, sourceLine, strict),
      );
      continue;
    }
    if (directive === 'I') {
      increments.push(parseIncrement(rest, sourceLine, strict));
      continue;
    }
    if (directive === 'G') {
      if (strict && !rest) throw new DefParseError('G directive has no grouped-frequency field', sourceLine);
      if (groupedCountField !== undefined) {
        warnings.push(
          `multiple G directives found; TabWin documentation says G should occur at most once (line ${sourceLine})`,
        );
      } else {
        groupedCountField = rest;
      }
      continue;
    }
    if (directive === 'R') {
      if (strict && !rest) throw new DefParseError('R directive has no report file', sourceLine);
      if (reportFile !== undefined) warnings.push(`multiple R directives found; keeping first (${reportFile})`);
      else reportFile = rest;
      continue;
    }

    // Current 4.15 CNV documentation references a DEF record type X but the
    // supplied TabWin docs do not define its semantics. Undefined directives are
    // comments by the older manual; retain them explicitly instead of guessing.
    const unknown: DefUnknownLine = { directive, raw, sourceLine };
    unknownLines.push(unknown);
    if (directive === 'X') {
      warnings.push(
        `X directive detected at line ${sourceLine}; TabWin 4.15 CNV docs reference X but its DEF semantics are not yet specified, so it was not activated`,
      );
    }
  }

  if (dataSources.length === 0) warnings.push('no A data-source directive was found');
  if (defOptions.length === 0) warnings.push('no S/L/C/Q/D/T options were found');

  return {
    ...(description !== undefined ? { description } : {}),
    dataSources,
    options: defOptions,
    increments,
    ...(groupedCountField !== undefined ? { groupedCountField } : {}),
    ...(reportFile !== undefined ? { reportFile } : {}),
    comments,
    unknownLines,
    warnings,
  };
}

export function optionsForRole(definition: DefDefinition, role: DefRole): DefOption[] {
  return definition.options.filter((option) => option.roles.includes(role));
}
