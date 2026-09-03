import assert from 'node:assert/strict';
import test from 'node:test';
import {
  belongsToUf,
  findGeographicFields,
  ufCodeOf,
} from '../dist/packages/analysis/src/geographic-fields.js';

const campos = (...nomes) => nomes.map((name) => ({ name }));

test('acha o campo de município nos sistemas que importam', () => {
  // Cada sistema batiza do seu jeito, e é justamente por isso que a busca
  // por nome existe em vez de uma constante única.
  const casos = [
    ['SIH', campos('N_AIH', 'MUNIC_RES', 'IDADE'), 'MUNIC_RES'],
    ['SIM', campos('CODMUNRES', 'IDADE', 'SEXO'), 'CODMUNRES'],
    ['SINASC', campos('CODMUNNASC', 'SEXO'), 'CODMUNNASC'],
    ['SINAN', campos('ID_MN_RESI', 'NU_IDADE'), 'ID_MN_RESI'],
  ];
  for (const [sistema, lista, esperado] of casos) {
    assert.equal(findGeographicFields(lista)[0]?.field, esperado, sistema);
  }
});

test('residência vem antes de ocorrência', () => {
  // Não é preferência estética: hospital de referência concentra internações
  // de municípios vizinhos, e mapear ocorrência sem dizer responde outra
  // pergunta com um mapa que parece o esperado.
  const achados = findGeographicFields(campos('CODMUNOCOR', 'CODMUNRES'));
  assert.equal(achados[0].field, 'CODMUNRES');
  assert.match(achados[0].reason, /residência/);
});

test('município vem antes de UF, porque dele se obtém a UF', () => {
  const achados = findGeographicFields(campos('UF', 'CODMUNRES'));
  assert.equal(achados[0].field, 'CODMUNRES');
  assert.equal(achados[0].level, 'municipality');
  assert.equal(achados[1].level, 'uf');
});

test('um arquivo sem campo geográfico devolve lista vazia, não um palpite', () => {
  assert.deepEqual(findGeographicFields(campos('SEXO', 'IDADE', 'RACACOR')), []);
});

test('o casamento é pelo nome inteiro, não por pedaço', () => {
  // Sem a âncora, MUNIC casaria dentro de CODMUNOCOR e a ordem de
  // preferência deixaria de valer.
  const achados = findGeographicFields(campos('COD_MUNIC_ANTIGO_TEXTO'));
  assert.deepEqual(achados, []);
});

test('nenhum campo aparece duas vezes, mesmo casando em duas regras', () => {
  const achados = findGeographicFields(campos('UF', 'UF', 'CODMUNRES'));
  assert.equal(new Set(achados.map((a) => a.field)).size, achados.length);
});

test('a UF sai dos dois primeiros dígitos do código do IBGE', () => {
  assert.equal(ufCodeOf('150140'), '15');   // Belém, Pará
  assert.equal(ufCodeOf('355030'), '35');   // São Paulo capital
  assert.equal(ufCodeOf('110001'), '11');   // Alta Floresta D'Oeste, Rondônia
  assert.equal(ufCodeOf('1501402'), '15');  // com dígito verificador
});

test('código implausível vira nulo, não uma UF fantasma', () => {
  // Um "0" ou texto livre viraria a UF 0, que não existe, e mancharia o mapa.
  for (const ruim of ['', '0', '00', '999999', '009999', 'ABCDEF', '12345', '  ', null, undefined]) {
    assert.equal(ufCodeOf(ruim), null, `aceitou ${JSON.stringify(ruim)}`);
  }
});

test('as UF do IBGE vão de 11 a 53', () => {
  assert.equal(ufCodeOf('110000'), '11');
  assert.equal(ufCodeOf('530010'), '53');
  assert.equal(ufCodeOf('100000'), null);
  assert.equal(ufCodeOf('540000'), null);
});

test('isolar um estado aceita os dois níveis do mapa', () => {
  assert.equal(belongsToUf('150140', '15'), true);
  assert.equal(belongsToUf('15', '15'), true, 'o próprio código da UF');
  assert.equal(belongsToUf('355030', '15'), false);
  assert.equal(belongsToUf('lixo', '15'), false);
});
