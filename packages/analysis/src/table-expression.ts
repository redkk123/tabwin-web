/**
 * The derived-column expression language: arithmetic over the current
 * result's columns, plus a closed registry of named functions with
 * Excel-familiar syntax.
 *
 * "Excel-familiar", never "Excel". There is no cell grid, so there are no
 * `A1:B35` ranges, no `VLOOKUP`, and no macros; a formula addresses columns
 * by semantic name (`[Óbitos]`) or key (`C01`), which is the thing this
 * project actually has. `COUNTIF` is deliberately absent for the same
 * reason: its whole contract is a range plus a criteria string, and faking
 * that over a single row would give the name a meaning Excel users would
 * reasonably misread.
 *
 * Nothing here evaluates user text as code. Every callable name must be in
 * {@link FUNCTIONS}; anything else is rejected by name at parse time.
 */

import type { TabulationResult } from '../../core/src/model.js';
import { descriptiveStatistics } from './statistics.js';

type BinaryOperator = '+' | '-' | '*' | '/' | '^';
type ComparisonOperator = '<' | '>' | '<=' | '>=' | '=' | '<>';

type ExpressionNode =
  | { kind: 'number'; value: number }
  | { kind: 'column'; index: number }
  | { kind: 'unary'; operator: '+' | '-'; operand: ExpressionNode }
  | { kind: 'binary'; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'comparison'; operator: ComparisonOperator; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'call'; name: FunctionName; args: ExpressionNode[] };

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'reference'; value: string }
  | { kind: 'function'; value: string }
  | { kind: 'operator'; value: BinaryOperator }
  | { kind: 'comparison'; value: ComparisonOperator }
  | { kind: 'comma' }
  | { kind: 'left' | 'right' | 'end' };

/** Evaluation context: the current row plus everything a column-wide function needs. */
export interface TableExpressionContext {
  /** Cells of the row being computed. */
  cells: readonly number[];
  rowIndex: number;
  /** Every row's cells, in result order - required by LAG and ZSCORE, unused by the rest. */
  allCells: readonly (readonly number[])[];
  divisionByZero: 'error' | 'zero';
}

interface FunctionDefinition {
  minArgs: number;
  /** `undefined` means variadic with no upper bound. */
  maxArgs: number | undefined;
  /**
   * Argument positions that must be written as a bare column reference
   * rather than an arbitrary sub-expression, because the function reads
   * that column across every row, not just this one.
   */
  columnArgs?: readonly number[];
  evaluate: (args: readonly ExpressionNode[], context: TableExpressionContext) => number;
}

function divide(left: number, right: number, context: TableExpressionContext): number {
  if (right !== 0) return left / right;
  if (context.divisionByZero === 'zero') return 0;
  throw new Error(`division by zero at result row ${context.rowIndex + 1}`);
}

/**
 * Scales by a power of ten through the decimal exponent rather than by
 * multiplying. `2.345 * 100` is 234.49999999999997 in binary floating point,
 * so a naive ROUND(2,345; 2) answers 2,34 where Excel answers 2,35. Shifting
 * the exponent of the shortest round-trip decimal form keeps the digits the
 * author actually typed.
 */
function shiftDecimalExponent(value: number, digits: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const [mantissa, exponent] = value.toExponential().split('e');
  return Number(`${mantissa}e${Number(exponent) + digits}`);
}

function roundWith(value: number, digits: number, round: (scaled: number) => number): number {
  if (!Number.isFinite(value)) return value;
  // Round the magnitude, then restore the sign, so every rule below is
  // stated relative to zero the way Excel states it.
  const rounded = round(shiftDecimalExponent(Math.abs(value), digits));
  return Math.sign(value) * shiftDecimalExponent(rounded, -digits);
}

/** Excel rounds half away from zero; JavaScript's Math.round rounds half toward +Infinity. */
function roundHalfAwayFromZero(value: number, digits: number): number {
  return roundWith(value, digits, Math.round);
}

function roundAwayFromZero(value: number, digits: number): number {
  return roundWith(value, digits, Math.ceil);
}

function roundTowardZero(value: number, digits: number): number {
  return roundWith(value, digits, Math.floor);
}

function requireColumnIndex(node: ExpressionNode | undefined, name: string): number {
  // Guaranteed by the parse-time columnArgs check; this is the runtime echo.
  if (!node || node.kind !== 'column') throw new Error(`${name} requires a column reference`);
  return node.index;
}

