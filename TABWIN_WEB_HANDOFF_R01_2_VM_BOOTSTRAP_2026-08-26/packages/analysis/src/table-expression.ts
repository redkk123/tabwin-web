import type { TabulationResult } from '../../core/src/model.js';

type BinaryOperator = '+' | '-' | '*' | '/' | '^';
type ExpressionNode =
  | { kind: 'number'; value: number }
  | { kind: 'column'; index: number }
  | { kind: 'unary'; operator: '+' | '-'; operand: ExpressionNode }
  | { kind: 'binary'; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode };

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'reference'; value: string }
  | { kind: 'operator'; value: BinaryOperator | '+' | '-' }
  | { kind: 'left' | 'right' | 'end' };

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
    if ('+-*/^'.includes(char)) {
      tokens.push({ kind: 'operator', value: char as BinaryOperator });
      offset++;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ kind: char === '(' ? 'left' : 'right' });
      offset++;
      continue;
    }
    const reference = /^[^\s+\-*/^()[\]]+/.exec(rest);
    if (reference) {
      tokens.push({ kind: 'reference', value: reference[0] });
      offset += reference[0].length;
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
  if (!expression.trim()) throw new Error('table expression cannot be empty');
  const tokens = tokenize(expression);
  let position = 0;
  const current = (): Token => tokens[position] ?? { kind: 'end' };
  const consume = (): Token => tokens[position++] ?? { kind: 'end' };

  const primary = (): ExpressionNode => {
    const token = consume();
    if (token.kind === 'number') return { kind: 'number', value: token.value };
    if (token.kind === 'reference') return { kind: 'column', index: resolveColumn(result, token.value) };
    if (token.kind === 'left') {
      const node = addition();
      if (consume().kind !== 'right') throw new Error('table expression is missing a closing parenthesis');
      return node;
    }
    throw new Error('table expression expected a number, column or parenthesis');
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
    while (current().kind === 'operator' && (current() as { value?: string }).value && ['*', '/'].includes((current() as { value: string }).value)) {
      const operator = (consume() as { value: '*' | '/' }).value;
      node = { kind: 'binary', operator, left: node, right: unary() };
    }
    return node;
  };
  const addition = (): ExpressionNode => {
    let node = multiplication();
    while (current().kind === 'operator' && (current() as { value?: string }).value && ['+', '-'].includes((current() as { value: string }).value)) {
      const operator = (consume() as { value: '+' | '-' }).value;
      node = { kind: 'binary', operator, left: node, right: multiplication() };
    }
    return node;
  };

  const root = addition();
  if (current().kind !== 'end') throw new Error('table expression has unexpected trailing input');
  return root;
}

export function evaluateTableExpression(
  node: ExpressionNode,
  cells: readonly number[],
  divisionByZero: 'error' | 'zero',
  rowIndex: number,
): number {
  if (node.kind === 'number') return node.value;
  if (node.kind === 'column') return cells[node.index] ?? 0;
  if (node.kind === 'unary') {
    const value = evaluateTableExpression(node.operand, cells, divisionByZero, rowIndex);
    return node.operator === '-' ? -value : value;
  }
  const left = evaluateTableExpression(node.left, cells, divisionByZero, rowIndex);
  const right = evaluateTableExpression(node.right, cells, divisionByZero, rowIndex);
  switch (node.operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '^': return left ** right;
    case '/':
      if (right !== 0) return left / right;
      if (divisionByZero === 'zero') return 0;
      throw new Error(`division by zero at result row ${rowIndex + 1}`);
  }
}
