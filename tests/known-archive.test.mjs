import assert from 'node:assert/strict';
import test from 'node:test';

import { describeRecognition, recognizeArchive } from '../dist/packages/acquisition/src/known-archive.js';

const AGORA = Date.UTC(2026, 8, 2, 12);
const DIA = 86_400_000;

const guardado = (extra = {}) => ({
  key: 'official-v1:x',
  sha256: 'abc123',
  savedAt: AGORA - 2 * DIA,
  size: 1024,
  sources: [{ name: 'DNBR2024.dbc' }],
  ...extra,
});

test('reconhece o mesmo conteúdo, mesmo com outro nome', () => {
  // O caso que motiva tudo: o portal entrega "arquivo.zip", o R salva
  // "DNBR2024.dbc", e um colega manda "dnbr2024 (1).dbc". Três nomes, um dado.
  const r = recognizeArchive('abc123', [guardado()], 'copia-do-fulano.dbc', AGORA);
  assert.ok(r);
  assert.equal(r.savedAs, 'DNBR2024.dbc');
  assert.equal(r.ageMs, 2 * DIA);
});

test('quando o nome é o mesmo, não repete o nome na mensagem', () => {
  const r = recognizeArchive('abc123', [guardado()], 'DNBR2024.dbc', AGORA);
  assert.equal(r.savedAs, undefined);
  assert.ok(!describeRecognition(r).includes('guardado como'));
});

test('conteúdo diferente não é reconhecido', () => {
  assert.equal(recognizeArchive('outro', [guardado()], 'DNBR2024.dbc', AGORA), null);
});

test('entrada antiga sem hash não produz falso positivo', () => {
  // Cache gravado antes de o programa registrar impressão tem sha vazio.
  // Comparar vazio com vazio casaria todo arquivo com todo arquivo.
  assert.equal(recognizeArchive('', [guardado({ sha256: '' })], 'x.dbc', AGORA), null);
  assert.equal(recognizeArchive('abc123', [guardado({ sha256: '' })], 'x.dbc', AGORA), null);
});

test('cache vazio devolve nulo, sem erro', () => {
  assert.equal(recognizeArchive('abc123', [], 'x.dbc', AGORA), null);
});

test('o tamanho igual sozinho não reconhece nada', () => {
  // Proteção contra a heurística barata que seria tentador usar no lugar do
  // hash: dois arquivos de mesmo tamanho não são o mesmo arquivo.
  const outro = guardado({ sha256: 'zzz', size: 1024 });
  assert.equal(recognizeArchive('abc123', [outro], 'x.dbc', AGORA), null);
});

test('a idade é dita em dias, horas ou hoje, conforme couber', () => {
  const emDias = recognizeArchive('abc123', [guardado()], 'x.dbc', AGORA);
  assert.match(describeRecognition(emDias), /há 2 dias/);

  const emHoras = recognizeArchive('abc123', [guardado({ savedAt: AGORA - 3 * 3_600_000 })], 'x.dbc', AGORA);
  assert.match(describeRecognition(emHoras), /há 3 horas/);

  const recente = recognizeArchive('abc123', [guardado({ savedAt: AGORA - 60_000 })], 'x.dbc', AGORA);
  assert.match(describeRecognition(recente), /hoje/);
});

test('relógio para trás não produz idade negativa', () => {
  const futuro = recognizeArchive('abc123', [guardado({ savedAt: AGORA + DIA })], 'x.dbc', AGORA);
  assert.equal(futuro.ageMs, 0);
  assert.match(describeRecognition(futuro), /hoje/);
});
