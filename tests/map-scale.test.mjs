import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMapScale,
  chooseMapColumn,
} from '../dist/packages/visualization/src/map-scale.js';

test('equal-interval map scale produces deterministic class boundaries', () => {
  const scale = createMapScale([0, 25, 50, 75, 100], 'equal-interval', 4, 'green');
  assert.deepEqual(scale.classes.map(({ lower, upper }) => [lower, upper]), [
    [0, 25], [25, 50], [50, 75], [75, 100],
  ]);
  assert.equal(scale.colorFor(undefined), '#dfe8e5');
  assert.equal(scale.colorFor(25), scale.classes[0].color);
  assert.equal(scale.colorFor(26), scale.classes[1].color);
});

test('quantile map scale follows the observed distribution without mutating it', () => {
  const values = [100, 1, 2, 3, 4];
  const original = [...values];
  const scale = createMapScale(values, 'quantile', 2, 'blue');
  assert.deepEqual(values, original);
  assert.deepEqual(scale.classes.map(({ lower, upper }) => [lower, upper]), [[1, 3], [3, 100]]);
});

test('continuous scale gives equal values a stable color', () => {
  const scale = createMapScale([7, 7], 'continuous', 5, 'purple');
  assert.equal(scale.min, 7);
  assert.equal(scale.max, 7);
  assert.equal(scale.colorFor(7), scale.classes.at(-1).color);
});

test('manual map scale uses explicit interior breaks without inventing class count', () => {
  const scale = createMapScale([0, 10, 20, 30, 40], 'manual', 9, 'orange', { manualBreaks: [5, 25] });
  assert.deepEqual(scale.classes.map(({ lower, upper }) => [lower, upper]), [
    [0, 5], [5, 25], [25, 40],
  ]);
  assert.equal(scale.colorFor(5), scale.classes[0].color);
  assert.equal(scale.colorFor(6), scale.classes[1].color);
});

test('manual map scale rejects ambiguous or out-of-range breaks', () => {
  assert.throws(() => createMapScale([0, 100], 'manual', 5, 'green'), /requires at least one break/);
  assert.throws(() => createMapScale([0, 100], 'manual', 5, 'green', { manualBreaks: [50, 50] }), /strictly increasing/);
  assert.throws(() => createMapScale([0, 100], 'manual', 5, 'green', { manualBreaks: [0] }), /strictly inside observed range/);
  assert.throws(() => createMapScale([0, 100], 'manual', 5, 'green', { manualBreaks: [100] }), /strictly inside observed range/);
  assert.throws(() => createMapScale([0, 100], 'manual', 5, 'green', { manualBreaks: [101] }), /strictly inside observed range/);
});

test('com uma coluna só, o mapa pinta ela e não há escolha a declarar', () => {
  const c = chooseMapColumn(['freq'], undefined);
  assert.deepEqual(c, { index: 0, automatic: false });
});

test('com várias colunas e nenhuma pedida, escolhe a primeira e DIZ que escolheu', () => {
  // O defeito que isto conserta era somar casos + população + taxa e pintar o
  // resultado. Qualquer coluna é melhor que a soma, mas a escolha automática
  // precisa aparecer na tela, senão o erro só troca de forma.
  const c = chooseMapColumn(['casos', 'populacao', 'taxa'], undefined);
  assert.equal(c.index, 0);
  assert.equal(c.automatic, true);
});

test('a coluna pedida vale, e não é anunciada como automática', () => {
  const c = chooseMapColumn(['casos', 'populacao', 'taxa'], 'taxa');
  assert.deepEqual(c, { index: 2, automatic: false });
});

test('coluna pedida que não existe mais cai na automática', () => {
  // Acontece ao trocar de arquivo ou desfazer a operação que criou a coluna;
  // apontar para um índice inexistente pintaria o mapa de branco.
  const c = chooseMapColumn(['casos', 'populacao'], 'taxa');
  assert.equal(c.index, 0);
  assert.equal(c.automatic, true);
});

test('sem coluna nenhuma não quebra', () => {
  assert.equal(chooseMapColumn([], undefined).index, 0);
  assert.equal(chooseMapColumn([], 'taxa').index, 0);
});

test('inverter a rampa troca as pontas de lugar', () => {
  // Existe para indicador em que o valor alto é BOM: sem isto a paleta pinta
  // de escuro justamente onde a cobertura foi melhor, e quem bate o olho lê o
  // contrário do que o dado diz.
  const normal = createMapScale([1, 2, 3, 4, 5], 'quantile', 5, 'green');
  const invertida = createMapScale([1, 2, 3, 4, 5], 'quantile', 5, 'green', { invertPalette: true });
  assert.equal(normal.classes.at(0).color, invertida.classes.at(-1).color);
  assert.equal(normal.classes.at(-1).color, invertida.classes.at(0).color);
});

test('inverter não mexe nos limites das classes, só nas cores', () => {
  // Trocar os cortes junto mudaria quais áreas caem em qual classe, e aí o
  // mapa invertido não seria mais o mesmo mapa.
  const normal = createMapScale([1, 5, 9, 20, 100], 'quantile', 4, 'blue');
  const invertida = createMapScale([1, 5, 9, 20, 100], 'quantile', 4, 'blue', { invertPalette: true });
  assert.deepEqual(
    normal.classes.map((c) => [c.minimum, c.maximum]),
    invertida.classes.map((c) => [c.minimum, c.maximum]),
  );
});

test('sem pedir inversão, nada muda', () => {
  const a = createMapScale([1, 2, 3], 'quantile', 3, 'orange');
  const b = createMapScale([1, 2, 3], 'quantile', 3, 'orange', {});
  assert.deepEqual(a.classes.map((c) => c.color), b.classes.map((c) => c.color));
});
