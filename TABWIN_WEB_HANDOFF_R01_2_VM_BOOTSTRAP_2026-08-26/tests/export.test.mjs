import test from 'node:test';
import assert from 'node:assert/strict';
import { tabulationToCsv, tabulationToXml } from '../dist/packages/export/src/tabulation.js';

const result = {
  rows: [{ key: '1', label: 'A & B' }],
  columns: [{ key: 'count', label: 'Frequência' }],
  cells: [[12]],
  recordsSeen: 13,
  recordsAccepted: 12,
  warnings: [],
};

test('exports a complete UTF-8 CSV table', () => {
  const csv = tabulationToCsv(result, { sourceName: 'teste.dbc', rowLabel: 'Categoria' });
  assert.equal(csv, '\uFEFF"Categoria","Frequência"\r\n"A & B","12"');
});

test('exports deterministic, escaped XML with provenance', () => {
  const xml = tabulationToXml(result, {
    sourceName: 'teste&1.dbc',
    rowLabel: 'Categoria',
    generatedAt: '2026-08-27T00:00:00.000Z',
  });
  assert.match(xml, /source="teste&amp;1\.dbc"/);
  assert.match(xml, /label="A &amp; B"/);
  assert.match(xml, /<cell column="0">12<\/cell>/);
  assert.match(xml, /seen="13" accepted="12"/);
});

