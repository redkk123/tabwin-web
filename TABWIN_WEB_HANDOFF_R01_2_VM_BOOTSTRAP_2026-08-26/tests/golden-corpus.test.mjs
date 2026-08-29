/**
 * Committed regression over the G002–G005 TabWin 4.15 reference captures.
 *
 * Like `g001.test.mjs`, this parses the original BIFF export independently of
 * the normalization that produced `expected/golden-table.json`, so a bug in
 * the normalizer cannot make its own output agree with itself. The raw
 * DBC/DEF/CNV inputs stay outside Git; running the full executor against them
 * is `scripts/verify-goldens-local.mjs`.
 *
 * These goldens are immutable. A failure here means the code changed, not
 * that the expectation needs updating.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseTabWinBiffExport } from '../dist/packages/formats/src/index.js';

async function readCase(id) {
  const base = new URL(`../fixtures/golden/${id}/`, import.meta.url);
  const bytes = await readFile(new URL('reference-tabwin415/result.xls', base));
  const parsed = parseTabWinBiffExport(bytes);
  const golden = JSON.parse(await readFile(new URL('expected/golden-table.json', base), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  return {
    golden,
    manifest,
    labels: new Map(parsed.labels.map(({ row, column, value }) => [`${row}:${column}`, value])),
    numbers: new Map(parsed.numbers.map(({ row, column, value }) => [`${row}:${column}`, value])),
  };
}

/** Re-reads the export straight from BIFF and asserts it still says what the golden claims. */
async function assertGoldenAgreesWithExport(id) {
  const { golden, labels, numbers, manifest } = await readCase(id);
  for (const [index, column] of golden.columns.entries()) {
    assert.equal(labels.get(`2:${index + 1}`), column.label, `${id}: column ${index} header`);
  }
  for (const [rowIndex, row] of golden.rows.entries()) {
    const exportRow = rowIndex + 3;
    assert.equal(labels.get(`${exportRow}:0`), row.label, `${id}: row ${rowIndex} label`);
    for (const [columnIndex] of golden.columns.entries()) {
      assert.equal(
        numbers.get(`${exportRow}:${columnIndex + 1}`),
        golden.cells[rowIndex][columnIndex],
        `${id}: cell r${rowIndex}c${columnIndex}`,
      );
    }
  }
  return { golden, labels, numbers, manifest };
}

