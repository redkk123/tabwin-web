import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorklist, describeWorklistPlan, parseWorklist, planWorklist, serializeWorklist,
} from '../dist/packages/acquisition/src/worklist.js';

const item = (name, extra = {}) => ({ name, system: 'SIHSUS', fileType: 'RD', year: '2024', ...extra });

test('a lista sobrevive a ida e volta pelo arquivo', () => {
  // É o ponto inteiro da funcionalidade: salvar num aparelho, abrir noutro.
  const original = createWorklist('Chagas nacional', [
    item('RDPR2401.dbc', { uf: 'PR', sha256: 'aaa' }),
    item('RDSP2401.dbc', { uf: 'SP' }),
  ], '2026-09-02T00:00:00.000Z');
  const lida = parseWorklist(serializeWorklist(original));
  assert.deepEqual(lida, original);
});

test('pedir o mesmo arquivo duas vezes não vira dois downloads', () => {
  const lista = createWorklist('x', [item('RDPR2401.dbc'), item('rdpr2401.DBC')]);
  assert.equal(lista.items.length, 1);
});

test('separa o que já está aqui do que falta', () => {
  const lista = createWorklist('Chagas', [
    item('a.dbc', { sha256: 'aqui' }),
    item('b.dbc', { sha256: 'nao-aqui' }),
  ]);
  const plano = planWorklist(lista, ['aqui', 'outro']);
  assert.deepEqual(plano.present.map((i) => i.name), ['a.dbc']);
  assert.deepEqual(plano.missing.map((i) => i.name), ['b.dbc']);
});

test('item sem impressão é "não sei", nunca "falta"', () => {
  // Chamar de ausente mandaria a pessoa rebaixar o que talvez já tenha, e
  // baixar de novo é justamente o custo que esta lista existe para evitar.
  const lista = createWorklist('x', [item('c.dbc')]);
  const plano = planWorklist(lista, ['aqui']);
  assert.equal(plano.missing.length, 0);
  assert.deepEqual(plano.unknown.map((i) => i.name), ['c.dbc']);
});

test('a frase de estado diz os três grupos quando existem', () => {
  const lista = createWorklist('Chagas', [
    item('a.dbc', { sha256: 'aqui' }), item('b.dbc', { sha256: 'longe' }), item('c.dbc'),
  ]);
  const frase = describeWorklistPlan(lista, planWorklist(lista, ['aqui']));
  assert.equal(frase, 'Chagas: 1 de 3 já neste aparelho · 1 a baixar · 1 sem impressão registrada');
});

test('trabalho completo não menciona o que não existe', () => {
  const lista = createWorklist('Pronto', [item('a.dbc', { sha256: 'aqui' })]);
  assert.equal(describeWorklistPlan(lista, planWorklist(lista, ['aqui'])),
    'Pronto: 1 de 1 já neste aparelho');
});

test('arquivo que não é lista de trabalho é recusado com o motivo', () => {
  assert.throws(() => parseWorklist('não é json'), /não é JSON válido/);
  assert.throws(() => parseWorklist('{"schema":"outra-coisa"}'), /não é uma lista de trabalho/);
  assert.throws(() => parseWorklist('{"schema":"tabwin-web.worklist","version":9,"items":[]}'), /versão 9/);
});

test('itens sem nome, sistema ou tipo são descartados, não adivinhados', () => {
  const bruto = JSON.stringify({
    schema: 'tabwin-web.worklist', version: 1, label: 'x', createdAt: '2026-01-01T00:00:00.000Z',
    items: [
      { name: 'bom.dbc', system: 'SIM', fileType: 'DO' },
      { name: 'sem-sistema.dbc', fileType: 'DO' },
      { system: 'SIM', fileType: 'DO' },
      null,
    ],
  });
  const lista = parseWorklist(bruto);
  assert.deepEqual(lista.items.map((i) => i.name), ['bom.dbc']);
});

test('lista sem nenhum item utilizável falha alto', () => {
  // Aceitar uma lista vazia faria a tela dizer "0 a baixar", que soa como
  // trabalho concluído quando na verdade o arquivo estava corrompido.
  const vazia = JSON.stringify({
    schema: 'tabwin-web.worklist', version: 1, label: 'x', items: [{ name: 'só-nome.dbc' }],
  });
  assert.throws(() => parseWorklist(vazia), /nenhum item utilizável/);
});

test('hash vazio no aparelho não casa com item sem impressão', () => {
  const lista = createWorklist('x', [item('a.dbc', { sha256: '' })]);
  const plano = planWorklist(lista, ['']);
  assert.equal(plano.present.length, 0);
  assert.equal(plano.unknown.length, 1);
});
