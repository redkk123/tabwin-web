import assert from 'node:assert/strict';
import test from 'node:test';
import { compileQueryPlan } from '../dist/packages/core/src/index.js';
import { parseCnv } from '../dist/packages/formats/src/index.js';
import {
  createMicrodatasusCsvEncoder,
  fieldsUsedByMicrodatasusExport,
} from '../dist/packages/export/src/microdatasus.js';

function row(sequence, label, codes) {
  return `${''.padStart(3)}${String(sequence).padStart(4)}  ${label.padEnd(50).slice(0, 50)} ${codes}`;
}

const sexCnv = parseCnv(['2 1', row(1, 'Masculino', 'M'), row(2, 'Feminino', 'F')].join('\n'));
const plan = compileQueryPlan({
  compatibilityProfile: 'modern',
  rows: { field: 'UF' },
  measure: { kind: 'count' },
  filters: [{ field: 'ANO', kind: 'numeric-range', minimum: 2024 }],
});

test('Microdatasus export uses the QueryPlan acceptance boundary and emits raw + readable labels', () => {
  const fields = [
    { field: 'UF' },
    { field: 'SEXO', dimension: { field: 'SEXO', conversionId: 'SEXO.CNV' }, valueMode: 'raw-and-label' },
    { field: 'NOTA' },
  ];
  assert.deepEqual(new Set(fieldsUsedByMicrodatasusExport(plan, fields)), new Set(['UF', 'ANO', 'SEXO', 'NOTA']));
  const exporter = createMicrodatasusCsvEncoder(plan, fields, { 'SEXO.CNV': sexCnv }, {
    provenanceColumns: ['sourceName', 'year', 'uf'],
  });
  const chunks = [
    exporter.header(),
    exporter.push([
      { UF: 'AC', SEXO: 'M', ANO: 2024, NOTA: 'ok; com separador' },
      { UF: 'AC', SEXO: 'F', ANO: 2023, NOTA: 'fora do filtro' },
    ], { sourceName: 'RDAC2401.dbc', year: '2024', uf: 'AC' }),
  ];
  const stats = exporter.finish();
  const text = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  assert.equal(chunks[0][0], 0xef);
  assert.equal(chunks[0][1], 0xbb);
  assert.equal(chunks[0][2], 0xbf);
  assert.match(text, /^__FONTE_ARQUIVO;__ANO_FONTE;__UF_FONTE;UF;SEXO;SEXO__ROTULO;NOTA\r\n/);
  assert.match(text, /RDAC2401\.dbc;2024;AC;AC;M;Masculino;"ok; com separador"/);
  assert.doesNotMatch(text, /fora do filtro/);
  assert.deepEqual(stats, { recordsSeen: 2, recordsAccepted: 1, rowsEmitted: 1, bytesEmitted: Buffer.byteLength(text) + 3 });
});

test('Microdatasus exporter is bounded by batches and refuses ambiguous output schemas', () => {
  assert.throws(() => createMicrodatasusCsvEncoder(plan, [
    { field: 'UF', outputName: 'X' },
    { field: 'ANO', outputName: 'x' },
  ]), /headers must be unique/);

  const exporter = createMicrodatasusCsvEncoder(plan, [{ field: 'UF' }], {}, { includeBom: false });
  exporter.header();
  const empty = exporter.push([{ UF: 'AC', ANO: 2020 }]);
  assert.equal(empty.byteLength, 0);
  const accepted = exporter.push([{ UF: 'AM', ANO: 2024 }]);
  assert.equal(new TextDecoder().decode(accepted), 'AM\r\n');
  assert.deepEqual(exporter.finish(), { recordsSeen: 2, recordsAccepted: 1, rowsEmitted: 1, bytesEmitted: 8 });
  assert.throws(() => exporter.push([]), /already finished/);
});