test('G002 export holds a real two-dimensional table with every CNV category present', async () => {
  const { golden, labels, numbers } = await assertGoldenAgreesWithExport('G002');
  assert.equal(labels.get('1:0'), 'Freqüência por Caráter atendimento segundo Complexidade do Procedimento');
  // Six declared categories, not the two that carry data: TabWin does not hide empty columns.
  assert.deepEqual(golden.columns.map((column) => column.label), [
    'Eletivo', 'Urgência', 'Acid local trab', 'Acid trajeto', 'Outros ac trab', 'Outras caus ext',
  ]);
  assert.deepEqual(golden.cells, [
    [0, 0, 0, 0, 0, 0],
    [1968, 2185, 0, 0, 0, 0],
    [124, 38, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ]);
  // TabWin's own Total column/row, kept as evidence rather than compared as cells.
  assert.equal(labels.get('2:7'), 'Total');
  assert.equal(numbers.get('7:7'), 4315);
  assert.equal(numbers.get('7:1'), 2092, 'Eletivo column total, independently confirmed by G004');
});

test('G003 export headers the sum with the DEF increment label, not a generic word', async () => {
  const { golden, numbers } = await assertGoldenAgreesWithExport('G003');
  assert.deepEqual(golden.columns.map((column) => column.label), ['Valor Total']);
  assert.equal(golden.cells[0][0], 0);
  assert.equal(golden.cells[3][0], 0);
  // The exact doubles TabWin produced, preserved so the 1-ULP accumulation
  // finding stays reproducible from the fixture alone.
  assert.equal(golden.cells[1][0], 3016736.9200000037);
  assert.equal(golden.cells[2][0], 1291335.84);
  assert.equal(numbers.get('7:1'), 4308072.7600000035, 'TabWin total equals the sum of its own cells');
  // Whatever the last bits are, the value the user actually sees is the cent.
  assert.equal(golden.cells[1][0].toFixed(2), '3016736.92');
});

test('G004 selection filters before aggregation and drops the excluded records', async () => {
  const { golden, numbers, manifest } = await assertGoldenAgreesWithExport('G004');
  assert.deepEqual(golden.cells, [[0], [1968], [124], [0]]);
  assert.equal(numbers.get('7:1'), 2092);
  assert.equal(manifest.comparison.recordsSeen, 4315);
  assert.equal(manifest.comparison.recordsAccepted, 2092, 'the filter runs before aggregation');
});

test('G005 zero suppression removes the rows entirely without changing what was counted', async () => {
  const { golden, labels, numbers } = await assertGoldenAgreesWithExport('G005');
  assert.deepEqual(golden.rows.map((row) => row.label), ['Média complexidade', 'Alta complexidade']);
  assert.deepEqual(golden.cells, [[4153], [162]]);
  // G001's two zero rows are gone from the export, not blanked or merged.
  const everyRowLabel = [...labels.entries()].filter(([key]) => key.endsWith(':0')).map(([, value]) => value);
  assert.ok(!everyRowLabel.includes('Atenção Básica'), 'suppressed row must be absent, not blank');
  assert.ok(!everyRowLabel.includes('Não se aplica'), 'suppressed row must be absent, not blank');
  assert.equal(numbers.get('5:1'), 4315, 'total still counts every record that was tabulated');
});

test('every committed golden records a passing zero-tolerance comparison and its own evidence hashes', async () => {
  for (const id of ['G002', 'G003', 'G004', 'G005']) {
    const { manifest } = await readCase(id);
    assert.equal(manifest.id, id);
    assert.equal(manifest.comparison.tolerance, 0, `${id}: tolerance must stay zero`);
    assert.equal(manifest.comparison.pass, true, `${id}: recorded comparison must pass`);
    assert.equal(manifest.comparison.cellDiffCount, 0, `${id}: no cell may differ`);
    assert.ok(manifest.committedEvidence.length >= 4, `${id}: evidence files must be hashed`);
    for (const entry of manifest.committedEvidence) {
      assert.match(entry.sha256, /^[0-9A-F]{64}$/, `${id}: ${entry.path} needs a SHA-256`);
    }
  }
});

const SECOND_BATCH_WITH_TABLES = ['G006', 'G008', 'G010', 'G012', 'G014', 'G015', 'G017', 'G018', 'G021'];
const SECOND_BATCH_VERIFIED = ['G006', 'G008', 'G010', 'G014', 'G015', 'G018', 'G021'];

test('every second-batch normalized table agrees cell-for-cell with its original BIFF export', async () => {
  for (const id of SECOND_BATCH_WITH_TABLES) await assertGoldenAgreesWithExport(id);
});

test('the seven executable second-batch cases record zero-tolerance passes and decisive totals', async () => {
  for (const id of SECOND_BATCH_VERIFIED) {
    const { manifest } = await readCase(id);
    assert.equal(manifest.comparison.status, 'verified-zero-tolerance', `${id}: verification status`);
    assert.equal(manifest.comparison.tolerance, 0, `${id}: counts stay exact`);
    assert.equal(manifest.comparison.cellDiffCount, 0, `${id}: no cell differs`);
    assert.equal(manifest.comparison.pass, true, `${id}: executor comparison passes`);
  }
  const g010 = await readCase('G010');
  assert.equal(g010.manifest.tabwinPresentation.tabwinTotals[0], 4315, 'hierarchy total excludes displayed subtotals');
  const g014 = await readCase('G014');
  assert.equal(g014.manifest.comparison.seen, 49338, 'all procedure rows are read');
  assert.equal(g014.manifest.tabwinPresentation.tabwinTotals[0], 4315, 'DEF G weights them to AIH frequency');
  const g021 = await readCase('G021');
  assert.equal(g021.manifest.comparison.seen, 8631, 'both months are combined');
});

test('G012 and G017 preserve new oracle evidence without pretending unsupported semantics pass', async () => {
  for (const id of ['G012', 'G017']) {
    const { manifest } = await readCase(id);
    assert.equal(manifest.comparison.status, 'captured-not-yet-executable');
    assert.equal(manifest.comparison.pass, null);
    assert.ok(manifest.comparison.blocker);
  }
  const g017 = await readCase('G017');
  assert.deepEqual(g017.golden.columns.map((column) => column.label), ['Freqüência', 'Valor Total', 'Óbitos']);
  assert.equal(g017.golden.cells.length, 27);
});

test('second-batch manifests hash the evidence bytes they name, and G009 records the protocol blocker', async () => {
  for (const id of SECOND_BATCH_WITH_TABLES) {
    const base = new URL(`../fixtures/golden/${id}/`, import.meta.url);
    const { manifest } = await readCase(id);
    for (const entry of manifest.committedEvidence) {
      const bytes = await readFile(new URL(entry.path, base));
      assert.equal(bytes.byteLength, entry.bytes, `${id}: ${entry.path} byte count`);
      assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), entry.sha256, `${id}: ${entry.path} hash`);
    }
  }
  const g009Base = new URL('../fixtures/golden/G009/', import.meta.url);
  const g009 = JSON.parse(await readFile(new URL('manifest.json', g009Base), 'utf8'));
  const screenshot = await readFile(new URL(g009.committedEvidence[0].path, g009Base));
  assert.equal(g009.comparison.status, 'capture-blocked');
  assert.match(g009.comparison.blocker, /MA\\MA\\MA\*\.DBC/);
  assert.equal(createHash('sha256').update(screenshot).digest('hex').toUpperCase(), g009.committedEvidence[0].sha256);
});
