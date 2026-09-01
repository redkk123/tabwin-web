import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_ALLOWED_ORIGINS,
  bridgeAllowedWebOrigins,
  bridgeFilenameFromUrl,
  describeBridgeAllowlist,
  describeBridgeRejection,
  validateBridgeRedirect,
  validateBridgeUrl,
} from '../dist/packages/acquisition/src/bridge-policy.js';

const PREPARED = 'https://datasus.saude.gov.br/wp-content/zipupload/abc123/arquivo.zip';
const PUBLIC_TREE = 'https://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/DENGBR24.dbc';

test('as duas origens reais do aplicativo são aceitas', () => {
  const prepared = validateBridgeUrl(PREPARED);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.origin.host, 'datasus.saude.gov.br');

  const tree = validateBridgeUrl(PUBLIC_TREE);
  assert.equal(tree.ok, true);
  assert.equal(tree.origin.host, 'ftp.datasus.gov.br');
});

test('host fora da lista é recusado, mesmo parecendo oficial', () => {
  // O ponto do teste é que semelhança não conta: só igualdade de host conta.
  for (const url of [
    'https://datasus.saude.gov.br.exemplo.com/wp-content/zipupload/a/arquivo.zip',
    'https://evil.com/wp-content/zipupload/a/arquivo.zip',
    'https://sub.datasus.saude.gov.br/wp-content/zipupload/a/arquivo.zip',
    'https://datasus-saude.gov.br/wp-content/zipupload/a/arquivo.zip',
  ]) {
    const verdict = validateBridgeUrl(url);
    assert.equal(verdict.ok, false, url);
    assert.equal(verdict.reason, 'host-not-allowed', url);
  }
});

test('host certo com caminho errado também é recusado', () => {
  // Sem checar o caminho, a allowlist entregaria o site inteiro do DATASUS.
  for (const url of [
    'https://datasus.saude.gov.br/wp-admin/algo.zip',
    'https://datasus.saude.gov.br/wp-content/zipupload/a/outro.zip',
    'https://datasus.saude.gov.br/',
    'https://ftp.datasus.gov.br/etc/passwd',
  ]) {
    const verdict = validateBridgeUrl(url);
    assert.equal(verdict.ok, false, url);
    assert.equal(verdict.reason, 'path-not-allowed', url);
  }
});

test('somente https - nada de file, ftp, http ou loopback', () => {
  const cases = [
    ['file:///C:/Windows/System32/config/SAM', 'protocol-not-allowed'],
    ['ftp://ftp.datasus.gov.br/dissemin/publicos/a.dbc', 'protocol-not-allowed'],
    ['http://datasus.saude.gov.br/wp-content/zipupload/a/arquivo.zip', 'protocol-not-allowed'],
    ['http://127.0.0.1:9999/qualquer', 'protocol-not-allowed'],
    ['https://169.254.169.254/latest/meta-data/', 'host-not-allowed'],
    ['https://192.168.0.1/admin', 'host-not-allowed'],
  ];
  for (const [url, reason] of cases) {
    const verdict = validateBridgeUrl(url);
    assert.equal(verdict.ok, false, url);
    assert.equal(verdict.reason, reason, url);
  }
});

test('URL com usuário e senha é recusada antes de qualquer busca', () => {
  const verdict = validateBridgeUrl('https://alguem:segredo@datasus.saude.gov.br/wp-content/zipupload/a/arquivo.zip');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'credentials-not-allowed');
});

test('travessia de caminho não escapa do prefixo permitido', () => {
  // A normalização da URL resolve `..` antes da checagem, então o caminho
  // efetivo é o que vale - e ele sai do prefixo.
  const verdict = validateBridgeUrl('https://datasus.saude.gov.br/wp-content/zipupload/../../wp-config.php');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'path-not-allowed');
});

