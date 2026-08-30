import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortableTable, serializePortableTable } from '../dist/packages/core/src/portable-table.js';

const table = {
  schema: 'tabwin-web.table', version: 1, title: 'Tabela portátil', rowLabel: 'Município',
  createdAt: '2026-08-27T12:00:00.000Z',
  source: { name: 'teste.dbc', size: 123, sha256: 'abc' },
  plan: { version: 1, warnings: [], spec: {
    compatibilityProfile: 'tabwin-4.15', rows: { field: 'MUNIC_RES' }, measure: { kind: 'count' }, filters: [],
  } },
  baseResult: {
    rows: [{ key: '1', label: 'A', source: 'raw' }],
    columns: [{ key: '__value__', label: 'Freqüência', source: 'derived' }],
    cells: [[12]], warnings: [], recordsSeen: 13, recordsAccepted: 12,
  },
  operations: [{ kind: 'transpose' }],
  presentation: { sortColumnKey: '__value__', sortDirection: 'descending', decimalPlaces: 0, keyVisible: true, subtitle: 'Subtítulo', footer: 'Fonte' },
};

test('portable table serialization is deterministic and round-trippable', () => {
  const first = serializePortableTable(table);
  const second = serializePortableTable(structuredClone(table));
  assert.equal(first, second);
  assert.deepEqual(parsePortableTable(first), table);
});

test('portable table parser rejects malformed matrix shapes and non-finite cells', () => {
  const malformed = structuredClone(table);
  malformed.baseResult.cells = [];
  assert.throws(() => parsePortableTable(JSON.stringify(malformed)), /shape mismatch/);
  const nonFinite = structuredClone(table);
  nonFinite.baseResult.cells = [[null]];
  assert.throws(() => parsePortableTable(JSON.stringify(nonFinite)), /non-finite/);
});

test('portable table parser rejects invalid plans, operations and presentation', () => {
  const invalidPlan = structuredClone(table);
  invalidPlan.plan.spec.rows.field = '';
  assert.throws(() => parsePortableTable(JSON.stringify(invalidPlan)), /row field/);
  const invalidOperation = structuredClone(table);
  invalidOperation.operations = [{ kind: 'delete-column', columnKey: '' }];
  assert.throws(() => parsePortableTable(JSON.stringify(invalidOperation)), /operation/);
  const invalidInclude = structuredClone(table);
  invalidInclude.operations = [{
    kind: 'include-table', sourceLabel: 'Outra', requireMatchingLabels: true,
    rows: [{ key: '1', label: 'A' }],
    columns: [{ key: 'outra:x', label: 'X', source: 'derived' }], cells: [[]],
  }];
  assert.throws(() => parsePortableTable(JSON.stringify(invalidInclude)), /include-table/);
  const invalidPresentation = structuredClone(table);
  invalidPresentation.presentation.decimalPlaces = 20;
  assert.throws(() => parsePortableTable(JSON.stringify(invalidPresentation)), /presentation/);
  const oversizedFooter = structuredClone(table);
  oversizedFooter.presentation.footer = 'x'.repeat(241);
  assert.throws(() => parsePortableTable(JSON.stringify(oversizedFooter)), /presentation/);
});
