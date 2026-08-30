import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTableWindow } from '../dist/packages/visualization/src/table-window.js';

test('scrolled to the top renders from row zero with only a bottom spacer', () => {
  const window_ = computeTableWindow({ rowCount: 10_000, rowHeight: 34, scrollTop: 0, viewportHeight: 470 });
  assert.equal(window_.startIndex, 0);
  assert.equal(window_.topSpacerHeight, 0);
  assert.ok(window_.endIndex > 0);
  assert.equal(window_.bottomSpacerHeight, (10_000 - window_.endIndex) * 34);
});

test('scrolled to the exact bottom renders through the last row with no bottom spacer', () => {
  const rowCount = 1_927; // the real municipal row count observed for the Dengue tabulation
  const rowHeight = 34;
  const viewportHeight = 470;
  const maxScrollTop = rowCount * rowHeight - viewportHeight;
  const window_ = computeTableWindow({ rowCount, rowHeight, scrollTop: maxScrollTop, viewportHeight });
  assert.equal(window_.endIndex, rowCount);
  assert.equal(window_.bottomSpacerHeight, 0);
  assert.ok(window_.startIndex > 0, 'a distant scroll position must not render from the top');
});

test('the window always spans exactly the spacers plus the rendered rows', () => {
  const rowCount = 4_315; // the real RDAC2401 record count
  const rowHeight = 34;
  for (const scrollTop of [0, 500, 12_345, 999_999]) {
    const window_ = computeTableWindow({ rowCount, rowHeight, scrollTop, viewportHeight: 470, overscan: 5 });
    const renderedHeight = (window_.endIndex - window_.startIndex) * rowHeight;
    assert.equal(window_.topSpacerHeight + renderedHeight + window_.bottomSpacerHeight, rowCount * rowHeight);
  }
});

test('overscan widens the window symmetrically without exceeding the row count', () => {
  const tight = computeTableWindow({ rowCount: 1_000, rowHeight: 34, scrollTop: 3_400, viewportHeight: 470, overscan: 0 });
  const padded = computeTableWindow({ rowCount: 1_000, rowHeight: 34, scrollTop: 3_400, viewportHeight: 470, overscan: 8 });
  assert.ok(padded.startIndex <= tight.startIndex);
  assert.ok(padded.endIndex >= tight.endIndex);
  assert.equal(padded.startIndex, Math.max(0, tight.startIndex - 8));
});

test('a viewport tall enough to show everything renders the whole table with no spacers', () => {
  const window_ = computeTableWindow({ rowCount: 50, rowHeight: 34, scrollTop: 0, viewportHeight: 100_000 });
  assert.equal(window_.startIndex, 0);
  assert.equal(window_.endIndex, 50);
  assert.equal(window_.topSpacerHeight, 0);
  assert.equal(window_.bottomSpacerHeight, 0);
});

test('an empty table produces an empty, spacer-free window', () => {
  assert.deepEqual(
    computeTableWindow({ rowCount: 0, rowHeight: 34, scrollTop: 500, viewportHeight: 470 }),
    { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 },
  );
});

test('negative scroll and viewport values are clamped rather than producing a broken window', () => {
  const window_ = computeTableWindow({ rowCount: 1_000, rowHeight: 34, scrollTop: -500, viewportHeight: -10 });
  assert.equal(window_.startIndex, 0);
  assert.equal(window_.topSpacerHeight, 0);
});

test('rejects a geometry that cannot describe a real table', () => {
  assert.throws(() => computeTableWindow({ rowCount: -1, rowHeight: 34, scrollTop: 0, viewportHeight: 470 }), /invalid row count/);
  assert.throws(() => computeTableWindow({ rowCount: 10, rowHeight: 0, scrollTop: 0, viewportHeight: 470 }), /invalid row height/);
  assert.throws(() => computeTableWindow({ rowCount: 10, rowHeight: 34, scrollTop: 0, viewportHeight: 470, overscan: -1 }), /invalid overscan/);
});
