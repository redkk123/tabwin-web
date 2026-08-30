/**
 * The DATASUS field-label dictionary is presentation only: it must never be
 * able to change a number, and it must never claim to know a field it does
 * not. These tests pin both properties.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  datasusFieldLabel,
  datasusFieldLabelCount,
} from '../dist/packages/formats/src/datasus-field-labels.js';

test('well-known SINAN notification fields resolve to their published labels', () => {
  assert.equal(datasusFieldLabel('TP_NOT'), 'Tipo de notificação');
  assert.equal(datasusFieldLabel('ID_AGRAVO'), 'Agravo/doença (CID)');
  assert.equal(datasusFieldLabel('DT_SIN_PRI'), 'Data dos primeiros sintomas');
  assert.equal(datasusFieldLabel('CS_GESTANT'), 'Gestante');
  assert.equal(datasusFieldLabel('CLASSI_FIN'), 'Classificação final');
});

test('the other systems this project reads are covered too', () => {
  // SIM, SINASC, SIH, CNES.
  assert.equal(datasusFieldLabel('CAUSABAS'), 'Causa básica (CID-10)');
  assert.equal(datasusFieldLabel('IDADEMAE'), 'Idade da mãe');
  assert.equal(datasusFieldLabel('DIAG_PRINC'), 'Diagnóstico principal (CID-10)');
  assert.equal(datasusFieldLabel('VAL_TOT'), 'Valor total');
  assert.equal(datasusFieldLabel('NOMEFANT'), 'Nome fantasia');
});

test('lookup is case- and whitespace-insensitive, because field names arrive both ways', () => {
  assert.equal(datasusFieldLabel('cs_sexo'), 'Sexo');
  assert.equal(datasusFieldLabel('  CS_SEXO  '), 'Sexo');
});

test('an unknown field has no label at all, so the caller shows the raw name', () => {
  // The honest default: never guess a meaning for a name not in the dictionary.
  assert.equal(datasusFieldLabel('CAMPO_QUALQUER'), undefined);
  assert.equal(datasusFieldLabel('X'), undefined);
  assert.equal(datasusFieldLabel(''), undefined);
});

test('a name shared across systems keeps one consistent meaning', () => {
  // SEXO, IDADE and RACACOR appear in SIM, SINASC and SIH alike and mean the
  // same thing in each - one entry may serve them only because that is true.
  assert.equal(datasusFieldLabel('SEXO'), 'Sexo');
  assert.equal(datasusFieldLabel('IDADE'), 'Idade');
  assert.equal(datasusFieldLabel('RACACOR'), 'Raça/cor');
  // The SINAN spelling of the same concept resolves to the same label.
  assert.equal(datasusFieldLabel('CS_SEXO'), datasusFieldLabel('SEXO'));
  assert.equal(datasusFieldLabel('CS_RACA'), datasusFieldLabel('RACACOR'));
});

test('every label reads as prose, never as another code', () => {
  assert.ok(datasusFieldLabelCount() > 50, 'the dictionary should cover the common layouts');
  for (const name of ['TP_NOT', 'SEXO', 'VAL_TOT', 'CAUSABAS', 'PESO']) {
    const label = datasusFieldLabel(name);
    assert.ok(label, `${name} should have a label`);
    assert.ok(!label.includes('_'), `${name}'s label should read as prose, not a code`);
    assert.equal(label.trim(), label, `${name}'s label should not be padded`);
  }
});

test('a label that is only the field name in prettier case is not worth showing twice', () => {
  // SEXO -> "Sexo" is a correct label but adds nothing, and the UI collapses
  // "Sexo · SEXO" to just SEXO. This pins which entries are in that class, so
  // adding one is a deliberate choice rather than an accident.
  const strip = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const redundant = ['SEXO', 'IDADE', 'ESC', 'OCUP', 'PESO', 'PARTO', 'GESTACAO', 'GRAVIDEZ', 'CONSULTAS', 'MORTE', 'CNES']
    .filter((name) => {
      const label = datasusFieldLabel(name);
      return label !== undefined && strip(label) === strip(name);
    });
  assert.deepEqual(redundant.sort(), ['IDADE', 'SEXO']);

  // Everything else in that sample genuinely says more than its own name -
  // MORTE is "Óbito" and PARTO is "Tipo de parto", not echoes.
  for (const name of ['PESO', 'GESTACAO', 'CONSULTAS', 'CNES', 'ESC', 'OCUP', 'MORTE', 'PARTO']) {
    assert.notEqual(strip(datasusFieldLabel(name)), strip(name), `${name} should carry a real label`);
  }
});