test('redirecionamento é reavaliado, senão a allowlist valeria só no primeiro salto', () => {
  const escape = validateBridgeRedirect(PREPARED, 'https://evil.com/payload.zip');
  assert.equal(escape.ok, false);
  assert.equal(escape.reason, 'host-not-allowed');

  const downgrade = validateBridgeRedirect(PREPARED, 'http://datasus.saude.gov.br/wp-content/zipupload/a/arquivo.zip');
  assert.equal(downgrade.ok, false);
  assert.equal(downgrade.reason, 'protocol-not-allowed');

  // Relativo resolve contra a origem atual e continua dentro da lista.
  const relative = validateBridgeRedirect(PREPARED, '/wp-content/zipupload/outro/arquivo.zip');
  assert.equal(relative.ok, true);

  // Relativo que sai do prefixo é recusado como qualquer outro.
  const relativeEscape = validateBridgeRedirect(PREPARED, '/wp-admin/x.zip');
  assert.equal(relativeEscape.ok, false);
  assert.equal(relativeEscape.reason, 'path-not-allowed');
});

test('o nome do arquivo é derivado da URL, não aceito de fora', () => {
  // Todo pacote preparado se chama arquivo.zip; sem o identificador do pedido
  // um download sobrescreveria o outro.
  assert.equal(bridgeFilenameFromUrl(PREPARED), 'abc123-arquivo.zip');
  assert.equal(bridgeFilenameFromUrl(PUBLIC_TREE), 'DENGBR24.dbc');
});

test('nome perigoso não sobrevive à derivação', () => {
  const hostile = [
    'https://ftp.datasus.gov.br/dissemin/publicos/..%2F..%2Fevil.exe',
    'https://ftp.datasus.gov.br/dissemin/publicos/arquivo%00.dbc',
    'https://ftp.datasus.gov.br/dissemin/publicos/a%3Astream.dbc',
  ];
  for (const url of hostile) {
    const verdict = validateBridgeUrl(url);
    if (!verdict.ok) continue;
    const name = bridgeFilenameFromUrl(url);
    assert.match(name, /^[A-Za-z0-9._-]+$/, url);
    assert.ok(!name.includes('..'), url);
    assert.ok(!name.includes('/') && !name.includes('\\'), url);
    assert.ok(!name.includes(':'), url);
  }
});

test('nome reservado do Windows é recusado - gravar em CON.zip não cria arquivo', () => {
  assert.throws(
    () => bridgeFilenameFromUrl('https://ftp.datasus.gov.br/dissemin/publicos/CON.zip'),
    /reservado no Windows/,
  );
  assert.throws(
    () => bridgeFilenameFromUrl('https://ftp.datasus.gov.br/dissemin/publicos/LPT1.dbc'),
    /reservado no Windows/,
  );
});

test('derivar nome de URL recusada falha, em vez de devolver algo utilizável', () => {
  assert.throws(() => bridgeFilenameFromUrl('https://evil.com/a.zip'), /URL recusada/);
});

test('toda recusa tem texto legível, para nada ser negado em silêncio', () => {
  const reasons = ['malformed-url', 'protocol-not-allowed', 'host-not-allowed', 'path-not-allowed', 'credentials-not-allowed'];
  for (const reason of reasons) {
    const text = describeBridgeRejection(reason);
    assert.ok(text && text.length > 8, reason);
  }
});

test('a allowlist é publicável: o usuário pode ler o que o auxiliar alcança', () => {
  const lines = describeBridgeAllowlist();
  assert.equal(lines.length, BRIDGE_ALLOWED_ORIGINS.length);
  for (const line of lines) {
    assert.match(line, /^https:\/\//);
    assert.match(line, / — /, 'cada origem precisa dizer para que serve');
  }
});

test('as origens web aceitas não incluem curinga', () => {
  const origins = bridgeAllowedWebOrigins();
  assert.ok(origins.includes('https://redkk123.github.io'));
  assert.ok(!origins.includes('*'));
  for (const origin of origins) assert.match(origin, /^https?:\/\/[^*]+$/);
});
