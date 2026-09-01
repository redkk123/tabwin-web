import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARGE_SELECTION_QUERIES,
  adviseNationalFile,
  describeSelectionCost,
} from '../dist/packages/acquisition/src/selection-advice.js';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

test('o caso real do SINASC: 27 UFs viram 1 arquivo por ano', () => {
  // O caso que custou vinte minutos de espera: todas as UFs, todos os anos.
  const advice = adviseNationalFile({ nationalAvailable: true, selectedUfs: UFS, periods: 31 });
  assert.ok(advice);
  assert.equal(advice.ufsSelected, 27);
  assert.equal(advice.queriesSaved, 26 * 31);
  assert.match(advice.message, /31 download\(s\) em vez de 837/);
  assert.match(advice.message, /filtro depois de abrir/);
});

test('não aconselha quando não há arquivo nacional para aconselhar', () => {
  assert.equal(adviseNationalFile({ nationalAvailable: false, selectedUfs: UFS, periods: 5 }), null);
});

test('uma ou duas UFs não geram aviso — nem todo caso caro merece interrupção', () => {
  // Aviso que aparece sempre vira ruído e some da atenção junto com os que
  // importam. Duas UFs ainda podem ser deliberado e barato.
  assert.equal(adviseNationalFile({ nationalAvailable: true, selectedUfs: ['SP'], periods: 10 }), null);
  assert.equal(adviseNationalFile({ nationalAvailable: true, selectedUfs: ['SP', 'RJ'], periods: 10 }), null);
  assert.ok(adviseNationalFile({ nationalAvailable: true, selectedUfs: ['SP', 'RJ', 'MG'], periods: 10 }));
});

test('escolher Brasil junto não conta como UF', () => {
  // Quem já marcou Brasil não precisa ser aconselhado a marcar Brasil.
  assert.equal(adviseNationalFile({ nationalAvailable: true, selectedUfs: ['BR'], periods: 31 }), null);
  const misto = adviseNationalFile({ nationalAvailable: true, selectedUfs: ['BR', 'SP', 'RJ', 'MG'], periods: 2 });
  assert.equal(misto?.ufsSelected, 3, 'o Brasil não entra na contagem de UFs');
});

test('o custo é declarado em tempo, não só em número', () => {
  // "868 combinações" só assusta quem já sabe que cada uma é uma ida ao
  // servidor. O tempo é o que faz alguém reconsiderar antes de esperar.
  const pequeno = describeSelectionCost(10);
  assert.equal(pequeno.needsConfirmation, false);
  assert.match(pequeno.summary, /10 combinação/);

  const enorme = describeSelectionCost(868);
  assert.equal(enorme.needsConfirmation, true);
  assert.match(enorme.summary, /868 combinação/);
  // Com seis consultas em paralelo, 868 dá ~51s. Escrever "min" aqui seria
  // repetir a estimativa da fila, que deixou de valer quando paralelizei.
  assert.match(enorme.summary, /cerca de \d+s/);
  // E precisa dizer que o download NÃO está nessa conta, senão a estimativa
  // vira promessa quebrada.
  assert.match(enorme.summary, /download.*depois.*demora bem mais/);
});

test('o limite de confirmação é o declarado, sem surpresa nas bordas', () => {
  assert.equal(describeSelectionCost(LARGE_SELECTION_QUERIES).needsConfirmation, false);
  assert.equal(describeSelectionCost(LARGE_SELECTION_QUERIES + 1).needsConfirmation, true);
});

test('a estimativa considera as consultas em paralelo, senão assusta à toa', () => {
  // Em fila, 868 consultas dariam ~5 min; com seis por vez, cerca de 50s.
  // Informar o número da fila depois de ter paralelizado seria mentir para o
  // lado seguro, o que também é mentir.
  const custo = describeSelectionCost(868);
  assert.ok(custo.estimatedSeconds < 120, `esperava menos de 2 min, veio ${custo.estimatedSeconds}s`);
  assert.ok(custo.estimatedSeconds > 20, 'e não pode ser otimista a ponto de ser falso');
});
