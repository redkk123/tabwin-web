import assert from 'node:assert/strict';
import test from 'node:test';
import { CnvSerializeError, classifyCnv, parseCnv, serializeCnv } from '../dist/packages/formats/src/index.js';

function row(sequence, label, codes, subtotal = '') {
  const subtotalField = subtotal.padStart(3).slice(-3);
  const sequenceField = String(sequence).padStart(4);
  const descriptionField = label.padEnd(50).slice(0, 50);
  return `${subtotalField}${sequenceField}  ${descriptionField} ${codes}`;
}

test('a short-mode CNV round-trips through parse, serialize, parse with the same categories and matches', () => {
  const original = parseCnv(['3 2', row(3, 'Ignorado', '00-99'), row(1, 'Janeiro', '01'), row(2, 'Fevereiro', '02')].join('\n'));
  const reparsed = parseCnv(serializeCnv(original));
  assert.equal(reparsed.mode, 'short');
  assert.equal(reparsed.precedence, 'last-match-wins');
  assert.deepEqual(reparsed.categories, original.categories);
  assert.deepEqual(classifyCnv(reparsed, '01'), { sequence: 1, label: 'Janeiro' });
  assert.deepEqual(classifyCnv(reparsed, '88'), { sequence: 3, label: 'Ignorado' });
});

test('literal mode round-trips its explicit L modifier', () => {
  const original = parseCnv(['2 2 L', row(1, 'Primeiro', 'AA'), row(2, 'Segundo', 'AA')].join('\n'));
  const reparsed = parseCnv(serializeCnv(original));
  assert.equal(reparsed.mode, 'literal');
  assert.equal(reparsed.precedence, 'first-match-wins');
  assert.deepEqual(classifyCnv(reparsed, 'AA'), { sequence: 1, label: 'Primeiro' });
});

test('numeric-ranges mode round-trips its F modifier and upper bounds', () => {
  const original = parseCnv(['3 14 Faixas', row(1, 'Baixo', '99.99'), row(2, 'Medio', '499.99'), row(3, 'Alto', '999999.99')].join('\n'));
  const reparsed = parseCnv(serializeCnv(original));
  assert.equal(reparsed.mode, 'numeric-ranges');
  assert.deepEqual(classifyCnv(reparsed, 100), { sequence: 2, label: 'Medio' });
});

test('subtotal target and exclude-from-total (#) survive the round trip', () => {
  const original = parseCnv(['3 2', row(1, 'Publico', '10,20'), row(2, 'Federal', '10', '1'), row(3, 'Nota', '99', '#')].join('\n'));
  const reparsed = parseCnv(serializeCnv(original));
  assert.equal(reparsed.categories[1]?.subtotalTarget, 1);
  assert.equal(reparsed.categories[2]?.excludeFromTotal, true);
});

test('a category built by an editor with a category count mismatch still round-trips (the mismatch is a warning, not a rejection)', () => {
  const original = parseCnv(['3 2', row(1, 'Um', '01'), row(2, 'Dois', '02')].join('\n'));
  assert.match(original.warnings[0] ?? '', /declares 3 categories but 2/);
  const reparsed = parseCnv(serializeCnv(original));
  assert.equal(reparsed.categories.length, 2);
});

test('new-format (N) definitions remain non-serializable after safe read-only parsing was added', () => {
  // Writing the hierarchy prefix remains unproved even though the observed
  // fixed columns can now be decoded for inspection.
  const definition = {
    categoryCount: 1, codeLength: 2, mode: 'new-format', precedence: 'last-match-wins',
    categories: [{ sequence: 1, label: 'X' }],
    rules: [{ categorySequence: 1, exactCodes: ['01'], ranges: [], sourceOrder: 0, sourceLine: 2 }],
    comments: [], warnings: [], headerLine: 1,
  };
  assert.throws(() => serializeCnv(definition), CnvSerializeError);
});

test('a label past the 50-char fixed width fails loudly instead of truncating silently', () => {
  const original = parseCnv(['1 2', row(1, 'Curto', '01')].join('\n'));
  original.categories[0].label = 'x'.repeat(51);
  assert.throws(() => serializeCnv(original), /exceeds the fixed field width of 50/);
});

test('a label containing a semicolon fails loudly instead of being read back as a comment', () => {
  const original = parseCnv(['1 2', row(1, 'Curto', '01')].join('\n'));
  original.categories[0].label = 'a; b';
  assert.throws(() => serializeCnv(original), /comment marker/);
});

test('a rule with no codes and no ranges still produces a reparsable line (padded to the minimum width)', () => {
  const original = parseCnv(['1 2', row(1, 'Vazio', '01')].join('\n'));
  original.rules[0].exactCodes = [];
  original.rules[0].ranges = [];
  const text = serializeCnv(original);
  const reparsed = parseCnv(text);
  assert.equal(reparsed.categories[0]?.label, 'Vazio');
});
