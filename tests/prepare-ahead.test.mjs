import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PREPARED_URL_TTL_MS,
  nextToPrepare,
  preparedUrlIsUsable,
} from '../dist/packages/acquisition/src/prepare-ahead.js';

const AGORA = 1_700_000_000_000;

test('uma URL prestes a vencer não serve para começar um download longo', () => {
  // Trocar cinco segundos de espera por um download que falha no meio é um
  // péssimo negócio. A margem existe para isso.
  assert.equal(preparedUrlIsUsable({ url: 'https://x', preparedAt: AGORA }, AGORA), true);
  assert.equal(
    preparedUrlIsUsable({ url: 'https://x', preparedAt: AGORA - (PREPARED_URL_TTL_MS - 60_000) }, AGORA),
    true,
    'um minuto de folga ainda serve',
  );
  assert.equal(
    preparedUrlIsUsable({ url: 'https://x', preparedAt: AGORA - (PREPARED_URL_TTL_MS - 10_000) }, AGORA),
    false,
    'dez segundos de folga não servem para um download de minutos',
  );
  assert.equal(
    preparedUrlIsUsable({ url: 'https://x', preparedAt: AGORA - PREPARED_URL_TTL_MS }, AGORA),
    false,
  );
});

test('preparação ausente, vazia ou com data impossível é recusada', () => {
  assert.equal(preparedUrlIsUsable(undefined, AGORA), false);
  assert.equal(preparedUrlIsUsable({ url: '', preparedAt: AGORA }, AGORA), false);
  assert.equal(preparedUrlIsUsable({ url: 'https://x', preparedAt: Number.NaN }, AGORA), false);
  // Data no futuro é relógio mexido: assumir que vale seria assumir o pior
  // caso em silêncio.
  assert.equal(preparedUrlIsUsable({ url: 'https://x', preparedAt: AGORA + 1000 }, AGORA), false);
});

test('prepara o próximo, e só o próximo', () => {
  const itens = ['a', 'b', 'c'];
  const semPreparo = () => undefined;
  const alvo = nextToPrepare(itens, 0, semPreparo, new Set(), AGORA);
  assert.deepEqual(alvo, { index: 1, item: 'b' });
  // No último não há próximo.
  assert.equal(nextToPrepare(itens, 2, semPreparo, new Set(), AGORA), undefined);
  assert.equal(nextToPrepare(itens, 5, semPreparo, new Set(), AGORA), undefined);
  assert.equal(nextToPrepare([], 0, semPreparo, new Set(), AGORA), undefined);
});

test('não prepara duas vezes o mesmo arquivo', () => {
  // Disparar duas faz o servidor montar o ZIP duas vezes, o que é justamente
  // a etapa cara que se quer evitar.
  const itens = ['a', 'b'];
  assert.equal(nextToPrepare(itens, 0, () => undefined, new Set([1]), AGORA), undefined);
});

test('não prepara o que já tem preparação válida', () => {
  const itens = ['a', 'b'];
  const valido = () => ({ url: 'https://x', preparedAt: AGORA - 1000 });
  assert.equal(nextToPrepare(itens, 0, valido, new Set(), AGORA), undefined);
  // Mas uma vencida precisa ser refeita.
  const vencido = () => ({ url: 'https://x', preparedAt: AGORA - PREPARED_URL_TTL_MS });
  assert.deepEqual(nextToPrepare(itens, 0, vencido, new Set(), AGORA), { index: 1, item: 'b' });
});
