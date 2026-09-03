import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildTabnetBody,
  decodeTabnetText,
  parseTabnetNumber,
  parseTabnetTable,
  parseTabnetForm,
  selectTabnetFilesForYear,
  findTabnetDef,
  TABNET_DEFS,
  encodeTabnetBody,
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

const FORMULARIO = [
  '<SELECT NAME="Linha" ID="L" SIZE=4 >',
  '    <OPTION VALUE="Regi\u00e3o" SELECTED>Regi&atilde;o',
  '    <OPTION VALUE="Unidade_da_Federa\u00e7\u00e3o">Unidade da Federa&ccedil;&atilde;o',
  '</SELECT>',
  '<SELECT NAME="Coluna" ID="C" SIZE=4>',
  '    <OPTION VALUE="--N\u00e3o-Ativa--" SELECTED>N&atilde;o ativa',
  '</SELECT>',
  '<SELECT NAME="Incremento" ID="I" SIZE=4 MULTIPLE>',
  '    <OPTION VALUE="Nascim_p/resid.m\u00e3e" SELECTED>Nascim p/resid.m&atilde;e',
  '</SELECT>',
  '<SELECT scrolling="auto" class="fundo_select_tabnet" NAME="Arquivos" SIZE=4 MULTIPLE>',
  '    <OPTION VALUE="nvuf24.dbf" SELECTED >2024',
  '    <OPTION VALUE="nvuf23.dbf">2023',
  '</SELECT>',
].join('\r\n');

test('o leitor de formulário extrai as quatro listas do .def', () => {
  const form = parseTabnetForm(FORMULARIO);
  assert.equal(form.rows.length, 2);
  assert.equal(form.columns.length, 1);
  assert.equal(form.measures.length, 1);
  assert.equal(form.files.length, 2);
});

test('o rótulo vem sem entidades e o valor vem intacto para o POST', () => {
  // O valor viaja byte a byte no corpo; "consertar" o acento nele faria o
  // TabNet não reconhecer a opção. Só o rótulo é para gente ler.
  const [primeira] = parseTabnetForm(FORMULARIO).rows;
  assert.equal(primeira.label, 'Região');
  assert.equal(primeira.value, 'Região');
  assert.equal(primeira.selected, true);
  assert.equal(parseTabnetForm(FORMULARIO).measures[0].label, 'Nascim p/resid.mãe');
});

test('o leitor acha o SELECT mesmo com atributos antes do NAME', () => {
  // O de Arquivos vem com class e scrolling na frente; ancorar na forma da tag
  // em vez do nome faria justamente esse — o dos anos — ser o que se perde.
  const arquivos = parseTabnetForm(FORMULARIO).files;
  assert.deepEqual(arquivos.map((a) => a.label), ['2024', '2023']);
  assert.deepEqual(arquivos.map((a) => a.value), ['nvuf24.dbf', 'nvuf23.dbf']);
});

test('o leitor devolve lista vazia quando o SELECT não existe', () => {
  assert.deepEqual(parseTabnetForm('<html>sem formulário</html>').rows, []);
});

test('o período é escolhido pelo ano que aparece no rótulo', () => {
  const arquivos = parseTabnetForm(FORMULARIO).files;
  assert.deepEqual(selectTabnetFilesForYear(arquivos, 2023).map((a) => a.value), ['nvuf23.dbf']);
  assert.deepEqual(selectTabnetFilesForYear(arquivos, 1998), []);
});

test('um ano dentro de outro número não conta como o ano', () => {
  // "12023" não é 2023. Sem as bordas, um rótulo com código junto casaria.
  const enganoso = [{ value: 'x.dbf', label: '12023', selected: false }];
  assert.deepEqual(selectTabnetFilesForYear(enganoso, 2023), []);
});

test('o mapa de .def só responde pelos pares que foram sondados', () => {
  assert.equal(findTabnetDef('SINASC', 'DN'), 'sinasc/cnv/nvuf.def');
  assert.equal(findTabnetDef('sinasc', 'dn'), 'sinasc/cnv/nvuf.def');
  assert.equal(findTabnetDef('SIM', 'DOINF'), 'sim/cnv/inf10uf.def');
  // SIH ficou de fora de propósito: o .def não respondeu na sondagem.
  assert.equal(findTabnetDef('SIHSUS', 'RD'), undefined);
  assert.equal(findTabnetDef('CNES', 'ST'), undefined);
});

test('todo .def do mapa tem a forma que o proxy aceita', () => {
  // Se um .def entrar aqui fora do formato, a prévia falha com 400 e o motivo
  // fica escondido no proxy. Melhor travar na fonte.
  for (const def of Object.values(TABNET_DEFS)) {
    assert.match(def, /^[a-z0-9_]+\/[a-z0-9_]+\/[a-z0-9_]+\.def$/i, def);
  }
});

test('o corpo do POST sai em latin-1, não em UTF-8', () => {
  // Este é o detalhe que decide se a tabulação volta certa ou vem vazia: o
  // TabNet lê byte a byte em latin-1. Em UTF-8, "Região" viraria Regi%C3%A3o
  // e ele não reconheceria a opção.
  const body = new URLSearchParams();
  body.append('Linha', 'Região');
  assert.equal(encodeTabnetBody(body), 'Linha=Regi%E3o');
  assert.notEqual(encodeTabnetBody(body), body.toString());
});

test('o corpo preserva os caracteres que não precisam de escape', () => {
  const body = new URLSearchParams();
  body.append('Arquivos', 'nvuf23.dbf');
  body.append('mostre', 'Mostra');
  assert.equal(encodeTabnetBody(body), 'Arquivos=nvuf23.dbf&mostre=Mostra');
});

test('o corpo escapa o que separaria os campos', () => {
  // Um & ou = solto no valor viraria outro campo, e a tabulação sairia de
  // outra coisa sem nenhum erro aparecer.
  const body = new URLSearchParams();
  body.append('Incremento', 'Nascim_p/resid.mãe');
  const saida = encodeTabnetBody(body);
  assert.equal(saida, 'Incremento=Nascim_p%2Fresid.m%E3e');
  assert.equal(saida.split('&').length, 1);
});

test('o corpo recusa o que não cabe em latin-1', () => {
  // Mandar "?" no lugar esconderia o erro e devolveria uma tabulação de outra
  // coisa. Falhar aqui diz que o valor não veio do formulário.
  const body = new URLSearchParams();
  body.append('Linha', 'emoji \u{1f600}');
  assert.throws(() => encodeTabnetBody(body), /não cabe em latin-1/);
});

test('o corpo montado pelo buildTabnetBody atravessa a codificação inteiro', () => {
  const codificado = encodeTabnetBody(buildTabnetBody({
    def: 'sinasc/cnv/nvuf.def',
    row: 'Unidade_da_Federação',
    measure: 'Nascim_p/resid.mãe',
    files: ['nvuf23.dbf'],
  }));
  // A volta confirma que nada se perdeu: decodifica byte a byte e compara.
  const decodificado = decodeURIComponent(codificado.replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  assert.match(decodificado, /Linha=Unidade_da_Federação/);
  assert.match(decodificado, /Coluna=--Não-Ativa--/);
  assert.match(decodificado, /Arquivos=nvuf23.dbf/);
  assert.match(decodificado, /mostre=Mostra/);
});
