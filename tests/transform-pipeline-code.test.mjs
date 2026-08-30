/**
 * The pedagogical "ver código equivalente" renderer: a read-only view of a
 * transform pipeline as dplyr or pandas code. These tests are about the code
 * being valid-shaped and honest, not about it running - it never runs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { transformPipelineToCode } from '../dist/packages/analysis/src/transform-pipeline-code.js';

const FULL = [
  { id: '1', kind: 'text-normalize', field: 'MUN', operations: [{ kind: 'ibge-municipality' }] },
  { id: '2', kind: 'date-part', field: 'DT', target: 'ANO', part: 'year' },
  { id: '3', kind: 'filter-rows', filters: [{ field: 'CLASSI', acceptedCategories: ['1'] }] },
  { id: '4', kind: 'recode', field: 'SEXO', mapping: [{ from: ['M'], to: 'Masculino' }], otherwise: { policy: 'missing' } },
  { id: '5', kind: 'group-summarize', groupFields: ['UF', 'ANO'], aggregations: [{ kind: 'count', as: 'N' }, { kind: 'sum', field: 'V', as: 'T' }] },
];

test('an empty pipeline renders the source variable alone in both targets', () => {
  assert.equal(transformPipelineToCode([], 'r', 'dados'), 'dados');
  assert.equal(transformPipelineToCode([], 'python'), 'df = dados.copy()');
});

test('the R chain opens the pipe and never leaves a dangling |>', () => {
  const code = transformPipelineToCode(FULL, 'r', 'sinan');
  assert.match(code, /^library\(dplyr\)/);
  assert.match(code, /sinan <- sinan \|>/);
  // The last non-comment line is the final verb, with no trailing pipe.
  const codeLines = code.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  const last = codeLines.at(-1);
  assert.ok(!last.trimEnd().endsWith('|>'), `final verb must not end with a pipe: ${last}`);
  // Every other verb line ends with a pipe.
  for (const line of codeLines.slice(1, -1)) {
    assert.ok(line.trimEnd().endsWith('|>'), `intermediate verb must end with a pipe: ${line}`);
  }
});

test('a disabled step is shown commented, and does not carry the chain\'s final pipe', () => {
  const steps = [
    { id: '1', kind: 'filter-rows', filters: [{ field: 'A', kind: 'numeric-range', minimum: 1 }] },
    { id: '2', kind: 'dedupe', enabled: false, keyFields: ['A'] },
  ];
  const code = transformPipelineToCode(steps, 'r', 'dados');
  // The dedupe line is commented out...
  assert.match(code, /# dplyr::distinct\(A, \.keep_all = TRUE\)/);
  // ...and the filter (the last enabled verb) does NOT end with a pipe.
  const filterLine = code.split('\n').find((line) => line.includes('dplyr::filter'));
  assert.ok(!filterLine.trimEnd().endsWith('|>'), 'the last enabled verb must close the chain');

  const py = transformPipelineToCode(steps, 'python');
  assert.match(py, /# \(etapa desativada\) df = df\.drop_duplicates/);
});

test('an all-disabled pipeline does not open a pipe it cannot close', () => {
  const steps = [{ id: '1', kind: 'dedupe', enabled: false, keyFields: ['A'] }];
  const code = transformPipelineToCode(steps, 'r', 'dados');
  // The header assigns the source to itself, with no trailing pipe anywhere.
  assert.match(code, /dados <- dados\n/);
  assert.ok(!code.includes('|>'), 'nothing to pipe into means no pipe at all');
});

test('filter modes and numeric ranges become the right predicates', () => {
  const steps = [
    { id: '1', kind: 'filter-rows', filters: [{ field: 'IDADE', kind: 'numeric-range', minimum: 10, maximum: 19 }] },
    { id: '2', kind: 'filter-rows', filters: [{ field: 'UF', mode: 'exclude', acceptedCategories: ['SP', 'RJ'] }] },
  ];
  const r = transformPipelineToCode(steps, 'r', 'dados');
  assert.match(r, /dplyr::filter\(IDADE >= 10 & IDADE <= 19\)/);
  assert.match(r, /dplyr::filter\(!\(UF %in% c\("SP", "RJ"\)\)\)/);

  const py = transformPipelineToCode(steps, 'python');
  assert.match(py, /df\["IDADE"\] >= 10/);
  assert.match(py, /~df\["UF"\]\.isin\(\["SP", "RJ"\]\)/);
});

test('group-summarize renders group_by + summarise / groupby.agg', () => {
  const r = transformPipelineToCode([FULL[4]], 'r', 'dados');
  assert.match(r, /dplyr::group_by\(UF, ANO\)/);
  assert.match(r, /dplyr::summarise\(N = dplyr::n\(\), T = sum\(V, na\.rm = TRUE\), \.groups = "drop"\)/);

  const py = transformPipelineToCode([FULL[4]], 'python');
  assert.match(py, /df\.groupby\(\["UF", "ANO"\], as_index=False\)\.agg\(/);
  assert.match(py, /T=\("V", "sum"\)/);
});

test('a formula keeps TabWin semantics but reads naturally, and is labelled as not directly runnable', () => {
  const steps = [{ id: '1', kind: 'derive-column', field: 'TAXA', formula: '=RATE([OBITOS]; [POP]; 100000)', divisionByZero: 'zero' }];
  const r = transformPipelineToCode(steps, 'r', 'dados');
  // Column brackets gone, ; separators become commas.
  assert.match(r, /dplyr::mutate\(TAXA = RATE\(OBITOS, POP, 100000\)\)/);
  assert.match(r, /não têm equivalente direto em R/);

  const py = transformPipelineToCode(steps, 'python');
  assert.match(py, /df\["TAXA"\] = RATE\(df\["OBITOS"\], df\["POP"\], 100000\)/);
  assert.match(py, /não têm equivalente direto em pandas/);
});

test('the epidemiological week is flagged as possibly differing from the library at year boundaries', () => {
  const steps = [{ id: '1', kind: 'date-part', field: 'DT', target: 'SE', part: 'epidemiological-week' }];
  const r = transformPipelineToCode(steps, 'r', 'dados');
  assert.match(r, /MMWR\/MS/);
  assert.match(r, /pode diferir de aweek/);

  const py = transformPipelineToCode(steps, 'python');
  // pandas has no built-in epidemiological week, so it is left unset with a note.
  assert.match(py, /df\["SE"\] = None/);
  assert.match(py, /MMWR\/MS/);
});
