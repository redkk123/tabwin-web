import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuxiliarySearchBody,
  buildAvailabilityManifest,
  buildDownloadBody,
  buildSearchBody,
  catalogCapabilities,
  compareSourceManifests,
  createSourceManifest,
  deduplicateRemoteFiles,
  expandDatasusSearchSelection,
  fileTypesForSystem,
  parsePreparedDownloadResponse,
  parseSearchResponse,
  parseSourceManifest,
  serializeSourceManifest,
  systemIsAnnual,
  verifiedAuxiliaryBundleName,
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

test('expands multi-UF and multi-period selections in a stable, deduplicated order', () => {
  const expected = [
    { system: 'SIHSUS', fileType: 'RD', year: '2023', month: '01', uf: 'AC' },
    { system: 'SIHSUS', fileType: 'RD', year: '2023', month: '01', uf: 'SP' },
    { system: 'SIHSUS', fileType: 'RD', year: '2023', month: '02', uf: 'AC' },
    { system: 'SIHSUS', fileType: 'RD', year: '2023', month: '02', uf: 'SP' },
    { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC' },
    { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'SP' },
    { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '02', uf: 'AC' },
    { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '02', uf: 'SP' },
  ];
  assert.deepEqual(expandDatasusSearchSelection({
    system: 'SIHSUS', fileType: 'RD', years: ['2024', '2023', '2024'],
    months: ['02', '01', '02'], ufs: ['SP', 'AC', 'SP'],
  }), expected);
  assert.deepEqual(expandDatasusSearchSelection({
    system: 'SIHSUS', fileType: 'RD', years: ['2023', '2024'],
    months: ['01', '02'], ufs: ['AC', 'SP'],
  }), expected);
  assert.deepEqual(expandDatasusSearchSelection({
    system: 'SIM', fileType: 'DO', years: ['2024'], annual: true,
  }), [{ system: 'SIM', fileType: 'DO', year: '2024' }]);
  assert.deepEqual(expandDatasusSearchSelection({
    system: 'SIM', fileType: 'DO', years: ['2024'], ufs: ['BR', 'AC'], annual: true,
  }), [
    { system: 'SIM', fileType: 'DO', year: '2024', uf: 'AC' },
    { system: 'SIM', fileType: 'DO', year: '2024', uf: 'BR' },
  ]);
  // Regression: national coverage must travel as an explicit BR token. The
  // official endpoint returns an empty catalog when uf[] is omitted for
  // SINAN/DENG, SINASC/DNEX, SIM/DO and PO/PO, observed on 2026-08-28.
  assert.deepEqual(expandDatasusSearchSelection({
    system: 'SINAN', fileType: 'DENG', years: ['2024'], ufs: ['BR'], annual: true,
  }), [{ system: 'SINAN', fileType: 'DENG', year: '2024', uf: 'BR' }]);
  assert.equal(buildSearchBody({
    system: 'SINAN', fileType: 'DENG', year: '2024', uf: 'BR',
  }).getAll('uf[]').join(), 'BR');

  assert.throws(() => expandDatasusSearchSelection({
    system: 'SIHSUS', fileType: 'RD', years: [], months: ['01'], ufs: ['AC'],
  }), /pelo menos um ano/);
  assert.throws(() => expandDatasusSearchSelection({
    system: 'SIHSUS', fileType: 'RD', years: ['2024'], months: [], ufs: ['AC'],
  }), /pelo menos um mês/);
});

test('deduplicates overlapping catalog files with an auditable stable order', () => {
  const ac = { source: 'SIHSUS', modality: 'Dados', name: 'RDAC2401.dbc', address: 'ftp://ftp.datasus.gov.br/a/RDAC2401.dbc' };
  const sp = { source: 'SIHSUS', modality: 'Dados', name: 'RDSP2401.dbc', address: 'ftp://ftp.datasus.gov.br/a/RDSP2401.dbc' };
  assert.deepEqual(deduplicateRemoteFiles([sp, ac, ac]), [ac, sp]);
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

test('SINAN catalog mirrors the 58 official data types observed on 2026-08-28', () => {
  const sinan = fileTypesForSystem('SINAN');
  assert.equal(sinan.length, 58);
  assert.deepEqual(sinan.slice(0, 5).map((item) => item.code), ['ACBI', 'ACGR', 'AIDA', 'AIDC', 'ANIM']);
  for (const code of ['CHAG', 'DENG', 'SIFA', 'SIFC', 'SIFG', 'VARC', 'ZIKA']) {
    assert.ok(sinan.some((item) => item.code === code), `missing SINAN ${code}`);
  }
  assert.equal(new Set(sinan.map((item) => item.code)).size, 58);
  assert.ok(sinan.every((item) => item.coverage === 'BR'));
});

test('navigable catalog states period, geography and auxiliary capabilities without inventing availability', () => {
  assert.deepEqual(catalogCapabilities('SIHSUS', 'RD'), {
    system: { code: 'SIHSUS', label: 'SIH/SUS · Internações hospitalares' },
    fileType: { system: 'SIHSUS', code: 'RD', label: 'AIH reduzida', coverage: 'UF' },
    periodicity: 'monthly', geographies: ['UF'], multiplePeriods: true, multipleUfs: true,
    availability: 'verified-at-query-time', auxiliaryResolution: 'verified-automatic',
  });
  const mortality = catalogCapabilities('SIM', 'DO');
  assert.equal(mortality.periodicity, 'annual');
  assert.deepEqual(mortality.geographies, ['BR', 'UF']);
  assert.equal(mortality.auxiliaryResolution, 'explicit-manual');
  assert.throws(() => catalogCapabilities('UNKNOWN', 'X'), /desconhecido/);
  assert.throws(() => catalogCapabilities('SIM', 'UNKNOWN'), /desconhecido/);
});

test('availability manifest reports each official query result including missing periods', () => {
  const available = { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC' };
  const missing = { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '02', uf: 'AC' };
  const manifest = buildAvailabilityManifest([
    { query: available, files: [{ source: 'SIHSUS', modality: 'Dados', name: 'RDAC2401.dbc', address: 'ftp://ftp.datasus.gov.br/RDAC2401.dbc' }] },
    { query: missing, files: [] },
  ]);
  assert.equal(manifest.requestedQueries, 2);
  assert.equal(manifest.availableQueries, 1);
  assert.equal(manifest.fileCount, 1);
  assert.deepEqual(manifest.missingQueries, [missing]);
  assert.equal(manifest.entries[0].status, 'available');
  assert.equal(manifest.entries[1].status, 'missing');
});

test('source manifest is portable, deterministic and recalculates its summary', () => {
  const query = { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC' };
  const availability = buildAvailabilityManifest([{ query, files: [
    { source: 'SIHSUS', modality: 'Dados', name: 'RDAC2401.dbc', address: 'ftp://ftp.datasus.gov.br/RDAC2401.dbc' },
  ] }]);
  const manifest = createSourceManifest('SIHSUS', 'RD', availability, '2026-08-28T12:00:00.000Z');
  const serialized = serializeSourceManifest(manifest);
  assert.equal(serialized, serializeSourceManifest(parseSourceManifest(serialized)));
  const tampered = JSON.parse(serialized);
  tampered.availability.availableQueries = 99;
  assert.equal(parseSourceManifest(JSON.stringify(tampered)).availability.availableQueries, 1);
});

test('source manifest rejects non-official file addresses', () => {
  assert.throws(() => createSourceManifest('SIHSUS', 'RD', {
    requestedQueries: 1, availableQueries: 1, missingQueries: [], fileCount: 1,
    entries: [{
      query: { system: 'SIHSUS', fileType: 'RD', year: '2024', month: '01', uf: 'AC' },
      status: 'available', files: [{ name: 'evil.dbc', address: 'ftp://example.com/evil.dbc' }],
    }],
  }, '2026-08-28T12:00:00.000Z'), /não oficial/);
});

test('source manifest comparison reports file and availability changes without inference', () => {
  const entry = (month, status, name) => ({
    query: { system: 'SIHSUS', fileType: 'RD', year: '2024', month, uf: 'AC' }, status,
    files: name ? [{ name, address: `ftp://ftp.datasus.gov.br/${name}` }] : [],
  });
  const make = (createdAt, entries) => createSourceManifest('SIHSUS', 'RD', {
    requestedQueries: 0, availableQueries: 0, missingQueries: [], fileCount: 0, entries,
  }, createdAt);
  const previous = make('2026-08-27T12:00:00.000Z', [entry('01', 'available', 'same.dbc'), entry('02', 'missing')]);
  const current = make('2026-08-28T12:00:00.000Z', [entry('01', 'available', 'same.dbc'), entry('02', 'available', 'new.dbc')]);
  const diff = compareSourceManifests(previous, current);
  assert.deepEqual(diff.addedFiles.map((file) => file.name), ['new.dbc']);
  assert.deepEqual(diff.unchangedFiles.map((file) => file.name), ['same.dbc']);
  assert.equal(diff.removedFiles.length, 0);
  assert.deepEqual(diff.newlyAvailableQueries.map((query) => query.month), ['02']);
  assert.equal(diff.newlyMissingQueries.length, 0);
  assert.throws(() => compareSourceManifests(previous, createSourceManifest('SIM', 'DO', {
    requestedQueries: 0, availableQueries: 0, missingQueries: [], fileCount: 0, entries: [],
  }, '2026-08-28T12:00:00.000Z')), /diferentes/);
});

test('only the evidence-backed SIH-RD auxiliary relationship is automatic', () => {
  assert.equal(verifiedAuxiliaryBundleName('SIHSUS', 'RD'), 'TAB_SIH.zip');
  assert.equal(verifiedAuxiliaryBundleName('SIHSUS', 'RJ'), null);
  assert.equal(verifiedAuxiliaryBundleName('SIASUS', 'PA'), null);
  assert.equal(verifiedAuxiliaryBundleName('SIM', 'DO'), null);
  assert.equal(verifiedAuxiliaryBundleName('SINASC', 'DN'), null);
  assert.equal(verifiedAuxiliaryBundleName('SINAN', 'DENG'), null);
});