function columnValues(index: number, context: TableExpressionContext): number[] {
  return context.allCells.map((row) => row[index] ?? 0);
}

const TRUE = 1;
const FALSE = 0;

function truthy(value: number): boolean {
  return value !== 0;
}

/**
 * The complete set of callable names. A name absent from here is a parse
 * error, which is what keeps arbitrary text from ever being executed.
 */
const FUNCTIONS = {
  // --- Aggregation over the arguments written in this row's formula ---
  SUM: {
    minArgs: 1, maxArgs: undefined,
    evaluate: (args, context) => args.reduce((total, arg) => total + evaluate(arg, context), 0),
  },
  AVERAGE: {
    minArgs: 1, maxArgs: undefined,
    evaluate: (args, context) => args.reduce((total, arg) => total + evaluate(arg, context), 0) / args.length,
  },
  MIN: {
    minArgs: 1, maxArgs: undefined,
    evaluate: (args, context) => Math.min(...args.map((arg) => evaluate(arg, context))),
  },
  MAX: {
    minArgs: 1, maxArgs: undefined,
    evaluate: (args, context) => Math.max(...args.map((arg) => evaluate(arg, context))),
  },
  MEDIAN: {
    minArgs: 1, maxArgs: undefined,
    evaluate: (args, context) => {
      const values = args.map((arg) => evaluate(arg, context)).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle]! : ((values[middle - 1]! + values[middle]!) / 2);
    },
  },
  COUNT: {
    minArgs: 1, maxArgs: undefined,
    evaluate: (args, context) => args.filter((arg) => Number.isFinite(evaluate(arg, context))).length,
  },

  // --- Arithmetic ---
  ABS: { minArgs: 1, maxArgs: 1, evaluate: (args, context) => Math.abs(evaluate(args[0]!, context)) },
  SQRT: {
    minArgs: 1, maxArgs: 1,
    evaluate: (args, context) => {
      const value = evaluate(args[0]!, context);
      if (value < 0) throw new Error(`SQRT of a negative value at result row ${context.rowIndex + 1}`);
      return Math.sqrt(value);
    },
  },
  POWER: { minArgs: 2, maxArgs: 2, evaluate: (args, context) => evaluate(args[0]!, context) ** evaluate(args[1]!, context) },
  EXP: { minArgs: 1, maxArgs: 1, evaluate: (args, context) => Math.exp(evaluate(args[0]!, context)) },
  LN: {
    minArgs: 1, maxArgs: 1,
    evaluate: (args, context) => {
      const value = evaluate(args[0]!, context);
      if (value <= 0) throw new Error(`LN requires a positive value at result row ${context.rowIndex + 1}`);
      return Math.log(value);
    },
  },
  // Excel's LOG defaults to base 10, not base e - LN is the natural one.
  LOG: {
    minArgs: 1, maxArgs: 2,
    evaluate: (args, context) => {
      const value = evaluate(args[0]!, context);
      const base = args[1] ? evaluate(args[1], context) : 10;
      if (value <= 0) throw new Error(`LOG requires a positive value at result row ${context.rowIndex + 1}`);
      if (base <= 0 || base === 1) throw new Error(`LOG base must be positive and different from 1 at result row ${context.rowIndex + 1}`);
      return Math.log(value) / Math.log(base);
    },
  },
  LOG10: {
    minArgs: 1, maxArgs: 1,
    evaluate: (args, context) => {
      const value = evaluate(args[0]!, context);
      if (value <= 0) throw new Error(`LOG10 requires a positive value at result row ${context.rowIndex + 1}`);
      return Math.log10(value);
    },
  },

  // --- Rounding. Excel's four differ from each other in how they treat
  // negatives, so each is implemented to its own rule rather than aliased. ---
  ROUND: {
    minArgs: 1, maxArgs: 2,
    evaluate: (args, context) => roundHalfAwayFromZero(evaluate(args[0]!, context), args[1] ? evaluate(args[1], context) : 0),
  },
  ROUNDUP: {
    minArgs: 1, maxArgs: 2,
    evaluate: (args, context) => roundAwayFromZero(evaluate(args[0]!, context), args[1] ? evaluate(args[1], context) : 0),
  },
  ROUNDDOWN: {
    minArgs: 1, maxArgs: 2,
    evaluate: (args, context) => roundTowardZero(evaluate(args[0]!, context), args[1] ? evaluate(args[1], context) : 0),
  },
  /** Truncates toward zero: TRUNC(-2,7) is -2. */
  TRUNC: {
    minArgs: 1, maxArgs: 2,
    evaluate: (args, context) => roundTowardZero(evaluate(args[0]!, context), args[1] ? evaluate(args[1], context) : 0),
  },
  /** Rounds toward negative infinity: INT(-2,7) is -3, unlike TRUNC. */
  INT: { minArgs: 1, maxArgs: 1, evaluate: (args, context) => Math.floor(evaluate(args[0]!, context)) },

  // --- Logic. Booleans travel as 1/0, as they do in Excel. ---
  IF: {
    minArgs: 3, maxArgs: 3,
    evaluate: (args, context) => (truthy(evaluate(args[0]!, context))
      ? evaluate(args[1]!, context)
      : evaluate(args[2]!, context)),
  },
  /** IFS(cond1, value1, cond2, value2, ...) - the first true condition wins. */
  IFS: {
    minArgs: 4, maxArgs: undefined,
    evaluate: (args, context) => {
      for (let index = 0; index + 1 < args.length; index += 2) {
        if (truthy(evaluate(args[index]!, context))) return evaluate(args[index + 1]!, context);
      }
      throw new Error(`IFS matched no condition at result row ${context.rowIndex + 1}`);
    },
  },
  AND: {
    minArgs: 2, maxArgs: undefined,
    evaluate: (args, context) => (args.every((arg) => truthy(evaluate(arg, context))) ? TRUE : FALSE),
  },
  OR: {
    minArgs: 2, maxArgs: undefined,
    evaluate: (args, context) => (args.some((arg) => truthy(evaluate(arg, context))) ? TRUE : FALSE),
  },
  NOT: { minArgs: 1, maxArgs: 1, evaluate: (args, context) => (truthy(evaluate(args[0]!, context)) ? FALSE : TRUE) },
  /**
   * The one place an evaluation error is swallowed - and only because the
   * author asked for it in writing, which is exactly the "default pode
   * existir; default invisível não" rule. A bare division by zero still
   * fails loudly; IFERROR(x, 0) is a visible, deliberate choice.
   */
  IFERROR: {
    minArgs: 2, maxArgs: 2,
    evaluate: (args, context) => {
      try {
        const value = evaluate(args[0]!, context);
        return Number.isFinite(value) ? value : evaluate(args[1]!, context);
      } catch {
        return evaluate(args[1]!, context);
      }
    },
  },
  ISNUMBER: {
    minArgs: 1, maxArgs: 1,
    evaluate: (args, context) => {
      try {
        return Number.isFinite(evaluate(args[0]!, context)) ? TRUE : FALSE;
      } catch {
        return FALSE;
      }
    },
  },

  // --- Epidemiology. These are the reason this registry exists at all:
  // they name what the analyst is actually computing, instead of leaving
  // the intent buried in an anonymous division. ---
  /** RATE(events, population, per) - incidence/mortality per `per` inhabitants. */
  RATE: {
    minArgs: 2, maxArgs: 3,
    evaluate: (args, context) => {
      const events = evaluate(args[0]!, context);
      const population = evaluate(args[1]!, context);
      const per = args[2] ? evaluate(args[2], context) : 100_000;
      return divide(events, population, context) * per;
    },
  },
  PERCENT: {
    minArgs: 2, maxArgs: 2,
    evaluate: (args, context) => divide(evaluate(args[0]!, context), evaluate(args[1]!, context), context) * 100,
  },
  RATIO: {
    minArgs: 2, maxArgs: 2,
    evaluate: (args, context) => divide(evaluate(args[0]!, context), evaluate(args[1]!, context), context),
  },
  CHANGE: {
    minArgs: 2, maxArgs: 2,
    evaluate: (args, context) => evaluate(args[0]!, context) - evaluate(args[1]!, context),
  },
  PCTCHANGE: {
    minArgs: 2, maxArgs: 2,
    evaluate: (args, context) => {
      const current = evaluate(args[0]!, context);
      const previous = evaluate(args[1]!, context);
      return divide(current - previous, previous, context) * 100;
    },
  },
  /**
   * LAG(column, n) - the value `n` rows earlier in the result's own order.
   * Row 1 has no predecessor, and inventing a zero there would fabricate a
   * data point, so it fails; wrap in IFERROR to state what the first row
   * should show instead.
   */
  LAG: {
    minArgs: 1, maxArgs: 2, columnArgs: [0],
    evaluate: (args, context) => {
      const index = requireColumnIndex(args[0], 'LAG');
      const offset = args[1] ? evaluate(args[1], context) : 1;
      if (!Number.isInteger(offset) || offset < 1) throw new Error('LAG offset must be a positive whole number');
      const target = context.rowIndex - offset;
      if (target < 0) throw new Error(`LAG has no row ${offset} position(s) before result row ${context.rowIndex + 1}`);
      return context.allCells[target]?.[index] ?? 0;
    },
  },
  /**
   * ZSCORE(column) - standardized against that column across every row of
   * the current result, using the same sample standard deviation the
   * Estatística panel reports, so the two never disagree.
   */
  ZSCORE: {
    minArgs: 1, maxArgs: 1, columnArgs: [0],
    evaluate: (args, context) => {
      const index = requireColumnIndex(args[0], 'ZSCORE');
      const stats = descriptiveStatistics(columnValues(index, context));
      if (stats.sampleStandardDeviation === 0) {
        throw new Error('ZSCORE needs a column that varies; every row holds the same value');
      }
      return ((context.cells[index] ?? 0) - stats.mean) / stats.sampleStandardDeviation;
    },
  },
} as const satisfies Record<string, FunctionDefinition>;

