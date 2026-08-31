import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { parseTabFile, tabFileNumber, tabFileValue } from '../dist/packages/formats/src/tab-file.js';

const TAB_PATH = 'fixtures/golden/G023/reference-tabwin415/g002.tab';

function realDocument() {
  const bytes = fs.readFileSync(TAB_PATH);
  return parseTabFile(new TextDecoder('windows-1252').decode(bytes));
}

test('G023: the committed golden is byte-identical to the capture', () => {
  // Not ceremony. This file was once committed with its CR bytes stripped by
  // git's automatic line-ending normalization: on Linux it stopped being what
  // TabWin wrote, and the manifest's own hash no longer matched. A golden the
  // version control system rewrites is not a golden, so the recorded hash is
  // checked here rather than trusted.
  const manifest = JSON.parse(fs.readFileSync('fixtures/golden/G023/manifest.json', 'utf8'));
  const recorded = manifest.committedEvidence
    .find((entry) => entry.path === 'reference-tabwin415/g002.tab');
  const bytes = fs.readFileSync(TAB_PATH);
  assert.equal(bytes.length, recorded.bytes);
  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    recorded.sha256.toUpperCase(),
    'the golden on disk is not the capture the manifest records',
  );
});

test('G023: the real .TAB is plain Windows-1252 text with CRLF and no BOM', () => {
  // This is the finding the capture settled, so it is asserted on the bytes
  // rather than trusted from the notes.
  const bytes = fs.readFileSync(TAB_PATH);
  assert.equal(bytes.subarray(0, 3).toString('latin1'), 'NEW', 'no BOM; the file opens on its marker');
  assert.ok(bytes.includes(0x0d) && bytes.includes(0x0a), 'CRLF line endings');
  // Accented text is single-byte, which UTF-8 could not represent this way.
  assert.ok(bytes.includes(0xe7), 'ç as a single 0xE7 byte proves Windows-1252, not UTF-8');
});

test('G023: the structure parses into marker, preamble and the two sections TabWin writes', () => {
  const document = realDocument();
  assert.equal(document.marker, 'NEW');
  assert.deepEqual(document.preamble.map((entry) => entry.key), ['Titulo2']);
  assert.deepEqual(document.sections.map((section) => section.name), ['Opções', 'Arquivos']);
  assert.deepEqual(document.sections[0].entries.map((entry) => entry.key), [
    'DEF', 'PATH', 'Linha', 'Coluna', 'Incremento',
    'Suprime_Linhas_Zeradas', 'Suprime_Colunas_Zeradas', 'Não_Classificados',
  ]);
  // `[Arquivos]` mixes bare file names with key=value lines; both survive.
  assert.deepEqual(document.sections[1].bareLines, ['RDAC2401.dbc']);
  assert.equal(tabFileValue(document, 'Registros_Processados'), '4315');
  assert.equal(document.warnings.length, 0, `parser warnings: ${document.warnings.join('; ')}`);
});

test('G023: the parsed table reproduces G002, captured through a different export path', () => {
  // The strongest check available: G002's golden came from the BIFF .xls, this
  // from the .TAB. If the reader were inventing structure, the two would not
  // agree cell for cell.
  const document = realDocument();
  const g002 = JSON.parse(fs.readFileSync('fixtures/golden/G002/expected/golden-table.json', 'utf8'));

  assert.deepEqual(document.matrix.rowLabels, g002.rows.map((row) => row.label));
  assert.deepEqual(document.matrix.columnLabels, g002.columns.map((column) => column.label));
  assert.deepEqual(document.matrix.cells.map((row) => row.map(tabFileNumber)), g002.cells);
  assert.equal(document.matrix.cornerLabel, 'Complexidade do Procedimento');
});

test("G023: TabWin's own totals are kept apart from the result cells", () => {
  const document = realDocument();
  // Recorded as evidence, never folded into the table - the same rule the
  // other goldens follow.
  assert.deepEqual(document.totals.columnTotals.map(tabFileNumber), [2092, 2223, 0, 0, 0, 0]);
  assert.deepEqual(document.totals.rowTotals.map(tabFileNumber), [0, 4153, 162, 0]);
  assert.equal(tabFileNumber(document.totals.grandTotal), 4315);
  assert.equal(tabFileNumber(document.totals.grandTotal), Number(tabFileValue(document, 'Registros_Processados')));
});

test('totals are found by label, so a category that merely sorts last is not eaten', () => {
  // Positional detection would drop "Zona rural" here and silently shrink the
  // table by a row and a column.
  const text = [
    'NEW',
    '[Opções]',
    'Linha=Zona',
    '"Zona";"A";"B"',
    '"Zona urbana";1;2',
    '"Zona rural";3;4',
  ].join('\r\n');
  const document = parseTabFile(text);
  assert.deepEqual(document.matrix.rowLabels, ['Zona urbana', 'Zona rural']);
  assert.deepEqual(document.matrix.columnLabels, ['A', 'B']);
  assert.equal(document.totals.columnTotals, null);
  assert.equal(document.totals.rowTotals, null);
  assert.equal(document.warnings.length, 2, 'the absent totals are reported, not silently assumed');
});

test('a quoted label containing the separator survives, and doubled quotes unescape', () => {
  const text = ['NEW', '"Campo";"Sim; não";"Aspas ""assim"""', '"Linha 1";7;8'].join('\r\n');
  const document = parseTabFile(text);
  assert.deepEqual(document.matrix.columnLabels, ['Sim; não', 'Aspas "assim"']);
  assert.deepEqual(document.matrix.cells, [['7', '8']]);
});

test('an unreadable cell is null, never a fabricated zero', () => {
  assert.equal(tabFileNumber('4315'), 4315);
  assert.equal(tabFileNumber(''), null);
  assert.equal(tabFileNumber('  '), null);
  assert.equal(tabFileNumber('-'), null);
  assert.equal(tabFileNumber('n/d'), null);
});

test('a lone dot stays a decimal point - stripping it would turn 1.5 into 15', () => {
  // Only integers are evidenced so far, so the reader must not "helpfully"
  // apply pt-BR grouping to a number that shows no sign of it.
  assert.equal(tabFileNumber('1.5'), 1.5);
  // A comma is unambiguous pt-BR decimal notation; dots beside it are grouping.
  assert.equal(tabFileNumber('1.234,5'), 1234.5);
  assert.equal(tabFileNumber('0,25'), 0.25);
});

test('a file with no matrix says so instead of returning an empty table', () => {
  const document = parseTabFile(['NEW', '[Opções]', 'Linha=UF'].join('\r\n'));
  assert.equal(document.matrix, null);
  assert.deepEqual(document.totals, { columnTotals: null, rowTotals: null, grandTotal: null });
  assert.match(document.warnings.join(' '), /matriz de resultado/);
});
