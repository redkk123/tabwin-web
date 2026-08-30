# R03.0 — Chart families and vector export

**Date:** 2026-08-27
**Status:** INITIAL FAMILIES IMPLEMENTED
**Compatibility impact:** presentation coverage expanded; pixel/option equivalence remains unclaimed

## 1. Objective

Implement usable web renderers for every chart family named in the supplied
TabWin 4.15 help inventory while keeping chart preparation downstream from
`TabulationResult`.

## 2. Implemented chart families

The chart selector now provides:

1. horizontal bars;
2. vertical bars;
3. lines;
4. areas;
5. sectors/pie;
6. points;
7. bubbles;
8. arrows.

The first seven can visualize a one-column result. The arrow view requires at
least two result columns and explicitly compares the first and last column for
each displayed row. It is not the map origin-destination flow renderer.

## 3. Presentation architecture

`packages/visualization/src/chart-model.ts` derives immutable chart data from a
`TabulationResult`. It owns ranking, limits, row totals and first/last-column
arrow data. It does not modify the result or the query plan.

`apps/web/src/chart-renderer.ts` converts that model to accessible SVG using
DOM creation rather than interpolated labels. This keeps user/category text
out of markup parsing paths and makes the vector artifact directly reusable.

Current conventions are modern presentation defaults:

- bars and sectors use ranked values;
- line/area/point/bubble use result row order;
- pie uses the ten largest positive values;
- Cartesian views show up to 24 rows;
- arrows rank up to 14 rows by absolute first-to-last change.

These defaults are not represented as recovered TabWin 4.15 semantics.

## 4. Export and recipes

- Every chart exports native SVG.
- Every chart exports a 2,000 x 1,000 PNG rasterized from the same SVG.
- The selected chart type is preserved in portable `.twrecipe` files.
- Recipe parsing rejects unknown chart types.

## 5. Verification

`npm run check`:

```text
35 tests passed
0 failed
browser typecheck passed
production build passed
```

New pure-model tests prove ranked totals without result mutation and
first-to-last arrow derivation/order. Recipe validation also covers an invalid
chart type. No compatibility golden was changed.

## 6. Remaining chart work

- multiple-series legends and explicit series selection;
- editable titles, fonts, colors and backgrounds;
- axes, scales, decimal formatting and expert bindings;
- zoom/reset and keyboard/touch interaction;
- browser print/copy workflow;
- optional historical 3D presentation if a real user requirement justifies it;
- TabWin 4.15 oracle cases for behaviors that affect saved/exported artifacts.

Recommended next milestone: thematic map class methods, palette controls,
zoom/pan and area hit testing, followed by map layers and flow visualization.
