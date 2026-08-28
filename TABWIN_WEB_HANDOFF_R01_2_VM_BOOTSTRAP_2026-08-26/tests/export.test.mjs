import test from 'node:test';
import assert from 'node:assert/strict';
import { tabulationToCsv, tabulationToJson, tabulationToXml } from '../dist/packages/export/src/tabulation.js';
import { tabulationToXlsx } from '../dist/packages/export/src/xlsx.js';
import { strFromU8, unzipSync } from 'fflate';

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

test('exports deterministic JSON with provenance and the complete analytical result', () => {
  const context = {
    sourceName: 'teste.dbc',
    rowLabel: 'Categoria',
    generatedAt: '2026-08-27T00:00:00.000Z',
  };
  const first = tabulationToJson(result, context);
  assert.equal(first, tabulationToJson(result, context));
  const parsed = JSON.parse(first);
  assert.equal(parsed.schema, 'tabwin-web.tabulation');
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.provenance, {
    source: 'teste.dbc',
    generatedAt: '2026-08-27T00:00:00.000Z',
  });
  assert.deepEqual(parsed.dimension, { label: 'Categoria' });
  assert.deepEqual(parsed.result, result);
});

test('exports a deterministic two-sheet XLSX with numeric cells and audit metadata', () => {
  const context = { sourceName: 'teste&1.dbc', rowLabel: 'Categoria', generatedAt: '2026-08-27T00:00:00.000Z' };
  const first = tabulationToXlsx(result, context);
  const second = tabulationToXlsx(result, context);
  assert.deepEqual(first, second);
  const files = unzipSync(first);
  assert.ok(files['xl/worksheets/sheet1.xml']);
  assert.ok(files['xl/worksheets/sheet2.xml']);
  const table = strFromU8(files['xl/worksheets/sheet1.xml']);
  const audit = strFromU8(files['xl/worksheets/sheet2.xml']);
  assert.match(table, /Categoria/);
  assert.match(table, /A &amp; B/);
  assert.match(table, /<c r="B2"><v>12<\/v><\/c>/);
  assert.match(audit, /teste&amp;1\.dbc/);
  assert.match(audit, /2026-08-27T00:00:00\.000Z/);
});
