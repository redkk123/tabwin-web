/**
 * Regression cover for the chart renderer's actual SVG output.
 *
 * The renderer used to be unreachable from Node - it calls
 * `document.createElementNS` - so the 4.2 editor could quietly change what a
 * chart looked like and nothing would notice. Every case here exists because
 * adding the editor did change something: the presentation controls all default
 * to "Automático", and "Automático" has to mean what the chart did before the
 * controls existed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderChartSvg } from '../apps/web/src/chart-renderer.ts';
import { installSvgDom, textsByClass } from './svg-dom-stub.mjs';

const twoDimensional = {
  rows: [
    { key: 'a', label: 'Média complexidade' },
    { key: 'b', label: 'Alta complexidade' },
  ],
  columns: [
    { key: 'eletivo', label: 'Eletivo' },
    { key: 'urgencia', label: 'Urgência' },
  ],
  cells: [[1968, 2185], [124, 38]],
};

const oneDimensional = {
  rows: [
    { key: 'a', label: 'Média complexidade' },
    { key: 'b', label: 'Alta complexidade' },
  ],
  columns: [{ key: 'freq', label: 'Freqüência' }],
  cells: [[4153], [162]],
};

const money = {
  rows: [{ key: 'a', label: 'Média complexidade' }],
  columns: [{ key: 'val', label: 'Valor Total' }],
  cells: [[3016736.92]],
};

function render(result, type, options = {}) {
  const restore = installSvgDom();
  try {
    return renderChartSvg(result, type, 'Teste', options);
  } finally {
    restore();
  }
}

test('an untouched editor prints counts as whole numbers, the way the chart always did', () => {
  const svg = render(oneDimensional, 'horizontal-bar');
  assert.deepEqual(textsByClass(svg, 'chart-value'), ['4.153', '162']);
});

test('an explicit decimal setting pads, but only because it was asked for', () => {
  assert.deepEqual(textsByClass(render(money, 'horizontal-bar', { decimalPlaces: 2 }), 'chart-value'), ['3.016.736,92']);
  assert.deepEqual(textsByClass(render(money, 'horizontal-bar', { decimalPlaces: 0 }), 'chart-value'), ['3.016.737']);
  // Automatic keeps the cents without inventing them elsewhere.
  assert.deepEqual(textsByClass(render(money, 'horizontal-bar'), 'chart-value'), ['3.016.736,92']);
});

test('a pie keeps its category legend when nothing has been toggled', () => {
  const labels = textsByClass(render(oneDimensional, 'pie'), 'chart-label');
  assert.equal(labels.length, 2, 'an unlabelled disc is not a pie chart');
  assert.ok(labels[0]?.startsWith('Média complexidade · '), labels[0]);
  assert.deepEqual(textsByClass(render(oneDimensional, 'pie', { showLegend: false }), 'chart-label'), []);
});

test('horizontal bars keep their value labels, and can still be told not to', () => {
  assert.equal(textsByClass(render(oneDimensional, 'horizontal-bar'), 'chart-value').length, 2);
  assert.deepEqual(textsByClass(render(oneDimensional, 'horizontal-bar', { showValueLabels: false }), 'chart-value'), []);
});

test('a two-column result draws one series per column and names each in the legend', () => {
  const svg = render(twoDimensional, 'vertical-bar');
  assert.deepEqual(textsByClass(svg, 'chart-legend'), ['Eletivo', 'Urgência']);
  // The background paints first, then two bars per category in the declared
  // column order, then the legend's own swatches.
  const bars = svg.findAll('rect').filter((rect) => rect.getAttribute('y') !== '480').slice(1);
  assert.deepEqual(bars.map((rect) => rect.getAttribute('fill')), ['#178b71', '#f16f5f', '#178b71', '#f16f5f']);
});

test('asking for row totals collapses the series back to one', () => {
  const svg = render(twoDimensional, 'vertical-bar', { seriesMode: 'total' });
  const bars = svg.findAll('rect').slice(1);
  assert.equal(bars.length, 2, 'one bar per row, and no legend swatches');
  assert.deepEqual(textsByClass(svg, 'chart-legend'), [], 'a single series needs no legend by default');
});

test('the SVG carries its own font so the screen and the exported file agree', () => {
  const style = render(oneDimensional, 'horizontal-bar', { fontFamily: 'serif' }).findAll('style')[0];
  assert.match(style.textContent, /font-family:Georgia,"Times New Roman",serif/);
  assert.match(render(oneDimensional, 'horizontal-bar').findAll('style')[0].textContent, /font-family:Inter,/);
});

test('axis ticks land on readable numbers and honour an explicit range', () => {
  assert.deepEqual(textsByClass(render(oneDimensional, 'vertical-bar'), 'chart-tick').slice(0, 6), [
    '0', '1.000', '2.000', '3.000', '4.000', '5.000',
  ]);
  const bounded = textsByClass(render(oneDimensional, 'vertical-bar', { axisYMin: 0, axisYMax: 4000, axisTickCount: 4 }), 'chart-tick');
  assert.deepEqual(bounded.slice(0, 5), ['0', '1.000', '2.000', '3.000', '4.000']);
});

test('an inverted manual range is discarded rather than drawn', () => {
  const inverted = textsByClass(render(oneDimensional, 'vertical-bar', { axisYMin: 4000, axisYMax: 100 }), 'chart-tick');
  const automatic = textsByClass(render(oneDimensional, 'vertical-bar'), 'chart-tick');
  assert.deepEqual(inverted, automatic, 'the axis falls back to the range of the data');
});

test('a bound scatter reads its x and y from the chosen columns, and its size from a third', () => {
  const wide = {
    rows: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }],
    columns: [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }, { key: 's', label: 'Peso' }],
    cells: [[10, 20, 1], [30, 40, 100]],
  };
  const sized = render(wide, 'bubbles', { xColumnKey: 'x', yColumnKey: 'y', sizeColumnKey: 's' });
  const radii = sized.findAll('circle').map((circle) => Number(circle.getAttribute('r')));
  assert.equal(radii.length, 2);
  assert.ok(radii[1] > radii[0], 'the heavier row draws the larger bubble');
  assert.ok(textsByClass(sized, 'chart-legend').includes('Tamanho: Peso'));
  // Without the size binding the row total sizes the bubble, and Alpha's total
  // (31) is the smaller of the two, so the ordering survives but the ratio does not.
  const unsized = render(wide, 'bubbles', { xColumnKey: 'x', yColumnKey: 'y' });
  assert.ok(textsByClass(unsized, 'chart-legend').includes('Tamanho: total da linha'));
});

test('a point outside manual bounds is dropped, not pinned to the frame', () => {
  const wide = {
    rows: [{ key: 'a', label: 'Dentro' }, { key: 'b', label: 'Fora' }],
    columns: [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }],
    cells: [[5, 5], [500, 500]],
  };
  const clipped = render(wide, 'points', {
    xColumnKey: 'x', yColumnKey: 'y', axisXMin: 0, axisXMax: 10, axisYMin: 0, axisYMax: 10,
  });
  assert.equal(clipped.findAll('circle').length, 1, 'the out-of-range row is left out');
});

test('the whole SVG is byte-stable for a fixed input', () => {
  // A full serialization, so an accidental change to any coordinate, colour or
  // class shows up here as a diff instead of reaching a user's exported PNG.
  const xml = render(oneDimensional, 'horizontal-bar', { title: 'Complexidade' }).toXml();
  assert.equal(xml, render(oneDimensional, 'horizontal-bar', { title: 'Complexidade' }).toXml());
  assert.match(xml, /<svg viewBox="0 0 1000 500" role="img" aria-label="Teste" class="result-chart-svg">/);
  assert.match(xml, /<text x="18" y="28" class="chart-title">Complexidade<\/text>/);
  assert.match(xml, /<rect x="225" y="86" width="650" height="20" rx="4" fill="#edf3f1"\/>/);
  assert.match(xml, /<text x="980" y="102" text-anchor="end" class="chart-value">4\.153<\/text>/);
});
