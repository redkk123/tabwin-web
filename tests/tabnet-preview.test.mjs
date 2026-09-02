import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildTabnetBody, decodeTabnetText, parseTabnetNumber, parseTabnetTable,
} from '../dist/packages/acquisition/src/tabnet-preview.js';

/**
 * A resposta real do TabNet, capturada em 2026-09-02: SINASC 2023, nascimentos
 * por residência da mãe, sexo por cor/raça. Os números batem com o portal.
 */
const pagina = fs.readFileSync('e2e/fixtures/tabnet-sinasc-2023.html', 'latin1');

test('lê a tabela real do TabNet, com os números certos', () => {
  const tabela = parseTabnetTable(pagina);
  assert.equal(tabela.rowLabel, 'Sexo');
  assert.deepEqual(tabela.columns,
    ['Branca', 'Preta', 'Amarela', 'Parda', 'Indígena', 'Ignorado', 'Total']);
  assert.deepEqual(tabela.rows.map((r) => r.label), ['Masc', 'Fem', 'Ign']);
  assert.deepEqual(tabela.rows[0].values,
    [429_346, 100_969, 6_015, 724_223, 15_128, 23_588, 1_299_269]);
});

test('a linha TOTAL sai separada do corpo', () => {
  // O TabNet emite TOTAL como primeira linha do corpo. Misturá-la com as
  // categorias dobraria o total de quem somar as linhas.
  const tabela = parseTabnetTable(pagina);
  assert.equal(tabela.total.values.at(-1), 2_537_576);
  assert.ok(!tabela.rows.some((r) => r.label.toUpperCase() === 'TOTAL'));
});

test('as linhas somam o total que o próprio TabNet declara', () => {
  // Confere o leitor contra a aritmética da própria página: se a extração
  // perdesse uma linha ou uma coluna, esta soma denunciaria.
  const tabela = parseTabnetTable(pagina);
  const somaDasLinhas = tabela.rows.reduce((soma, linha) => soma + linha.values.at(-1), 0);
  assert.equal(somaDasLinhas, tabela.total.values.at(-1));
});

test('ponto é milhar, vírgula é decimal — o oposto de Number()', () => {
  // Trocar os dois faria 2.537.576 virar 2,5. É o erro mais caro possível aqui.
  assert.equal(parseTabnetNumber('2.537.576'), 2_537_576);
  assert.equal(parseTabnetNumber('1.234,5'), 1234.5);
  assert.equal(parseTabnetNumber('402'), 402);
  assert.ok(Number.isNaN(parseTabnetNumber('-')));
  assert.ok(Number.isNaN(parseTabnetNumber('Ign')));
});

test('as entidades latin-1 do TabNet viram texto legível', () => {
  assert.equal(decodeTabnetText('Ind&iacute;gena'), 'Indígena');
  assert.equal(decodeTabnetText('Cor/ra&ccedil;a'), 'Cor/raça');
  assert.equal(decodeTabnetText('a &amp; b'), 'a & b');
});

test('a procedência do dado vem junto, porque data o resultado', () => {
  // "Dados de 2025 - Preliminares" muda o que se pode afirmar. Sem as notas, a
  // prévia pareceria tão definitiva quanto o dado final.
  const { notes } = parseTabnetTable(pagina);
  assert.ok(notes.some((n) => /SINASC/.test(n)), 'faltou a fonte');
  assert.ok(notes.some((n) => /extra[çc]/i.test(n)), 'faltou a data de extração');
});

test('página sem tabela de dados falha alto', () => {
  // O TabNet responde 200 com uma página de erro. Aceitar isso em silêncio
  // devolveria uma tabela vazia como se fosse resultado.
  assert.throws(() => parseTabnetTable('<html><body>Erro</body></html>'),
    /não devolveu uma tabela/);
});

test('o corpo do formulário marca todas as categorias das dimensões livres', () => {
  // Sem `S<Dimensão>=TODAS_AS_CATEGORIAS__`, o TabNet filtra por nada e volta
  // vazio — e uma tabela vazia parece resposta, não erro de pedido.
  const body = buildTabnetBody({
    def: 'sinasc/cnv/nvuf.def',
    row: 'Sexo',
    column: 'Cor/raça',
    measure: 'Nascim_p/resid.mãe',
    files: ['nvuf23.dbf'],
  }, ['Região', 'Sexo']);

  assert.equal(body.get('Linha'), 'Sexo');
  assert.equal(body.get('Coluna'), 'Cor/raça');
  assert.equal(body.get('Arquivos'), 'nvuf23.dbf');
  assert.equal(body.get('SRegião'), 'TODAS_AS_CATEGORIAS__');
  assert.equal(body.get('formato'), 'table');
});

test('sem coluna, o TabNet precisa da marca de dimensão inativa', () => {
  const body = buildTabnetBody({
    def: 'x.def', row: 'Sexo', measure: 'Óbitos', files: ['a.dbf'],
  });
  assert.equal(body.get('Coluna'), '--Não-Ativa--');
});

test('vários arquivos viram várias entradas, não uma lista concatenada', () => {
  const body = buildTabnetBody({
    def: 'x.def', row: 'Sexo', measure: 'Óbitos', files: ['a.dbf', 'b.dbf'],
  });
  assert.deepEqual(body.getAll('Arquivos'), ['a.dbf', 'b.dbf']);
});
