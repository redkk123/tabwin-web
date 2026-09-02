import assert from 'node:assert/strict';
import test from 'node:test';

import { describeParsedQuestion, parseQuestion } from '../dist/packages/acquisition/src/question-parser.js';

const topo = (pergunta) => parseQuestion(pergunta).matches[0];

test('óbitos infantis resolve para SIM/DOINF, não para o DO genérico', () => {
  // A distinção que importa: quem escreve "infantis" quer o arquivo específico.
  // Casar só com "óbitos" devolveria a mortalidade inteira e a pessoa baixaria
  // um arquivo muito maior para responder outra pergunta.
  const m = topo('óbitos infantis 2023');
  assert.equal(m.system, 'SIM');
  assert.equal(m.fileType, 'DOINF');
  assert.equal(m.year, '2023');
});

test('nascidos vivos resolve para SINASC/DN', () => {
  const m = topo('nascidos vivos 2024');
  assert.equal(m.system, 'SINASC');
  assert.equal(m.fileType, 'DN');
});

test('a linguagem de quem pergunta vale tanto quanto a do catálogo', () => {
  // Ninguém digita "declarações de óbito"; digita "mortes". A tabela de
  // sinônimos existe para esse vão, e sem ela a busca só serve a quem já sabe.
  assert.equal(topo('mortes em 2022').system, 'SIM');
  assert.equal(topo('partos 2023').system, 'SINASC');
  assert.equal(topo('internações MG 2020').system, 'SIHSUS');
});

test('CID conhecido aponta direto para o agravo', () => {
  const m = topo('A90 2025');
  assert.equal(m.system, 'SINAN');
  assert.equal(m.fileType, 'DENG');
  assert.match(m.because.join(' '), /A90/);
});

test('o nome do estado é entendido, e não vira termo de busca', () => {
  // "São Paulo" precisa virar UF. Se sobrasse no texto, "sp" casaria com o
  // tipo SP do SIH — serviços profissionais — e o resultado seria outro dado.
  const p = parseQuestion('internações em São Paulo 2021');
  assert.equal(p.uf, 'SP');
  assert.equal(p.matches[0].system, 'SIHSUS');
  assert.ok(!p.subject.includes('sao'), `sobrou o estado no assunto: ${p.subject}`);
});

test('a sigla da UF não é confundida com tipo de arquivo', () => {
  const p = parseQuestion('nascidos vivos RJ 2023');
  assert.equal(p.uf, 'RJ');
  assert.equal(p.matches[0].fileType, 'DN');
});

test('estado de nome composto ganha do prefixo que também é estado', () => {
  // "Mato Grosso do Sul" contém "Mato Grosso". Casar o mais longo primeiro é o
  // que impede MS de virar MT.
  assert.equal(parseQuestion('óbitos Mato Grosso do Sul 2022').uf, 'MS');
  assert.equal(parseQuestion('óbitos Mato Grosso 2022').uf, 'MT');
});

test('o ano não compete com os rótulos', () => {
  const p = parseQuestion('dengue 2024');
  assert.equal(p.year, '2024');
  assert.ok(!p.subject.includes('2024'));
});

test('num intervalo, o ano mais recente é o escolhido', () => {
  assert.equal(parseQuestion('dengue de 2020 a 2023').year, '2023');
});

test('arquivo só nacional recebe Brasil, mesmo com UF pedida', () => {
  // Pedir DOINF do Paraná devolveria busca vazia: o arquivo é nacional e a UF
  // se escolhe depois, no filtro. Forçá-la aqui seria prometer o impossível.
  const m = topo('óbitos infantis Paraná 2023');
  assert.equal(m.fileType, 'DOINF');
  assert.equal(m.uf, 'BR');
});

test('pergunta ambígua devolve opções, não um palpite', () => {
  const p = parseQuestion('câncer');
  assert.ok(p.matches.length > 1, 'ambiguidade real precisa aparecer como escolha');
  const sistemas = new Set(p.matches.map((m) => m.system));
  assert.ok(sistemas.size > 1, `esperava mais de um sistema, veio ${[...sistemas]}`);
});

test('cada resultado diz por que apareceu', () => {
  // Sem isso a busca é um oráculo: a pessoa não tem como saber se ele entendeu
  // a pergunta dela ou acertou por acaso.
  for (const m of parseQuestion('óbitos maternos 2023').matches) {
    assert.ok(m.because.length, `${m.label} apareceu sem justificativa`);
  }
});

test('pergunta sem sentido não inventa resultado', () => {
  const p = parseQuestion('asdfgh qwerty');
  assert.deepEqual(p.matches, []);
  assert.match(describeParsedQuestion(p), /não reconheci/i);
});

test('a descrição diz o que foi entendido, em uma linha', () => {
  assert.equal(describeParsedQuestion(parseQuestion('óbitos infantis 2023')),
    'SIM · Óbitos infantis · 2023 · Brasil');
});

test('sem ano, um sistema anual avisa que falta escolher', () => {
  assert.match(describeParsedQuestion(parseQuestion('nascidos vivos')), /ano a escolher/);
});

test('os resultados vêm ordenados por força da evidência', () => {
  const { matches } = parseQuestion('óbitos infantis 2023');
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1].score >= matches[i].score, 'a ordem precisa ser decrescente');
  }
});
