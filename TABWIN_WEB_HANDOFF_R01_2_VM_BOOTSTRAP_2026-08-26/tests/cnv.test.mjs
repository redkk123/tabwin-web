import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCnv, parseCnv } from '../dist/packages/formats/src/index.js';

function row(sequence, label, codes, subtotal = '') {
  const subtotalField = subtotal.padStart(3).slice(-3);
  const sequenceField = String(sequence).padStart(4);
  const descriptionField = label.padEnd(50).slice(0, 50);
  return `${subtotalField}${sequenceField}  ${descriptionField} ${codes}`;
}

test('parses legacy fixed-column CNV and preserves comments', () => {
  const text = ['; before header', '3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n');
  const cnv = parseCnv(text);
  assert.equal(cnv.categoryCount, 3);
  assert.equal(cnv.codeLength, 2);
  assert.equal(cnv.mode, 'short');
  assert.equal(cnv.precedence, 'last-match-wins');
  assert.equal(cnv.categories.length, 3);
  assert.deepEqual(cnv.comments, ['before header']);
});

test('short-code overlap follows documented later-row precedence', () => {
  const cnv = parseCnv(['3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n'));
  assert.deepEqual(classifyCnv(cnv, '01'), { sequence: 1, label: 'Janeiro' });
  assert.deepEqual(classifyCnv(cnv, '02'), { sequence: 2, label: 'Fevereiro' });
  assert.deepEqual(classifyCnv(cnv, '88'), { sequence: 3, label: 'Ignorado' });
});

test('literal mode preserves first-match behavior as an explicit compatibility rule', () => {
  const cnv = parseCnv(['2 2 L', row(1, 'Primeiro', 'AA'), row(2, 'Segundo', 'AA')].join('\n'));
  assert.equal(cnv.precedence, 'first-match-wins');
  assert.deepEqual(classifyCnv(cnv, 'AA'), { sequence: 1, label: 'Primeiro' });
});

test('numeric range mode uses inclusive upper bounds', () => {
  const cnv = parseCnv(['3 14 Faixas', row(1, 'Baixo', '99.99'), row(2, 'Medio', '499.99'), row(3, 'Alto', '999999.99')].join('\n'));
  assert.deepEqual(classifyCnv(cnv, 99.99), { sequence: 1, label: 'Baixo' });
  assert.deepEqual(classifyCnv(cnv, 100), { sequence: 2, label: 'Medio' });
  assert.deepEqual(classifyCnv(cnv, 800), { sequence: 3, label: 'Alto' });
});

test('subtotal and # metadata are parsed from columns 1-3', () => {
  const cnv = parseCnv(['3 2', row(1, 'Publico', '10,20'), row(2, 'Federal', '10', '1'), row(3, 'Nota', '99', '#')].join('\n'));
  assert.equal(cnv.categories[1]?.subtotalTarget, 1);
  assert.equal(cnv.categories[2]?.excludeFromTotal, true);
});

test('detects new-format marker instead of silently guessing its offsets', () => {
  assert.throws(() => parseCnv('N3 2\n'), /new-format CNV/);
});
