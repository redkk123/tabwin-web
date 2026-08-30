# R04.2 — Table presentation, clipboard and print

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — MODERN PRESENTATION, LEGACY VISUAL GOLDENS PENDING

## 1. Outcome

The result table now has its first complete presentation toolbar. Users can
locate categories, sort the visible table, control numeric decimals, show or
hide the row key, copy the presented rows into a spreadsheet and print a clean
table view.

This milestone stays separate from R04.1 data operations. Presentation order
does not mutate `TabulationResult`, change totals or silently alter the source
analysis.

## 2. Implemented behavior

- stable original, ascending and descending order;
- sort by the row key/label or any numeric base/derived column;
- accent-insensitive substring location over row keys and labels;
- automatic numeric formatting or 0–6 fixed decimals;
- visible/sticky row key by default, with an explicit hide control;
- TSV clipboard output in the current sort/filter order;
- print CSS that removes workbench controls and prints the complete table
  surface without the scroll container.

Equal sort values preserve original analytical row order. Locate affects only
the visible/copy selection and never rewrites the executor result.

## 3. Recipes and audit

`AnalysisRecipeV1.view` now optionally persists:

- `tableSortColumnKey`;
- `tableSortDirection`;
- `tableDecimalPlaces`;
- `tableKeyVisible`.

Parsing validates direction, decimal range and visibility types. Existing
recipes remain valid. The transient locate query is included in live Audit for
inspection but deliberately omitted from saved recipes so reopening an
analysis does not appear to lose data behind an old search.

## 4. Verification

`npm run check` passed:

- 54 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

Three new tests prove stable numeric and natural key sorting, source-result
immutability, accent-insensitive location and exact TSV row/key behavior.

Browser verification loaded the real G001 `RDAC2401.dbc` and observed:

| Check | Observed |
| --- | --- |
| Descending frequency first row | municipality `120040`, value `1,789` |
| Locate `120040` | exactly one row |
| Hide key | only `Freqüência` remained in the header |
| Audit | `sortDirection: descending` present |
| Clipboard with hidden key | `Freqüência` + `1789` as TSV |

## 5. Compatibility boundary

These controls implement the user outcomes cataloged in TabWin help, but they
do not claim pixel or dialog-default equivalence with 4.15. Column rename,
width, move/delete, row aggregation, fixed key length, dual headers and
footnotes remain pending.

The later differential corpus will use short 2–5 minute oracle cases. Seeds
and pairwise coverage choose compact cases; each mismatch is retained as
evidence and may be promoted to a permanent deterministic golden.
