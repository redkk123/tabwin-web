# R03.1 — Interactive thematic map classification

**Date:** 2026-08-27
**Status:** INITIAL INTERACTIVE MAP MILESTONE IMPLEMENTED
**Compatibility impact:** modern presentation controls; exact TabWin class rounding remains unclaimed

## 1. Objective

Expand the existing `.MAP` canvas view into a practical local-first thematic
map while keeping geography downstream from `TabulationResult`.

## 2. Implemented

- continuous square-root color scale;
- equal-interval classes;
- quantile/equal-frequency classes;
- three to seven visible classes;
- green, blue, orange and purple palettes;
- discrete class legend or continuous range legend;
- pointer/touch drag, wheel/touchpad zoom and reset controls;
- local polygon hit testing with area name/code and associated result value;
- rendering of legacy line and point objects in addition to polygons;
- classification, class count and palette persistence in `.twrecipe`;
- map presentation settings in the audit view.

## 3. Architecture and semantics

`packages/visualization/src/map-scale.ts` owns deterministic presentation
classification. It receives only result values and cannot mutate or reinterpret
the query plan. `apps/web/src/main.ts` associates result keys/labels with parsed
legacy map objects and renders the resulting view.

The continuous, equal-interval and quantile implementations are explicit
modern presentation modes. No assertion is made that class endpoints, display
rounding or color defaults are identical to TabWin 4.15 without oracle cases.

## 4. Verification

`npm run check` completed with 38/38 tests, browser typechecking and production
build. New tests cover deterministic equal intervals, observed-distribution
quantiles, stable equal-value color and source-array immutability. The map
toolbar was also inspected in the running local production-facing interface.

No golden expected output was modified.

## 5. Remaining map work

- manual class limits and per-class color editing;
- labels, values, seats and configurable border presentation;
- persistent area selection and selection-to-filter bridge;
- layers and modern administrative geometry adapters;
- origin–destination flow maps;
- GeoJSON/KML and print/vector export;
- legacy oracle cases for class endpoints and formatting.
