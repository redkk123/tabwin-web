import assert from 'node:assert/strict';
import test from 'node:test';
import {
  labPackageCsv,
  labPackageEntries,
  labPackageFilename,
  labPackageProvenance,
} from '../dist/packages/export/src/lab-package.js';

const BASE = {
  content: 'records',
  columns: [
    { name: 'UF', label: 'Unidade da Federação' },
    { name: 'IDADE', label: null },
  ],
  rows: [['AC', 34], ['SP', null]],
  sources: [{ name: 'DENGBR24.dbc', sha256: 'a'.repeat(64), bytes: 1024 }],
  createdAt: '2026-09-01T12:00:00.000Z',
};

test('ausente vira campo vazio, nunca zero nem "null"', () => {
  // É a mesma regra que vale no resto do projeto: zero é afirmação sobre o
  // mundo, e um CSV que a inventa contamina toda análise feita por cima dele.
  const csv = labPackageCsv(BASE);
  const [, , second] = csv.split('\r\n');
  assert.equal(second, 'SP,');
  assert.ok(!csv.includes('null'));
});

test('o cabeçalho leva o nome técnico, porque é por ele que o código acessa a coluna', () => {
  const csv = labPackageCsv(BASE);
  assert.equal(csv.split('\r\n')[0], 'UF,IDADE');
  // O rótulo legível não se perde: fica na procedência.
  const provenance = labPackageProvenance(BASE);
  assert.equal(provenance.columns[0].label, 'Unidade da Federação');
  assert.equal(provenance.columns[1].label, null);
});

test('separador, aspas e quebra de linha dentro do valor não quebram o arquivo', () => {
  const csv = labPackageCsv({
    ...BASE,
    columns: [{ name: 'TEXTO', label: null }],
    rows: [['tem, vírgula'], ['tem "aspas"'], ['tem\nquebra'], ['tem;ponto-e-vírgula']],
  });
  const lines = csv.split('\r\n');
  assert.equal(lines[1], '"tem, vírgula"');
  assert.equal(lines[2], '"tem ""aspas"""');
  assert.ok(csv.includes('"tem\nquebra"'));
  assert.ok(csv.includes('"tem;ponto-e-vírgula"'));
});

test('a procedência responde de onde veio e o que foi feito', () => {
  const provenance = labPackageProvenance({
    ...BASE,
    filters: ['UF em (AC, SP)'],
    transformSteps: [{ id: 't1', kind: 'recode' }],
  });
  assert.equal(provenance.schema, 'tabwin-web.lab-package');
  assert.equal(provenance.version, 1);
  assert.equal(provenance.rowCount, 2);
  assert.equal(provenance.sources[0].sha256.length, 64);
  assert.deepEqual(provenance.filters, ['UF em (AC, SP)']);
  assert.equal(provenance.transformSteps.length, 1);
  // Sem procedência, um CSV num caderno é número sem origem.
  assert.ok(provenance.notes.some((note) => /DATASUS/.test(note)));
  assert.ok(provenance.notes.some((note) => /Nenhum zero foi fabricado/.test(note)));
  assert.ok(provenance.notes.some((note) => /não é afiliado/.test(note)));
});

test('tabulação e registros são declarados, porque significam coisas diferentes', () => {
  const records = labPackageProvenance({ ...BASE, content: 'records' });
  assert.equal(records.content, 'records');
  assert.ok(records.notes.some((note) => /uma linha por registro aceito/i.test(note)));

  const table = labPackageProvenance({ ...BASE, content: 'tabulation' });
  assert.equal(table.content, 'tabulation');
  assert.ok(table.notes.some((note) => /totais do TabWin não são células/i.test(note)));
});

test('o pacote tem os dois arquivos, e o CSV sai com BOM', () => {
  const entries = labPackageEntries(BASE);
  assert.deepEqual(Object.keys(entries).sort(), ['PROVENIENCIA.json', 'dados.csv']);
  // Sem BOM, Excel lê como Latin-1 e destrói todo acento.
  const csv = entries['dados.csv'];
  assert.deepEqual([...csv.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const provenance = JSON.parse(new TextDecoder().decode(entries['PROVENIENCIA.json']));
  assert.equal(provenance.schema, 'tabwin-web.lab-package');
});

test('acento sobrevive à ida e à volta em UTF-8', () => {
  const entries = labPackageEntries({
    ...BASE,
    columns: [{ name: 'MUNICIPIO', label: null }],
    rows: [['Ji-Paraná'], ['São Paulo']],
  });
  const text = new TextDecoder().decode(entries['dados.csv']);
  assert.ok(text.includes('Ji-Paraná'));
  assert.ok(text.includes('São Paulo'));
});

test('o nome do arquivo distingue registros de tabela', () => {
  const when = new Date('2026-09-01T00:00:00Z');
  assert.equal(labPackageFilename({ content: 'records' }, when), 'tabwin-lab-registros-2026-09-01.zip');
  assert.equal(labPackageFilename({ content: 'tabulation' }, when), 'tabwin-lab-tabela-2026-09-01.zip');
});

test('tabela vazia gera pacote válido com zero linhas, em vez de falhar', () => {
  const entries = labPackageEntries({ ...BASE, rows: [] });
  const text = new TextDecoder().decode(entries['dados.csv']);
  assert.equal(text.replace('﻿', ''), 'UF,IDADE\r\n');
  const provenance = JSON.parse(new TextDecoder().decode(entries['PROVENIENCIA.json']));
  assert.equal(provenance.rowCount, 0);
});
