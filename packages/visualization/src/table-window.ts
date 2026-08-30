/**
 * Pure windowing math for the virtualized result table.
 *
 * The table can hold well over a million rows (a national DBC), so rendering
 * every `<tr>` is not an option. This computes which row range belongs in the
 * DOM for a given scroll position, plus the two spacer heights that keep a
 * native `<table>` scrollable to its true full height without every row
 * actually existing. No DOM here: it is a pure function of the scroll state,
 * which is what makes it fast to test against many geometries at once.
 */

export interface TableWindowInput {
  /** Total rows the table could render, e.g. `currentTableRowIndexes().length`. */
  rowCount: number;
  /** Estimated or measured height of one row, in pixels. Must be positive. */
  rowHeight: number;
  /** Current `scrollTop` of the scrolling container. */
  scrollTop: number;
  /** Current visible height of the scrolling container (its `clientHeight`). */
  viewportHeight: number;
  /** Extra rows rendered above and below the viewport, to absorb small scrolls
   *  without a blank flash before the next paint catches up. */
  overscan?: number;
}

export interface TableWindow {
  /** First row index to render, inclusive. */
  startIndex: number;
  /** Last row index to render, exclusive. */
  endIndex: number;
  /** Height, in pixels, of the spacer row placed before the rendered rows. */
  topSpacerHeight: number;
  /** Height, in pixels, of the spacer row placed after the rendered rows. */
  bottomSpacerHeight: number;
}

const DEFAULT_OVERSCAN = 8;

/**
 * The window is a pure function of scroll position: two tables with the same
 * inputs always agree, which is what lets scrolling, printing (viewport height
 * effectively infinite) and tests share one code path.
 */
export function computeTableWindow(input: TableWindowInput): TableWindow {
  const { rowCount } = input;
  if (!Number.isFinite(rowCount) || rowCount < 0) throw new Error(`invalid row count: ${rowCount}`);
  if (!Number.isFinite(input.rowHeight) || input.rowHeight <= 0) {
    throw new Error(`invalid row height: ${input.rowHeight}`);
  }
  if (rowCount === 0) return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };

  const overscan = input.overscan ?? DEFAULT_OVERSCAN;
  if (!Number.isSafeInteger(overscan) || overscan < 0) throw new Error(`invalid overscan: ${overscan}`);
  const scrollTop = Math.max(0, input.scrollTop);
  const viewportHeight = Math.max(0, input.viewportHeight);

  const firstVisible = Math.floor(scrollTop / input.rowHeight);
  const visibleRows = Math.ceil(viewportHeight / input.rowHeight) + 1;

  const startIndex = clamp(firstVisible - overscan, 0, rowCount);
  const endIndex = clamp(firstVisible + visibleRows + overscan, startIndex, rowCount);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * input.rowHeight,
    bottomSpacerHeight: (rowCount - endIndex) * input.rowHeight,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
