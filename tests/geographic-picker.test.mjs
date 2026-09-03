import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGeographicPicker,
  codesForSelection,
  filterPicker,
  normalizeForSearch,
} from '../dist/packages/analysis/src/geographic-picker.js';

const NOMES = {
  ufs: {
    15: { sigla: 'PA', nome: 'Pará' },
    35: { sigla: 'SP', nome: 'São Paulo' },
    43: { sigla: 'RS', nome: 'Rio Grande do Sul' },
  },
  municipios: {
    150140: 'Belém',
    150680: 'Santarém',
    355030: 'São Paulo',
    350950: 'Campinas',
    431490: 'Porto Alegre',
  },
};

const contagens = (pares) => new Map(pares);

test('a árvore separa municípios pelo estado do próprio código', () => {
  const p = buildGeographicPicker(contagens([['150140', 10], ['355030', 20], ['150680', 5]]), NOMES);
  assert.deepEqual(p.states.map((e) => e.sigla), ['PA', 'SP']);
  assert.equal(p.states[0].municipalities.length, 2);
  assert.equal(p.states[0].count, 15, 'o total do estado é a soma dos municípios');
});

test('a lista sai dos dados, não das 27 UF fixas', () => {
  // Oferecer um estado sem nenhum registro dá tabela vazia que parece defeito.
  const p = buildGeographicPicker(contagens([['150140', 1]]), NOMES);
  assert.equal(p.states.length, 1);
});

test('estados e municípios saem em ordem de nome, em português', () => {
  // Por código, a lista fica em ordem de região e ninguém acha o que procura.
  const p = buildGeographicPicker(
    contagens([['431490', 1], ['355030', 1], ['150140', 1], ['150680', 1]]),
    NOMES,
  );
  assert.deepEqual(p.states.map((e) => e.name), ['Pará', 'Rio Grande do Sul', 'São Paulo']);
  assert.deepEqual(p.states[0].municipalities.map((m) => m.name), ['Belém', 'Santarém']);
});

test('a ordem não depende da contagem, para o item não fugir do cursor', () => {
  const a = buildGeographicPicker(contagens([['150140', 1], ['150680', 999]]), NOMES);
  const b = buildGeographicPicker(contagens([['150140', 999], ['150680', 1]]), NOMES);
  assert.deepEqual(
    a.states[0].municipalities.map((m) => m.code),
    b.states[0].municipalities.map((m) => m.code),
  );
});

test('código sem nome conhecido é contado e declarado, nunca sumido', () => {
  // Descartar em silêncio faria a soma do filtro não fechar com a da tabela,
  // e ninguém saberia onde foram parar os registros.
  const p = buildGeographicPicker(contagens([['150140', 10], ['999999', 7], ['', 3]]), NOMES);
  assert.equal(p.unknownCount, 10, 'os registros perdidos precisam aparecer');
  assert.deepEqual(p.unknownCodes, ['999999']);
});

test('escolher um estado vira a lista dos municípios dele que existem nos dados', () => {
  // O campo do arquivo é de município; não há campo de UF para comparar, e
  // inventar um daria um filtro que o motor não sabe executar.
  const p = buildGeographicPicker(contagens([['150140', 1], ['150680', 1], ['355030', 1]]), NOMES);
  assert.deepEqual(codesForSelection(p, { states: ['15'], municipalities: [] }), ['150140', '150680']);
});

test('estado e município escolhidos juntos não duplicam código', () => {
  const p = buildGeographicPicker(contagens([['150140', 1], ['150680', 1]]), NOMES);
  const codigos = codesForSelection(p, { states: ['15'], municipalities: ['150140'] });
  assert.deepEqual(codigos, ['150140', '150680']);
  assert.equal(new Set(codigos).size, codigos.length);
});

test('sem escolha nenhuma, nenhum código é aceito', () => {
  const p = buildGeographicPicker(contagens([['150140', 1]]), NOMES);
  assert.deepEqual(codesForSelection(p, { states: [], municipalities: [] }), []);
});

test('a busca acha sem acento e sem caixa', () => {
  // Exigir o acento certo transforma a ferramenta em prova de digitação.
  const p = buildGeographicPicker(contagens([['150140', 1], ['355030', 1]]), NOMES);
  assert.equal(filterPicker(p, 'belem').states[0].municipalities[0].name, 'Belém');
  assert.equal(filterPicker(p, 'SAO PAULO').states.length, 1);
  assert.equal(filterPicker(p, 'pará').states[0].sigla, 'PA');
});

test('buscar por sigla traz o estado inteiro', () => {
  const p = buildGeographicPicker(contagens([['150140', 1], ['150680', 1]]), NOMES);
  const achado = filterPicker(p, 'pa');
  assert.equal(achado.states.length, 1);
  assert.equal(achado.states[0].municipalities.length, 2, 'a sigla deve trazer o estado inteiro');
});

test('buscar por município traz o estado só com o que casou', () => {
  const p = buildGeographicPicker(contagens([['150140', 1], ['150680', 1]]), NOMES);
  const achado = filterPicker(p, 'santar');
  assert.equal(achado.states.length, 1);
  assert.deepEqual(achado.states[0].municipalities.map((m) => m.name), ['Santarém']);
});

test('busca vazia devolve tudo, e busca sem resultado devolve nada', () => {
  const p = buildGeographicPicker(contagens([['150140', 1]]), NOMES);
  assert.equal(filterPicker(p, '   ').states.length, 1);
  assert.equal(filterPicker(p, 'zzzz').states.length, 0);
});

test('a normalização tira acento, caixa e espaço', () => {
  assert.equal(normalizeForSearch('  SÃO Paulo '), 'sao paulo');
  assert.equal(normalizeForSearch('Belém'), 'belem');
  assert.equal(normalizeForSearch(''), '');
});
