import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIRROR_MAX_AGE_MS,
  describeMirror,
  lookupInMirror,
  parseMirrorManifest,
} from '../dist/packages/acquisition/src/mirror-manifest.js';

const AGORA = Date.UTC(2026, 8, 3, 12);
const DIA = 86_400_000;
const HASH = 'a'.repeat(64);

const manifesto = (extra = {}) => JSON.stringify({
  schema: 'tabwin-web.mirror',
  version: 1,
  baseUrl: 'https://espelho.tabweb.me/',
  updatedAt: new Date(AGORA - DIA).toISOString(),
  entries: [{
    name: 'DNBR2024.dbc',
    path: 'sinasc/DNBR2024.dbc',
    sha256: HASH,
    bytes: 110_613_958,
    fetchedAt: new Date(AGORA - DIA).toISOString(),
    source: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/1996_/Dados/DNRES/DNBR2024.dbc',
  }],
  ...extra,
});

test('lê o manifesto e normaliza a base, sem barra dupla na URL', () => {
  const lido = parseMirrorManifest(manifesto());
  assert.equal(lido.baseUrl, 'https://espelho.tabweb.me');
  const achado = lookupInMirror(lido, 'DNBR2024.dbc', AGORA);
  assert.equal(achado.url, 'https://espelho.tabweb.me/sinasc/DNBR2024.dbc');
  assert.equal(achado.sha256, HASH);
});

test('entrada sem hash é descartada: sem verificação, é só uma origem não oficial', () => {
  const semHash = manifesto({
    entries: [{ name: 'x.dbc', path: 'x.dbc', source: 'ftp://a/x.dbc' }],
  });
  assert.equal(parseMirrorManifest(semHash).entries.length, 0);
});

test('hash que não é SHA-256 hexadecimal é recusado', () => {
  const torto = manifesto({
    entries: [{ name: 'x.dbc', path: 'x.dbc', sha256: 'nao-e-hash', source: 'ftp://a/x.dbc' }],
  });
  assert.equal(parseMirrorManifest(torto).entries.length, 0);
});

test('manifesto velho não é usado: espelho congelado serve dado velho calado', () => {
  // O DATASUS revisa os arquivos. Um espelho que continua servindo depois de
  // parar de sincronizar é o defeito que criticamos noutro projeto.
  const velho = parseMirrorManifest(manifesto({
    updatedAt: new Date(AGORA - MIRROR_MAX_AGE_MS - DIA).toISOString(),
  }));
  assert.equal(lookupInMirror(velho, 'DNBR2024.dbc', AGORA), null);
  assert.match(describeMirror(velho, AGORA), /velho demais/);
});

test('manifesto sem data não é usado', () => {
  const semData = parseMirrorManifest(manifesto({ updatedAt: '' }));
  assert.equal(lookupInMirror(semData, 'DNBR2024.dbc', AGORA), null);
  assert.match(describeMirror(semData, AGORA), /sem data/);
});

test('arquivo que não está no espelho devolve nulo, não erro', () => {
  // Nulo é "vá ao DATASUS". Lançar faria um espelho incompleto virar falha.
  const lido = parseMirrorManifest(manifesto());
  assert.equal(lookupInMirror(lido, 'DNBR1996.dbc', AGORA), null);
});

test('caminho que sai do bucket é recusado', () => {
  // O manifesto é versionado, mas montar URL com texto de arquivo pede
  // cuidado: `..` ou uma URL absoluta apontariam o download para outro lugar.
  for (const path of ['../fora.dbc', 'a/../../fora.dbc', 'https://outro.example/x.dbc']) {
    const lido = parseMirrorManifest(manifesto({
      entries: [{ name: 'x.dbc', path, sha256: HASH, source: 'ftp://a/x.dbc' }],
    }));
    assert.equal(lookupInMirror(lido, 'x.dbc', AGORA), null, `aceitou ${path}`);
  }
});

test('a busca não distingue maiúsculas do nome', () => {
  const lido = parseMirrorManifest(manifesto());
  assert.ok(lookupInMirror(lido, 'dnbr2024.DBC', AGORA));
});

test('arquivo que não é manifesto de espelho falha alto', () => {
  assert.throws(() => parseMirrorManifest('nada disso'), /não é JSON válido/);
  assert.throws(() => parseMirrorManifest('{"schema":"outro"}'), /não é um manifesto de espelho/);
  assert.throws(
    () => parseMirrorManifest('{"schema":"tabwin-web.mirror","version":7,"entries":[]}'),
    /versão 7/,
  );
  assert.throws(
    () => parseMirrorManifest('{"schema":"tabwin-web.mirror","version":1,"entries":[]}'),
    /não declara baseUrl/,
  );
});

test('a descrição conta quantos arquivos e quando sincronizou', () => {
  assert.equal(describeMirror(parseMirrorManifest(manifesto()), AGORA),
    'Espelho com 1 arquivo(s), sincronizado há 1 dia.');
});
