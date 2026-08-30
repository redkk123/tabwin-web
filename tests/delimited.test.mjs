import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited } from '../dist/packages/formats/src/delimited.js';

test('CSV import handles BOM, quoted delimiters, newlines and conservative numeric inference', () => {
  const dataset = parseDelimited('\uFEFFcodigo,nome,valor\r\n001,"A, B",10.5\r\n002,"linha\nnova",20');
  assert.equal(dataset.delimiter, ',');
  assert.deepEqual(dataset.fields.map((field) => field.type), ['C', 'C', 'N']);
  assert.deepEqual(dataset.records, [
    { codigo: '001', nome: 'A, B', valor: 10.5 },
    { codigo: '002', nome: 'linha\nnova', valor: 20 },
  ]);
});

test('semicolon CSV accepts decimal commas while tabs remain supported', () => {
  const semicolon = parseDelimited('uf;taxa\nAC;1,5\nSP;2,75');
  assert.equal(semicolon.delimiter, ';');
  assert.deepEqual(semicolon.records.map((record) => record.taxa), [1.5, 2.75]);
  const tab = parseDelimited('chave\tvalor\nA\t3');
  assert.equal(tab.delimiter, '\t');
  assert.equal(tab.records[0].valor, 3);
});

test('CSV import rejects ambiguous headers, inconsistent rows and unclosed quotes', () => {
  assert.throws(() => parseDelimited('a,a\n1,2'), /duplicate/);
  assert.throws(() => parseDelimited('a,b\n1'), /row 2/);
  assert.throws(() => parseDelimited('a,b\n1,"x'), /unclosed/);
  assert.throws(() => parseDelimited('a,b\n'), /no data rows/);
});
