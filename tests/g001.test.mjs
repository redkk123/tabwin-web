import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseTabWinBiffExport } from '../dist/packages/formats/src/index.js';

test('committed G001 TabWin 4.15 export preserves exact labels, order and cells', async () => {
  const bytes = await readFile(new URL('../fixtures/golden/G001/reference-tabwin415/result.xls', import.meta.url));
  const table = parseTabWinBiffExport(bytes);
  const labels = new Map(table.labels.map(({ row, column, value }) => [`${row}:${column}`, value]));
  const numbers = new Map(table.numbers.map(({ row, column, value }) => [`${row}:${column}`, value]));

  assert.equal(labels.get('1:0'), 'Freqüência segundo Complexidade do Procedimento');
  assert.equal(labels.get('2:1'), 'Freqüência');
  assert.deepEqual(
    [3, 4, 5, 6].map((row) => [labels.get(`${row}:0`), numbers.get(`${row}:1`)]),
    [
      ['Atenção Básica', 0],
      ['Média complexidade', 4153],
      ['Alta complexidade', 162],
      ['Não se aplica', 0],
    ],
  );
  assert.equal(labels.get('7:0'), 'Total');
  assert.equal(numbers.get('7:1'), 4315);
});
