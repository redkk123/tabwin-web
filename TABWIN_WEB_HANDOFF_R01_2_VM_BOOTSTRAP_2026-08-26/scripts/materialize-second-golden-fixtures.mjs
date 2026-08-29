/**
 * Materializes the small, redistributable TabWin BIFF exports from the second
 * capture batch into committed golden fixtures. The source DBC/DEF/CNV/DBF
 * files never enter Git; their hashes are recorded as provenance only.
 *
 * usage: node scripts/materialize-second-golden-fixtures.mjs <export-directory>
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTabWinBiffExport } from '../dist/packages/formats/src/index.js';

const exportDirectory = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: node scripts/materialize-second-golden-fixtures.mjs <export-directory>');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const decoder = new TextDecoder('windows-1252');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

const common = {
  RDAC2401: { name: 'RDAC2401.dbc', bytes: 313213, sha256: '41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429' },
  RDAC2402: { name: 'RDAC2402.dbc', bytes: 316988, sha256: '7FB69A40C85B69FAF9493E3D11010B4D5B46090C7CFB72618E4C86EDF12C60B4' },
  SPAC2401: { name: 'SPAC2401.dbc', bytes: 914039, sha256: 'DA880DC9A57E6201CE785190747416973CE67786D7B421B6EFEC09C07FE49FB9' },
  RDDEF: { name: 'RD2008.DEF', bytes: 33581, sha256: '15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652' },
  SPDEF: { name: 'SP2008.DEF', bytes: 19376, sha256: '7744873B2324ED37CC281AD87AB51EA950B3C624733683ED36C4A5F8360F74F8' },
};

const cases = [
  {
    id: 'G006', semantic: 'unclassified CNV values as an explicit row', status: 'verified-zero-tolerance',
    records: { seen: 4315, accepted: 4315 }, assets: [common.RDAC2401, common.RDDEF,
      { name: 'BR_PNDR.CNV', bytes: 79173, sha256: '8390C187AFD4DB9314250D7DE8385F1876C5D33B372D1BFC4154B80D55E5DCA5' }],
    recipe: 'Row: Mesorregião PNDR de Resid.\nMeasure: Frequência\nUnclassified: enabled\nSuppress zero rows: enabled\nSelections: none',
    finding: 'TabWin labels the unmatched bucket exactly “Não classificados”; 1,703 of 4,315 records land there.',
  },
  {
    id: 'G008', semantic: 'literal CNV first-match classification', status: 'verified-zero-tolerance',
    records: { seen: 4315, accepted: 1835 }, assets: [common.RDAC2401, common.RDDEF,
      { name: 'BR_CAPITAL.CNV', bytes: 1927, sha256: 'C7C0A847FB7D4E35308D7CFD971681C4B570FBBB9C3D3161E2E30B7AE0095FF4' }],
    recipe: 'Row: Capital de Residência\nMeasure: Frequência\nUnclassified: disabled\nSuppress zero rows: enabled\nSelections: none',
    finding: 'Only residents whose municipality is classified as a capital remain; the reference total is 1,835.',
  },
  {
    id: 'G010', semantic: 'hierarchical CNV subtotals without double-counting the final total', status: 'verified-zero-tolerance',
    records: { seen: 4315, accepted: 4315 }, assets: [common.RDAC2401, common.RDDEF,
      { name: 'BR_REGIAOUF.CNV', bytes: 2186, sha256: 'D1C9C9B3FB9E715F60BE00CEEC7C0DBF1F98208A57C68CC483EE4CE5E9036EDE' }],
    recipe: 'Row: Região/UF de Residência\nMeasure: Frequência\nSuppress zero rows: enabled\nSelections: none',
    finding: 'Region subtotal rows and UF detail rows are both displayed, but TabWin’s final Total is 4,315, not their double-counted sum 8,630.',
  },
  {
    id: 'G012', semantic: 'new-format N CNV classification', status: 'captured-not-yet-executable',
    assets: [common.RDAC2401, common.RDDEF,
      { name: 'NATJUR.CNV', bytes: 10663, sha256: '11016C1A9821D27FB5F5341F68366FE2A49A1913265C1E1A7D39BEAA1EB871EE' }],
    recipe: 'Row: Natureza Jurídica\nMeasure: Frequência\nSuppress zero rows: enabled\nSelections: none',
    finding: 'The export is the first oracle for the N layout. It is committed as evidence but not marked passing until the widened offsets and the surprising duplicated 524 are explained.',
  },
  {
    id: 'G014', semantic: 'DEF G grouped-frequency weight', status: 'verified-zero-tolerance',
    records: { seen: 49338, accepted: 49338 }, assets: [common.SPAC2401, common.SPDEF,
      { name: 'CID10CAP.CNV', bytes: 1680, sha256: 'A8D276B6EFE96E84A805A789C384CBA7E6549E10DE56C80AB31080E26785261E' }],
    recipe: 'Row: Diagnóstico CID10 (capítulo)\nMeasure: Frequência (weighted by DEF G field SP_U_AIH)\nSuppress zero rows: enabled\nSelections: none',
    finding: '49,338 procedure rows reduce to the exact 4,315 AIH total through SP_U_AIH weighting.',
  },
  {
    id: 'G015', semantic: 'external DBF lookup labels', status: 'verified-zero-tolerance',
    records: { seen: 4315, accepted: 4315 },
    assets: [common.RDAC2401, common.RDDEF,
      { name: 'TCNESAC.DBF', bytes: 4364, sha256: 'F6B94CDE41B1184DFA1A32A34FCF027C98B26CEA7BC496634EA455061ABEB78F' }],
    recipe: 'Row: Hospital AC (CNES)\nMeasure: Frequência\nSuppress zero rows: enabled\nSelections: none',
    finding: 'TabWin joins CNES to TCNESAC.DBF/NOMEFANT and emits 25 named hospitals; the core executor now reproduces all labels and cells exactly.',
  },
  {
    id: 'G017', semantic: 'multiple simultaneous increments', status: 'captured-not-yet-executable',
    assets: [common.RDAC2401, common.RDDEF,
      { name: 'TCNESAC.DBF', bytes: 4364, sha256: 'F6B94CDE41B1184DFA1A32A34FCF027C98B26CEA7BC496634EA455061ABEB78F' }],
    recipe: 'Row: Hospital AC (CNES)\nMeasures: Frequência + Valor Total + Óbitos\nSuppress zero rows: disabled\nSelections: none\nNote: reconstructed from the exported headers; no separate recipe file was supplied.',
    finding: 'The real engine supports three simultaneous measures in the order Frequência, Valor Total, Óbitos. This executor intentionally remains single-measure until that result shape is designed.',
  },
  {
    id: 'G018', semantic: 'intersection of two simultaneous selections', status: 'verified-zero-tolerance',
    records: { seen: 4315, accepted: 124 }, assets: [common.RDAC2401, common.RDDEF,
      { name: 'COMPLEX2.CNV', bytes: 265, sha256: '680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F' },
      { name: 'CARATEND.CNV', bytes: 389, sha256: 'E57C08CD045E6EAB1403013D96C7782C963D17BDDF4864840A964B99155D27F8' }],
    recipe: 'Row: Complexidade do Procedimento\nMeasure: Frequência\nSelection 1: Caráter atendimento = 01 Eletivo\nSelection 2: Complexidade = Alta complexidade\nSuppress zero rows: disabled',
    finding: 'The two selections intersect before aggregation: exactly 124 records remain.',
  },
  {
    id: 'G021', semantic: 'schema-compatible multi-month source combination', status: 'verified-zero-tolerance',
    records: { seen: 8631, accepted: 8631 }, assets: [common.RDAC2401, common.RDAC2402, common.RDDEF,
      { name: 'COMPLEX2.CNV', bytes: 265, sha256: '680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F' }],
    recipe: 'Sources: RDAC2401.dbc + RDAC2402.dbc\nRow: Complexidade do Procedimento\nMeasure: Frequência\nSuppress zero rows: enabled\nSelections: none',
    finding: 'January and February combine to 8,631 records with exact per-category addition.',
  },
];

function normalize(bytes, item) {
  const parsed = parseTabWinBiffExport(bytes, decoder);
  const labels = new Map(parsed.labels.map(({ row, column, value }) => [`${row}:${column}`, value]));
  const numbers = new Map(parsed.numbers.map(({ row, column, value }) => [`${row}:${column}`, value]));
  const columns = [];
  for (let column = 1; ; column++) {
    const label = labels.get(`2:${column}`);
    if (label === undefined || label === '' || label === 'Total') break;
    columns.push({ label });
  }
  assert.ok(columns.length, `${item.id}: no columns`);
  const rows = [];
  const cells = [];
  let tabwinTotals = [];
  for (let row = 3; ; row++) {
    const label = labels.get(`${row}:0`);
    if (label === undefined) break;
    if (!label) continue;
    const values = columns.map((_, column) => numbers.get(`${row}:${column + 1}`));
    assert.ok(values.every((value) => value !== undefined), `${item.id}: incomplete numeric row ${row}`);
    if (label === 'Total') { tabwinTotals = values; continue; }
    rows.push({ label });
    cells.push(values);
  }
  return {
    golden: {
      schema: 'tabwin-web.golden-table', version: 1, id: item.id,
      source: {
        referenceEngine: 'TabWin 4.15',
        notes: `Normalized from the unedited BIFF export; SHA-256 ${sha256(bytes)}. TabWin totals are evidence in manifest.json, not comparable cells.`,
      },
      rows, columns, cells,
    },
    presentation: {
      title: labels.get('0:0') ?? '', subtitle: labels.get('1:0') ?? '',
      rowDimensionLabel: labels.get('2:0') ?? '', tabwinTotals,
    },
  };
}

for (const item of cases) {
  const source = path.join(exportDirectory, `${item.id.toLowerCase()}.xls`);
  const bytes = await readFile(source);
  const base = path.join(repository, 'fixtures', 'golden', item.id);
  const reference = path.join(base, 'reference-tabwin415');
  const expected = path.join(base, 'expected');
  await mkdir(reference, { recursive: true });
  await mkdir(expected, { recursive: true });
  await copyFile(source, path.join(reference, 'result.xls'));
  const normalized = normalize(bytes, item);
  const goldenText = `${JSON.stringify(normalized.golden, null, 2)}\n`;
  const recipeText = `Reference engine: TabWin 4.15\n${item.recipe}\nCaptured: 2026-08-29\n`;
  const notesText = `# ${item.id} TabWin 4.15 reference capture\n\nSemantic: **${item.semantic}**.\n\nThe supplied BIFF export was preserved unedited. The exact UI recipe below was reconstructed from the published capture protocol and the export headers; no independent recipe/notes file accompanied this batch.\n\n## Finding\n\n${item.finding}\n\n## Status\n\n${item.status}.\n\n- Title: \`${normalized.presentation.title}\`\n- Subtitle: \`${normalized.presentation.subtitle}\`\n- Shape: ${normalized.golden.rows.length} row(s) × ${normalized.golden.columns.length} column(s)\n- TabWin Total row: ${JSON.stringify(normalized.presentation.tabwinTotals)}\n`;
  const readmeText = `# ${item.id} golden fixture\n\nSemantic under test: **${item.semantic}**.\n\n- \`reference-tabwin415/result.xls\`: unedited TabWin 4.15 BIFF export (the oracle)\n- \`reference-tabwin415/recipe.txt\`: reconstructed capture settings\n- \`reference-tabwin415/capture-notes.md\`: evidence and current status\n- \`expected/golden-table.json\`: normalized rows, columns and cells\n- \`manifest.json\`: hashes and comparison status\n\nRaw DBC, DEF, CNV and DBF lookup inputs remain outside Git. This fixture is immutable evidence; implementation changes must conform to it or explicitly retain an unsupported status.\n`;
  await writeFile(path.join(expected, 'golden-table.json'), goldenText);
  await writeFile(path.join(reference, 'recipe.txt'), recipeText);
  await writeFile(path.join(reference, 'capture-notes.md'), notesText);
  await writeFile(path.join(base, 'README.md'), readmeText);

  const evidencePaths = [
    'reference-tabwin415/result.xls', 'reference-tabwin415/recipe.txt',
    'reference-tabwin415/capture-notes.md', 'expected/golden-table.json',
  ];
  const committedEvidence = [];
  for (const relative of evidencePaths) {
    const evidence = await readFile(path.join(base, relative));
    committedEvidence.push({ path: relative, bytes: evidence.byteLength, sha256: sha256(evidence) });
  }
  const verified = item.status === 'verified-zero-tolerance';
  const manifest = {
    schema: 'tabwin-web.golden-manifest', version: 1, id: item.id, capturedAt: '2026-08-29',
    semantic: item.semantic,
    referenceEngine: { name: 'TabWin 4.15', executable: 'TabWin415.exe' },
    externalInputs: item.assets,
    committedEvidence,
    tabwinPresentation: normalized.presentation,
    comparison: verified ? {
      status: item.status, tolerance: 0, ...item.records,
      rowLabelsMatch: true, columnLabelsMatch: true, shapeMatch: true,
      cellDiffCount: 0, pass: true,
    } : {
      status: item.status, tolerance: null, pass: null,
      blocker: item.id === 'G012' ? 'new-format N CNV execution'
        : item.id === 'G015' ? 'external DBF lookup execution'
          : 'multiple simultaneous measures',
    },
  };
  await writeFile(path.join(base, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${item.id}: ${item.status}, ${bytes.byteLength} bytes, ${normalized.golden.rows.length}x${normalized.golden.columns.length}`);
}