type FunctionName = keyof typeof FUNCTIONS;

/**
 * Portuguese names for the functions whose pt-BR Excel spelling is
 * unambiguous and dot-free. The English names above stay canonical - these
 * only spare a pt-BR Excel user from translating their own habits.
 */
const ALIASES: Readonly<Record<string, FunctionName>> = {
  SOMA: 'SUM',
  MEDIA: 'AVERAGE', MÉDIA: 'AVERAGE',
  MINIMO: 'MIN', MÍNIMO: 'MIN',
  MAXIMO: 'MAX', MÁXIMO: 'MAX',
  MEDIANA: 'MEDIAN',
  CONT: 'COUNT',
  RAIZ: 'SQRT',
  POTENCIA: 'POWER', POTÊNCIA: 'POWER',
  ARRED: 'ROUND',
  TRUNCAR: 'TRUNC',
  SE: 'IF',
  E: 'AND',
  OU: 'OR',
  NAO: 'NOT', NÃO: 'NOT',
  TAXA: 'RATE',
  PERCENTUAL: 'PERCENT',
  RAZAO: 'RATIO', RAZÃO: 'RATIO',
  VARIACAO: 'PCTCHANGE', VARIAÇÃO: 'PCTCHANGE',
};

/** Every name a formula may call, for UI autocomplete and documentation. */
export function tableExpressionFunctionNames(): string[] {
  return [...Object.keys(FUNCTIONS), ...Object.keys(ALIASES)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export type TableExpressionFunctionGroup = 'agregação' | 'aritmética' | 'arredondamento' | 'lógica' | 'epidemiologia';

export interface TableExpressionFunctionEntry {
  name: string;
  group: TableExpressionFunctionGroup;
  signature: string;
  summary: string;
  /** Portuguese spellings accepted for this same function, if any. */
  aliases: string[];
}

/**
 * Human-facing documentation for the registry. Typed as a total record over
 * {@link FunctionName}, so adding a function without documenting it fails to
 * compile - the UI can never advertise a stale list, nor omit a real one.
 */
const CATALOG: Record<FunctionName, Omit<TableExpressionFunctionEntry, 'name' | 'aliases'>> = {
  SUM: { group: 'agregação', signature: 'SUM(a; b; …)', summary: 'Soma os argumentos.' },
  AVERAGE: { group: 'agregação', signature: 'AVERAGE(a; b; …)', summary: 'Média aritmética dos argumentos.' },
  MIN: { group: 'agregação', signature: 'MIN(a; b; …)', summary: 'Menor dos argumentos.' },
  MAX: { group: 'agregação', signature: 'MAX(a; b; …)', summary: 'Maior dos argumentos.' },
  MEDIAN: { group: 'agregação', signature: 'MEDIAN(a; b; …)', summary: 'Mediana dos argumentos.' },
  COUNT: { group: 'agregação', signature: 'COUNT(a; b; …)', summary: 'Quantos argumentos resultaram em número finito.' },
  ABS: { group: 'aritmética', signature: 'ABS(x)', summary: 'Valor absoluto.' },
  SQRT: { group: 'aritmética', signature: 'SQRT(x)', summary: 'Raiz quadrada; recusa valor negativo.' },
  POWER: { group: 'aritmética', signature: 'POWER(x; y)', summary: 'x elevado a y.' },
  EXP: { group: 'aritmética', signature: 'EXP(x)', summary: 'e elevado a x.' },
  LN: { group: 'aritmética', signature: 'LN(x)', summary: 'Logaritmo natural; exige valor positivo.' },
  LOG: { group: 'aritmética', signature: 'LOG(x; base)', summary: 'Logaritmo; base 10 por padrão, como no Excel.' },
  LOG10: { group: 'aritmética', signature: 'LOG10(x)', summary: 'Logaritmo de base 10.' },
  ROUND: { group: 'arredondamento', signature: 'ROUND(x; casas)', summary: 'Arredonda; a metade vai para longe do zero.' },
  ROUNDUP: { group: 'arredondamento', signature: 'ROUNDUP(x; casas)', summary: 'Arredonda para longe do zero.' },
  ROUNDDOWN: { group: 'arredondamento', signature: 'ROUNDDOWN(x; casas)', summary: 'Arredonda em direção ao zero.' },
  TRUNC: { group: 'arredondamento', signature: 'TRUNC(x; casas)', summary: 'Trunca em direção ao zero: TRUNC(−2,7) = −2.' },
  INT: { group: 'arredondamento', signature: 'INT(x)', summary: 'Arredonda para baixo: INT(−2,7) = −3.' },
  IF: { group: 'lógica', signature: 'IF(condição; então; senão)', summary: 'Escolhe entre dois valores.' },
  IFS: { group: 'lógica', signature: 'IFS(cond1; valor1; cond2; valor2; …)', summary: 'A primeira condição verdadeira vence.' },
  AND: { group: 'lógica', signature: 'AND(a; b; …)', summary: 'Verdadeiro (1) se todas forem verdadeiras.' },
  OR: { group: 'lógica', signature: 'OR(a; b; …)', summary: 'Verdadeiro (1) se alguma for verdadeira.' },
  NOT: { group: 'lógica', signature: 'NOT(x)', summary: 'Inverte verdadeiro/falso.' },
  IFERROR: { group: 'lógica', signature: 'IFERROR(valor; alternativa)', summary: 'Usa a alternativa quando o cálculo falha — decisão explícita, nunca automática.' },
  ISNUMBER: { group: 'lógica', signature: 'ISNUMBER(x)', summary: 'Verdadeiro (1) se x resulta em número finito.' },
  RATE: { group: 'epidemiologia', signature: 'RATE(eventos; população; por)', summary: 'Taxa por “por” habitantes; 100.000 por padrão.' },
  PERCENT: { group: 'epidemiologia', signature: 'PERCENT(parte; total)', summary: 'Percentual da parte sobre o total.' },
  RATIO: { group: 'epidemiologia', signature: 'RATIO(a; b)', summary: 'Razão a ÷ b.' },
  CHANGE: { group: 'epidemiologia', signature: 'CHANGE(atual; anterior)', summary: 'Diferença absoluta entre dois valores.' },
  PCTCHANGE: { group: 'epidemiologia', signature: 'PCTCHANGE(atual; anterior)', summary: 'Variação percentual entre dois valores.' },
  LAG: { group: 'epidemiologia', signature: 'LAG([coluna]; n)', summary: 'Valor n linhas acima; a primeira linha falha em vez de inventar zero.' },
  ZSCORE: { group: 'epidemiologia', signature: 'ZSCORE([coluna])', summary: 'Padroniza a coluna inteira pela média e desvio-padrão amostral.' },
};

/** The documented registry, grouped and alias-annotated, for the formula help panel. */
export function tableExpressionFunctionCatalog(): TableExpressionFunctionEntry[] {
  const aliasesByTarget = new Map<FunctionName, string[]>();
  for (const [alias, target] of Object.entries(ALIASES)) {
    aliasesByTarget.set(target, [...(aliasesByTarget.get(target) ?? []), alias]);
  }
  return (Object.keys(CATALOG) as FunctionName[]).map((name) => ({
    name,
    ...CATALOG[name],
    aliases: aliasesByTarget.get(name) ?? [],
  }));
}

function resolveFunctionName(raw: string): FunctionName {
  const normalized = raw.trim().toLocaleUpperCase('pt-BR');
  if (normalized in FUNCTIONS) return normalized as FunctionName;
  const alias = ALIASES[normalized];
  if (alias) return alias;
  throw new Error(`unknown function ${raw}`);
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { offset += whitespace[0].length; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      offset += number[0].length;
      continue;
    }
    const char = expression[offset]!;
    if (char === '[') {
      const close = expression.indexOf(']', offset + 1);
      if (close < 0) throw new Error(`unclosed column reference at expression offset ${offset}`);
      const value = expression.slice(offset + 1, close).trim();
      if (!value) throw new Error(`empty column reference at expression offset ${offset}`);
      tokens.push({ kind: 'reference', value });
      offset = close + 1;
      continue;
    }
    // Two-character comparisons first, so "<=" never reads as "<" then "=".
    const twoChar = rest.slice(0, 2);
    if (twoChar === '<=' || twoChar === '>=' || twoChar === '<>') {
      tokens.push({ kind: 'comparison', value: twoChar });
      offset += 2;
      continue;
    }
    if (char === '<' || char === '>' || char === '=') {
      tokens.push({ kind: 'comparison', value: char });
      offset++;
      continue;
    }
    if ('+-*/^'.includes(char)) {
      tokens.push({ kind: 'operator', value: char as BinaryOperator });
      offset++;
      continue;
    }
    if (char === ',' || char === ';') {
      // Semicolon too: pt-BR Excel separates arguments with it.
      tokens.push({ kind: 'comma' });
      offset++;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: char === '(' ? 'left' : 'right' });
      offset++;
      continue;
    }
    const identifier = /^[^\s+\-*/^()[\],;<>=]+/.exec(rest);
    if (identifier) {
      offset += identifier[0].length;
      // A bare name immediately followed by "(" is a call, not a column.
      const isCall = /^\s*\(/.test(expression.slice(offset));
      tokens.push(isCall ? { kind: 'function', value: identifier[0] } : { kind: 'reference', value: identifier[0] });
      continue;
    }
    throw new Error(`unsupported expression token at offset ${offset}`);
  }
  tokens.push({ kind: 'end' });
  return tokens;
}

