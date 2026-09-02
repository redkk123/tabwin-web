import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeHeadline, describeRecordBasis, summarizeTable,
} from '../dist/packages/analysis/src/table-headline.js';

const fmt = {
  integer: (v) => new Intl.NumberFormat('pt-BR').format(v),
  percent: (f) => `${Math.round(f * 100)}%`,
};

/** SINASC 2023 por raça/cor, números reais conferidos hoje contra o TabNet. */
const sinasc = {
  rows: [
    { label: 'Parda' }, { label: 'Branca' }, { label: 'Preta' },
    { label: 'Ignorado' }, { label: 'Indígena' }, { label: 'Amarela' },
  ],
  cells: [[1_413_640], [840_050], [196_325], [45_982], [29_623], [11_956]],
  measureLabel: 'Nascidos vivos',
  recordsAccepted: 2_537_576,
  recordsSeen: 2_537_576,
};

test('o total é a soma de todas as células', () => {
  assert.equal(summarizeTable(sinasc).total, 2_537_576);
});

test('as maiores categorias vêm ordenadas, com a fração de cada uma', () => {
  const { top } = summarizeTable(sinasc);
  assert.deepEqual(top.map((t) => t.label), ['Parda', 'Branca', 'Preta']);
  assert.equal(Math.round(top[0].share * 100), 56);
});

test('a frase cita a maior, e a segunda só quando ela ainda pesa', () => {
  assert.equal(describeHeadline(summarizeTable(sinasc), fmt),
    '56% Parda · 33% Branca · 6 categorias ao todo');
});

test('segunda categoria irrelevante não entra na frase', () => {
  // Abaixo de 10% a segunda alonga sem informar, e a manchete deixa de ser
  // manchete.
  const dominante = {
    rows: [{ label: 'Masculino' }, { label: 'Feminino' }, { label: 'Ignorado' }],
    cells: [[950], [40], [10]],
  };
  assert.equal(describeHeadline(summarizeTable(dominante), fmt),
    '95% Masculino · 3 categorias ao todo');
});

test('medida com nome próprio não vira "total" genérico', () => {
  assert.equal(summarizeTable(sinasc).measureLabel, 'Nascidos vivos');
  assert.equal(summarizeTable({ rows: [], cells: [] }).measureLabel, 'Total');
});

test('total zero não produz porcentagem', () => {
  // Dividir por zero daria Infinity ou NaN na tela; e mesmo protegido, uma
  // proporção de nada não significa coisa alguma.
  const vazio = { rows: [{ label: 'A' }, { label: 'B' }], cells: [[0], [0]] };
  const h = summarizeTable(vazio);
  assert.equal(h.total, 0);
  assert.ok(h.top.every((t) => t.share === undefined));
  assert.match(describeHeadline(h, fmt), /sem valor a destacar/);
});

test('medida com sinal não ganha fração inventada', () => {
  // Saldo ou variação somam negativo e positivo: a fração de uma parte sobre
  // um total que pode ser zero ou negativo não quer dizer nada.
  const saldo = { rows: [{ label: 'Entrada' }, { label: 'Saída' }], cells: [[100], [-100]] };
  const h = summarizeTable(saldo);
  assert.equal(h.total, 0);
  assert.ok(h.top.every((t) => t.share === undefined));
});

test('células não finitas não corrompem a soma', () => {
  const sujo = { rows: [{ label: 'A' }, { label: 'B' }], cells: [[10, Number.NaN], [5, Infinity]] };
  assert.equal(summarizeTable(sujo).total, 15);
});

test('linha sem célula conta como zero, não quebra', () => {
  const faltando = { rows: [{ label: 'A' }, { label: 'B' }], cells: [[7]] };
  const h = summarizeTable(faltando);
  assert.equal(h.total, 7);
  assert.equal(h.top.at(-1).value, 0);
});

test('a procedência só aparece quando registros foram descartados', () => {
  // "32.017 de 32.017" é ruído; a linha existe para o caso em que a pessoa
  // deve olhar duas vezes.
  assert.equal(describeRecordBasis(summarizeTable(sinasc), fmt), null);

  const filtrado = summarizeTable({ ...sinasc, recordsAccepted: 31_104, recordsSeen: 32_017 });
  assert.equal(describeRecordBasis(filtrado, fmt),
    '31.104 de 32.017 registros · 913 fora dos filtros');
});

test('sem contagem de registros, não há linha de procedência', () => {
  const semContagem = summarizeTable({ rows: [{ label: 'A' }], cells: [[1]] });
  assert.equal(describeRecordBasis(semContagem, fmt), null);
});

test('tabela com várias colunas soma a linha inteira', () => {
  const cruzada = {
    rows: [{ label: 'Masc' }, { label: 'Fem' }],
    cells: [[10, 20, 30], [5, 5, 5]],
  };
  const h = summarizeTable(cruzada);
  assert.equal(h.total, 75);
  assert.equal(h.top[0].label, 'Masc');
  assert.equal(h.top[0].value, 60);
});
