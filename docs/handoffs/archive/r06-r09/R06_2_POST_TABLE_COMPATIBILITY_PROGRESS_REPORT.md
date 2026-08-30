# R06.2 — Post-table compatibility progress

**Date:** 2026-08-28  
**Status:** PARTIAL — MODERN, REPLAYABLE SUBSET COMPLETE; LEGACY GOLDENS PENDING

## 1. Outcome

This checkpoint advances post-tabulation editing without changing analytical
execution or claiming undocumented TabWin 4.15 equivalence. The architectural
contract remains:

`AnalysisSpec -> QueryPlan -> Executor -> TabulationResult`

Post-table operations consume an immutable `TabulationResult`, produce a new
result, and are recorded for undo, audit and deterministic replay. No G001
reference, expected value, comparator or legacy fixture was changed.

## 2. Changes in this checkpoint

### Replayable table transposition

A new explicit `transpose` operation swaps row and column axes and transposes
the numeric matrix without mutating the source result. Applying it twice
restores the complete original result, including plan and execution metadata.

The operation is available in the table toolbar, appears in the reversible
operation history, and is validated and persisted in both `.twrecipe` and the
portable table format.

This is currently classified as a modern deterministic implementation. Exact
TabWin menu behavior and legacy `.TAB` persistence still require an oracle.

### Editable table presentation

The result view now exposes independently editable:

- title;
- subtitle;
- footer/source note.

The title and subtitle render as an accessible table caption. The footer is
rendered inside the table so that it is retained by the browser print path.
All three values are recorded in the audit view and round-trip through recipes
and portable tables with bounded structural validation.

Recipe replay initially restored presentation before analysis, which allowed
the generated defaults to overwrite it. Restoration now occurs after analysis
and before operation replay/rendering.

### Strict include-table by row key

The workbench can now include a saved `.twtable` in the current result. The
included table is fully replayed first and its numeric columns are appended by
an exact, unique row-key match. Included rows may arrive in a different order;
the left/current table keeps its order. Column keys receive a deterministic
source namespace and labels retain the included table title.

The first policy is deliberately strict: both tables must contain exactly the
same unique row keys and matching row labels. Missing/extra keys, duplicate
keys, label disagreements, duplicate columns and non-finite cells are rejected.
The self-contained join payload is validated, persisted and undoable as a table
operation. This is a modern explicit policy, not a claim about undocumented
outer/inner-join behavior in TabWin 4.15.

## 3. Existing R06.2 surface audited

The current immutable/replayable operation layer covers:

- add, subtract, multiply, divide, minimum, maximum and percentage;
- factor, cumulative sum, absolute value, integer conversion, sequence and
  constant columns;
- safe expressions without `eval`;
- explicit derived-column total policies;
- rename, move and delete column;
- suppress and aggregate rows;
- stable sorting, accent-insensitive location, clipboard TSV and browser print;
- transpose;
- strict include-table by exact row key;
- title, subtitle and footer presentation metadata.

These capabilities are implemented and tested, but their legacy-equivalence
status remains separate from their modern functional status.

## 4. Verification

`npm run check` passed on 2026-08-28:

- 96 tests passed, 0 failed;
- semantic-kernel TypeScript build passed;
- browser TypeScript check passed;
- Vite production build passed;
- the cancellable DBF decode Worker was emitted as a separate asset;
- application JavaScript: 146.97 kB (48.65 kB gzip).

A local browser smoke with a two-record DBF verified editable title, subtitle
and footer, one-click transposition, operation-history recording, the expected
1-by-2 transposed matrix and visible footer. The browser session was no longer
available for the final undo click after context recovery; immutable double-
transpose and undo-compatible operation replay are covered by the core tests.

`git diff --check` reported only the repository's existing LF-to-CRLF notices.
No golden or G001 path appears in the changed-file set.

## 5. Compatibility classification

### KEEP

- immutable, replayable transpose;
- recipe and portable-table persistence of transpose;
- accessible title/subtitle caption and printable footer;
- bounded validation of presentation fields;
- recipe restoration after analysis defaults are generated.
- strict, namespaced and replayable include-table by exact row key.

### FIX BEFORE INTEGRATION

- presentation restoration order was corrected so a replayed recipe cannot
  silently lose its saved title, subtitle or footer.

### DEFER

- focused TabWin 4.15 goldens for every post-table operation;
- legacy mismatch handling for include-table and clipboard paste semantics;
- legacy column-width, key-length and normalization behavior;
- exact `Header1`, `Header2`, title and footer mappings;
- legacy print pagination and page setup;
- precalculated totals and real `.TAB` save/open/replay.

## 6. Next safe step

Capture short post-table oracle cases alongside the two pending R06.1 cases.
Until those artifacts exist, continue only with clearly labelled modern
features or independently documented behavior; do not infer legacy semantics.
