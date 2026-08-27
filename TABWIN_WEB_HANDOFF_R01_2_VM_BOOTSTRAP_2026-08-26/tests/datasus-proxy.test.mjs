import assert from 'node:assert/strict';
import test from 'node:test';
import { targetForRequest } from '../apps/datasus-proxy/worker.mjs';

test('DATASUS proxy exposes only fixed official catalog routes', () => {
  assert.equal(targetForRequest('https://proxy.example/catalog'), 'https://datasus.saude.gov.br/wp-content/ftp.php');
  assert.equal(targetForRequest('https://proxy.example/prepare'), 'https://datasus.saude.gov.br/wp-content/download.php');
  assert.throws(() => targetForRequest('https://proxy.example/other'), /unknown proxy route/);
});

test('DATASUS proxy archive route rejects arbitrary URLs', () => {
  const valid = 'https://datasus.saude.gov.br/wp-content/zipupload/Arq_123/arquivo.zip';
  assert.equal(targetForRequest(`https://proxy.example/archive?url=${encodeURIComponent(valid)}`), valid);
  assert.throws(
    () => targetForRequest(`https://proxy.example/archive?url=${encodeURIComponent('https://example.com/arquivo.zip')}`),
    /not an official prepared DATASUS URL/,
  );
});
