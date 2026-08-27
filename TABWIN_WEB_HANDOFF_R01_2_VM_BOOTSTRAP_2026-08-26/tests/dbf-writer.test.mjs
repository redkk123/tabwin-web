import test from 'node:test';
import assert from 'node:assert/strict';
import { readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { writeDbf } from '../dist/packages/export/src/dbf-writer.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { resolvePlanRecord } from '../dist/packages/core/src/execute.js';
import { parseDelimited } from '../dist/packages/formats/src/delimited.js';

const fields = [
  { name: 'NOME_LONGO_DEMAIS', type: 'C', length: 12, decimalCount: 0 },
  { name: 'VALOR', type: 'N', length: 8, decimalCount: 2 },
  { name: 'DATA', type: 'D', length: 8, decimalCount: 0 },
  { name: 'ATIVO', type: 'L', length: 1, decimalCount: 0 },
  { name: 'CODIGO', type: 'I', length: 4, decimalCount: 0 },
];

test('DBF writer round-trips character, numeric, date, logical and integer fields', async () => {
  const bytes = writeDbf([{
    NOME_LONGO_DEMAIS: 'São José', VALOR: 12.5, DATA: new Date('2026-08-27T00:00:00Z'), ATIVO: true, CODIGO: 7,
  }], fields, { dateOfLastUpdate: new Date('2026-08-27T00:00:00Z') });
  const header = readDbfHeader(bytes);
  assert.equal(header.recordCount, 1);
  assert.deepEqual(header.fields.map((field) => field.name), ['NOME_LONGO', 'VALOR', 'DATA', 'ATIVO', 'CODIGO']);
  const records = [];
  for await (const record of readDbfRecords(bytes)) records.push(record);
  assert.equal(records[0].NOME_LONGO, 'São José');
  assert.equal(records[0].VALOR, 12.5);
  assert.equal(records[0].ATIVO, true);
  assert.equal(records[0].CODIGO, 7);
  assert.equal(records[0].DATA.toISOString(), '2026-08-27T00:00:00.000Z');
});

test('DBF writer rejects width overflow and invalid descriptors explicitly', () => {
  assert.throws(() => writeDbf([{ X: 'grande' }], [{ name: 'X', type: 'C', length: 2, decimalCount: 0 }]), /exceeds width/);
  assert.throws(() => writeDbf([], [{ name: 'D', type: 'D', length: 7, decimalCount: 0 }]), /length 8/);
});

test('CSV records selected by the executor round-trip as a filtered DBF subset', async () => {
  const dataset = parseDelimited('UF;IDADE;NOME\nAC;18;Ana\nSP;30;Bia\nAC;42;Caio');
  const plan = compileQueryPlan({
    compatibilityProfile: 'modern', rows: { field: 'UF' }, measure: { kind: 'count' },
    filters: [{ field: 'UF', acceptedCategories: ['AC'] }, { field: 'IDADE', kind: 'numeric-range', minimum: 20 }],
  });
  const selected = dataset.records.filter((record) => resolvePlanRecord(record, plan) !== undefined);
  assert.deepEqual(selected.map((record) => record.NOME), ['Caio']);
  const bytes = writeDbf(selected, dataset.fields, { dateOfLastUpdate: new Date('2026-08-27T00:00:00Z') });
  assert.equal(readDbfHeader(bytes).recordCount, 1);
  const decoded = [];
  for await (const record of readDbfRecords(bytes)) decoded.push(record);
  assert.deepEqual(decoded.map((record) => record.NOME), ['Caio']);
});
