# R06.1 — Dimension and selection semantics progress

**Date:** 2026-08-28  
**Status:** PARTIAL — SAFE, EVIDENCE-BACKED SUBSET COMPLETE

## 1. Outcome

This checkpoint integrates the seven files retained by the independent Azure
handoff audit and advances the non-speculative part of R06.1. The analytical
contract remains:

`AnalysisSpec -> QueryPlan -> Executor -> TabulationResult`

No G001 reference, comparator expectation or legacy fixture was changed.

The integrated audited tree contributes multi-period/multi-UF acquisition,
schema-checked multi-file opening, explicit manual auxiliary selection when no
verified rule exists, and cancellable DBC/DBF decoding in a Web Worker. These
changes were transferred into the canonical repository rather than replacing
it with the handoff working tree.

## 2. R06.1 changes in this checkpoint

### Independent zero-column suppression

`AnalysisSpec` now records `suppressZeroColumns` independently from
`suppressZeroRows`. The executor applies it only to a real materialized column
dimension, after category materialization. A column is removed only when every
cell in it is zero. The synthetic `Freqüência` column is preserved when the
analysis has no column dimension.

Both policies are separately visible in the browser, serialized in recipes and
validated by the compiler as booleans.

### Column-side DEF/CNV controls

The browser now exposes the column-side features that the kernel already
supported:

- a column CNV selector;
- column `startPosition` for DEF composite-field rules;
- an independent column unclassified policy;
- role-specific DEF labels and defaults for row and column options;
- recipe restoration of the complete column dimension.

Column-only controls remain disabled until a column field is selected. Changing
row or column start position now re-runs the analysis; the missing row listener
was also corrected.

### High-cardinality guard

A deterministic regression test tabulates 6,000 distinct column values. It
asserts that no column is truncated, the first and last keys retain insertion
order, the matrix width matches the dimension and every count remains exact.

### Modern search aids

Variable search narrows the row and column selectors by DBF field name or DEF
label while preserving the current selections. Category search is
accent-insensitive and filters raw/CNV filter choices without changing their
stored keys. **Selecionar tudo** applies only to the visible search results.
These are explicit browser usability features; they do not modify the plan or
claim legacy search equivalence.

## 3. Verification

`npm ci` completed with 54 packages and zero reported vulnerabilities.

`npm run check` passed:

- 93 tests passed, 0 failed;
- semantic-kernel TypeScript build passed;
- browser TypeScript check passed;
- Vite production build passed;
- decode Worker emitted as a separate production asset;
- application JavaScript: 144.05 kB (47.91 kB gzip).

A local browser smoke before the column-CNV extension verified that both zero
suppression controls enable after opening a DBF and that changing column
suppression is reflected independently in the Audit plan. The subsequent
column-control extension is covered by TypeScript/build and core executor tests;
an end-to-end browser case with a real DEF/CNV column remains required before a
public release claim.

## 4. Compatibility classification

### KEEP

- the seven independently audited handoff files;
- independent row/column zero-suppression representation and execution;
- column CNV, start-position and unclassified-policy plumbing;
- deterministic 6,000-column regression coverage.
- modern variable and category search isolated from analytical semantics.

### FIX BEFORE INTEGRATION

- the new column-DEF closure initially failed strict TypeScript null narrowing;
  the active definition is now captured after the guard and the full gate
  passes.

### DEFER

- top-N: tie handling, ordering, totals and interaction with zero suppression
  require a short TabWin 4.15 oracle case;
- multiple increments: the legacy output layout and total rules require an
  original artifact before the model is extended;
- new-format `N` CNV row offsets and DEF `X` semantics remain guarded;
- automatic auxiliary rules outside evidence-backed SIH-RD remain forbidden.

## 5. Next safe step

Capture the two cases in `docs/testing/R06_1_SHORT_ORACLE_CASES.md`, then complete
R06.1 without guessing. The modern category/variable search already added here
remains isolated from the compiled plan and TabWin semantics.