function resolveColumn(result: TabulationResult, reference: string): number {
  const numbered = /^C0*(\d+)$/i.exec(reference);
  if (numbered) {
    const index = Number(numbered[1]) - 1;
    if (index < 0 || index >= result.columns.length) throw new Error(`expression references missing column ${reference}`);
    return index;
  }
  const normalized = reference.trim().toLocaleLowerCase('pt-BR');
  const matches = result.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column.key.toLocaleLowerCase('pt-BR') === normalized
      || column.label.trim().toLocaleLowerCase('pt-BR') === normalized);
  if (!matches.length) throw new Error(`expression references missing column ${reference}`);
  if (matches.length > 1) throw new Error(`expression column reference is ambiguous: ${reference}`);
  return matches[0]!.index;
}

export function parseTableExpression(result: TabulationResult, expression: string): ExpressionNode {
  // An Excel user reflexively starts a formula with "=".
  const source = expression.trim().replace(/^=/, '');
  if (!source.trim()) throw new Error('table expression cannot be empty');
  const tokens = tokenize(source);
  let position = 0;
  const current = (): Token => tokens[position] ?? { kind: 'end' };
  const consume = (): Token => tokens[position++] ?? { kind: 'end' };

  const call = (rawName: string): ExpressionNode => {
    const name = resolveFunctionName(rawName);
    const definition: FunctionDefinition = FUNCTIONS[name];
    if (consume().kind !== 'left') throw new Error(`${rawName} is missing its opening parenthesis`);
    const args: ExpressionNode[] = [];
    if (current().kind === 'right') {
      consume();
    } else {
      for (;;) {
        args.push(comparison());
        const next = consume();
        if (next.kind === 'right') break;
        if (next.kind !== 'comma') throw new Error(`${rawName} is missing a comma or closing parenthesis`);
      }
    }
    if (args.length < definition.minArgs || (definition.maxArgs !== undefined && args.length > definition.maxArgs)) {
      const expected = definition.maxArgs === undefined
        ? `at least ${definition.minArgs}`
        : definition.minArgs === definition.maxArgs
          ? `exactly ${definition.minArgs}`
          : `between ${definition.minArgs} and ${definition.maxArgs}`;
      throw new Error(`${name} expects ${expected} argument(s), received ${args.length}`);
    }
    if (name === 'IFS' && args.length % 2 !== 0) {
      throw new Error('IFS expects condition/value pairs, so its argument count must be even');
    }
    for (const index of definition.columnArgs ?? []) {
      if (args[index]?.kind !== 'column') {
        throw new Error(`${name} argument ${index + 1} must be a column reference, because it reads that column across every row`);
      }
    }
    return { kind: 'call', name, args };
  };

  const primary = (): ExpressionNode => {
    const token = consume();
    if (token.kind === 'number') return { kind: 'number', value: token.value };
    if (token.kind === 'function') return call(token.value);
    if (token.kind === 'reference') return { kind: 'column', index: resolveColumn(result, token.value) };
    if (token.kind === 'left') {
      const node = comparison();
      if (consume().kind !== 'right') throw new Error('table expression is missing a closing parenthesis');
      return node;
    }
    throw new Error('table expression expected a number, column, function or parenthesis');
  };
  const power = (): ExpressionNode => {
    const left = primary();
    const token = current();
    if (token.kind === 'operator' && token.value === '^') {
      consume();
      return { kind: 'binary', operator: '^', left, right: unary() };
    }
    return left;
  };
  const unary = (): ExpressionNode => {
    const token = current();
    if (token.kind === 'operator' && (token.value === '+' || token.value === '-')) {
      consume();
      return { kind: 'unary', operator: token.value, operand: unary() };
    }
    return power();
  };
  const multiplication = (): ExpressionNode => {
    let node = unary();
    for (;;) {
      const token = current();
      if (token.kind !== 'operator' || (token.value !== '*' && token.value !== '/')) break;
      consume();
      node = { kind: 'binary', operator: token.value, left: node, right: unary() };
    }
    return node;
  };
  const addition = (): ExpressionNode => {
    let node = multiplication();
    for (;;) {
      const token = current();
      if (token.kind !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      consume();
      node = { kind: 'binary', operator: token.value, left: node, right: multiplication() };
    }
    return node;
  };
  /** Lowest precedence, so `a + 1 < b * 2` compares the two arithmetic sides. */
  const comparison = (): ExpressionNode => {
    let node = addition();
    for (;;) {
      const token = current();
      if (token.kind !== 'comparison') break;
      consume();
      node = { kind: 'comparison', operator: token.value, left: node, right: addition() };
    }
    return node;
  };

  const root = comparison();
  if (current().kind !== 'end') throw new Error('table expression has unexpected trailing input');
  return root;
}

function evaluate(node: ExpressionNode, context: TableExpressionContext): number {
  switch (node.kind) {
    case 'number': return node.value;
    case 'column': return context.cells[node.index] ?? 0;
    case 'unary': {
      const value = evaluate(node.operand, context);
      return node.operator === '-' ? -value : value;
    }
    case 'call': return FUNCTIONS[node.name].evaluate(node.args, context);
    case 'comparison': {
      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);
      switch (node.operator) {
        case '<': return left < right ? TRUE : FALSE;
        case '>': return left > right ? TRUE : FALSE;
        case '<=': return left <= right ? TRUE : FALSE;
        case '>=': return left >= right ? TRUE : FALSE;
        case '=': return left === right ? TRUE : FALSE;
        case '<>': return left !== right ? TRUE : FALSE;
      }
    }
    // eslint-disable-next-line no-fallthrough -- every comparison branch returns
    case 'binary': {
      const left = evaluate(node.left, context);
      const right = evaluate(node.right, context);
      switch (node.operator) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '^': return left ** right;
        case '/': return divide(left, right, context);
      }
    }
  }
}

export function evaluateTableExpression(node: ExpressionNode, context: TableExpressionContext): number {
  return evaluate(node, context);
}
