import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCnv, validateCnvDefinition } from '../dist/packages/formats/src/index.js';

function row(sequence, label, codes, subtotal = '') {
  const subtotalField = subtotal.padStart(3).slice(-3);
  const sequenceField = String(sequence).padStart(4);
  const descriptionField = label.padEnd(50).slice(0, 50);
  return `${subtotalField}${sequenceField}  ${descriptionField} ${codes}`;
}

test('a well-formed CNV has no diagnostics', () => {
  const cnv = parseCnv(['2 2', row(1, 'Um', '01'), row(2, 'Dois', '02')].join('\n'));
  assert.deepEqual(validateCnvDefinition(cnv), []);
});

test('a category-count mismatch is flagged at header scope', () => {
  const cnv = parseCnv(['3 2', row(1, 'Um', '01'), row(2, 'Dois', '02')].join('\n'));
  const diagnostics = validateCnvDefinition(cnv);
  assert.ok(diagnostics.some((d) => d.scope === 'header' && /declares 3 categories but 2/.test(d.message)));
});

test('an empty label is flagged against its own category', () => {
  const cnv = parseCnv(['1 2', row(1, '', '01')].join('\n'));
  const diagnostics = validateCnvDefinition(cnv);
  assert.deepEqual(diagnostics, [{ scope: 'category', categorySequence: 1, severity: 'warning', message: 'category has no label' }]);
});

test('a subtotal target pointing at a category that does not exist is an error', () => {
  const cnv = parseCnv(['1 2', row(1, 'Filho', '01', '9')].join('\n'));
  const diagnostics = validateCnvDefinition(cnv);
  assert.ok(diagnostics.some((d) => d.severity === 'error' && /subtotal target 9/.test(d.message)));
});

test('a category built by an editor with no matching rule is an error, not a silent gap', () => {
  const cnv = parseCnv(['1 2', row(1, 'Um', '01')].join('\n'));
  cnv.categories.push({ sequence: 2, label: 'Sem regra' });
  const diagnostics = validateCnvDefinition(cnv);
  assert.ok(diagnostics.some((d) => d.categorySequence === 2 && /no matching rule/.test(d.message)));
});

test('a rule with no codes or ranges is a warning: it will never match anything', () => {
  const cnv = parseCnv(['1 2', row(1, 'Vazio', '01')].join('\n'));
  cnv.rules[0].exactCodes = [];
  cnv.rules[0].ranges = [];
  const diagnostics = validateCnvDefinition(cnv);
  assert.ok(diagnostics.some((d) => d.categorySequence === 1 && /never match/.test(d.message)));
});

test('a duplicate category sequence is an error on both occurrences', () => {
  const cnv = parseCnv(['1 2', row(1, 'Um', '01')].join('\n'));
  cnv.categories.push({ sequence: 1, label: 'Duplicado' });
  const diagnostics = validateCnvDefinition(cnv);
  assert.equal(diagnostics.filter((d) => /used by more than one category/.test(d.message)).length, 2);
});

test('a non-monotonic numeric range is a warning naming the affected category', () => {
  const cnv = parseCnv(['2 14 Faixas', row(1, 'Alto', '999999.99'), row(2, 'Baixo', '99.99')].join('\n'));
  const diagnostics = validateCnvDefinition(cnv);
  assert.ok(diagnostics.some((d) => d.categorySequence === 2 && /not monotonic|earlier rule/.test(d.message)));
});

test('a missing numeric upper bound is an error in numeric-ranges mode', () => {
  const cnv = parseCnv(['1 14 Faixas', row(1, 'X', '99.99')].join('\n'));
  cnv.rules[0].numericUpperInclusive = undefined;
  const diagnostics = validateCnvDefinition(cnv);
  assert.ok(diagnostics.some((d) => d.categorySequence === 1 && /missing its upper bound/.test(d.message)));
});
