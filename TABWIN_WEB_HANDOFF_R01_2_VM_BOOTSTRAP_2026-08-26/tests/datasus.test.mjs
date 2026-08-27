import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuxiliarySearchBody,
  buildDownloadBody,
  buildSearchBody,
  fileTypesForSystem,
  parsePreparedDownloadResponse,
  parseSearchResponse,
  systemIsAnnual,
} from '../dist/packages/acquisition/src/datasus.js';

test('builds the official DATASUS array-style search request', () => {
  const body = buildSearchBody({ system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC' });
  assert.deepEqual([...body.entries()], [
    ['tipo_arquivo[]', 'RD'],
    ['modalidade[]', '1'],
    ['fonte[]', 'SIHSUS'],
    ['ano[]', '2024'],
    ['mes[]', '01'],
    ['uf[]', 'AC'],
  ]);
  assert.equal(buildAuxiliarySearchBody('SIHSUS').get('tipo_arquivo[]'), 'AUX');
});

test('accepts only official DATASUS FTP catalog entries', () => {
  const files = parseSearchResponse(JSON.stringify([
    {
      fonte: 'SIHSUS',
      modalidade: 'Dados',
      arquivo: 'RDAC2401.dbc',
      endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SIHSUS/200801_/Dados/RDAC2401.dbc',
    },
    { arquivo: 'evil.dbc', endereco: 'ftp://example.com/evil.dbc' },
  ]));
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'RDAC2401.dbc');

  const body = buildDownloadBody(files);
  assert.equal(body.get('dados[0][arquivo]'), 'RDAC2401.dbc');
});

test('accepts only the official prepared HTTPS download location', () => {
  const url = parsePreparedDownloadResponse(
    '[["https:\\/\\/datasus.saude.gov.br\\/wp-content\\/zipupload\\/Arq_123\\/arquivo.zip"]]',
  );
  assert.equal(url, 'https://datasus.saude.gov.br/wp-content/zipupload/Arq_123/arquivo.zip');
  assert.throws(
    () => parsePreparedDownloadResponse('["https://example.com/arquivo.zip"]'),
    /download HTTPS válido/,
  );
});

test('catalog exposes major systems without changing analytical semantics', () => {
  assert.ok(fileTypesForSystem('SIHSUS').some((item) => item.code === 'RD'));
  assert.ok(fileTypesForSystem('SINAN').some((item) => item.code === 'DENG'));
  assert.equal(systemIsAnnual('SIM'), true);
  assert.equal(systemIsAnnual('SIHSUS'), false);
});

