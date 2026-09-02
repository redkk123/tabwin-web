import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogAnswerIsFresh,
  catalogAnswerTtlMs,
  catalogQueryKey,
  describeCatalogMemory,
  planCatalogLookups,
} from '../dist/packages/acquisition/src/catalog-memory.js';

const AGORA = Date.UTC(2026, 8, 2);
const DIA = 24 * 60 * 60 * 1000;
const q = (year, extra = {}) => ({ system: 'SINASC', fileType: 'DN', year, uf: 'BR', ...extra });

test('a chave não muda de forma quando um campo opcional falta', () => {
  assert.equal(catalogQueryKey(q('1996')), 'SINASC|DN|1996||BR');
  assert.equal(catalogQueryKey({ system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC' }),
    'SIHSUS|RD|2024|01|AC');
  // Duas consultas iguais precisam dar a mesma chave, senão o cache nunca acerta.
  assert.equal(catalogQueryKey(q('1996')), catalogQueryKey(q('1996')));
  // E consultas diferentes não podem colidir.
  assert.notEqual(catalogQueryKey(q('1996')), catalogQueryKey(q('1997')));
});

test('quanto mais assentado o ano, mais tempo a resposta vale', () => {
  // Um arquivo de 1996 não vai deixar de ter sido publicado; perguntar de novo
  // é gastar latência para confirmar o passado.
  const antigo = catalogAnswerTtlMs('missing', '1996', AGORA);
  const anoPassado = catalogAnswerTtlMs('missing', '2025', AGORA);
  const anoCorrente = catalogAnswerTtlMs('missing', '2026', AGORA);
  assert.ok(antigo > anoPassado, 'ano antigo vale mais que o anterior');
  assert.ok(anoPassado > anoCorrente, 'ano anterior vale mais que o corrente');
  assert.equal(anoCorrente, 6 * 60 * 60 * 1000);
});

test('"encontrado" vale mais tempo que "não encontrado", e o motivo é assimétrico', () => {
  // Publicado raramente é despublicado; ausente pode ser publicado a qualquer
  // momento. Errar para o lado de perguntar de novo é o lado seguro.
  for (const ano of ['1996', '2024', '2025', '2026']) {
    assert.ok(
      catalogAnswerTtlMs('found', ano, AGORA) > catalogAnswerTtlMs('missing', ano, AGORA),
      `em ${ano}, "encontrado" precisa durar mais que "não encontrado"`,
    );
  }
});

test('ano ilegível cai no prazo curto em vez de virar cache eterno', () => {
  for (const ruim of [undefined, '', 'abc', '0', '1899']) {
    assert.ok(catalogAnswerTtlMs('missing', ruim, AGORA) <= 6 * 60 * 60 * 1000);
  }
});

test('resposta com data no futuro é descartada, não usada', () => {
  // Relógio mexido ou registro corrompido. Confiar nisso seria guardar para
  // sempre uma resposta que nunca expira.
  const futuro = { answer: 'missing', checkedAt: AGORA + DIA, files: [] };
  assert.equal(catalogAnswerIsFresh(futuro, q('1996'), AGORA), false);
  const invalida = { answer: 'missing', checkedAt: Number.NaN, files: [] };
  assert.equal(catalogAnswerIsFresh(invalida, q('1996'), AGORA), false);
});

test('o plano separa o que já se sabe do que precisa ir ao servidor', () => {
  // O caso real: 48 combinações, 17 delas só para descobrir que não existem.
  const consultas = ['1994', '1995', '1996', '2026'].map((ano) => q(ano));
  const memoria = new Map([
    [catalogQueryKey(q('1994')), { answer: 'missing', checkedAt: AGORA - 10 * DIA, files: [] }],
    [catalogQueryKey(q('1995')), { answer: 'found', checkedAt: AGORA - 10 * DIA, files: [{ name: 'DNBR1995.dbc', address: 'ftp://x', source: 'SINASC', modality: 'Dados' }] }],
    // Ano corrente respondido há dois dias: o prazo curto já venceu.
    [catalogQueryKey(q('2026')), { answer: 'missing', checkedAt: AGORA - 2 * DIA, files: [] }],
  ]);
  const plano = planCatalogLookups(consultas, memoria, AGORA);
  assert.deepEqual(plano.toFetch.map((c) => c.year), ['1996', '2026'],
    '1996 nunca foi consultado e 2026 expirou');
  assert.deepEqual(plano.remembered.map((r) => r.query.year), ['1994', '1995']);
  assert.equal(plano.remembered[0].remembered.answer, 'missing',
    'lembrar que NÃO existe é o que economiza as viagens caras');
});

test('memória vazia manda tudo para o servidor', () => {
  const consultas = ['1994', '1995'].map((ano) => q(ano));
  const plano = planCatalogLookups(consultas, new Map(), AGORA);
  assert.equal(plano.toFetch.length, 2);
  assert.equal(plano.remembered.length, 0);
});

test('a interface é obrigada a dizer o que veio de memória', () => {
  // "Não encontrado" lembrado é diferente de "não encontrado" perguntado
  // agora, e o usuário tem direito de saber qual dos dois está vendo.
  assert.equal(describeCatalogMemory(0, 48), '');
  assert.match(describeCatalogMemory(17, 48), /17 das 48/);
  assert.match(describeCatalogMemory(17, 48), /consultas anteriores ao catálogo oficial/);
  assert.match(describeCatalogMemory(17, 48), /Consultar de novo/);
  assert.match(describeCatalogMemory(48, 48), /Todas as/);
});
