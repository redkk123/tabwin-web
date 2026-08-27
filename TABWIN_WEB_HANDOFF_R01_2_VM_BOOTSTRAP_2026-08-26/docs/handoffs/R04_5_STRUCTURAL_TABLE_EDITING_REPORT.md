# R04.5 — Structural table editing

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — REVERSIBLE MODERN POLICIES, LEGACY GOLDENS PENDING

## 1. Outcome

The table workbench can now rename, move and remove numeric columns, suppress
located rows and combine located rows into a summed category. Every action is
an ordered immutable result operation, so Undo, Restore, Audit and `.twrecipe`
replay behave exactly like calculated columns.

## 2. Column operations

- rename a column without changing its stable key;
- move one position left or right while moving corresponding cells together;
- remove a column and its cells;
- reject movement beyond an edge;
- reject removal of the final numeric column.

Expressions executed after movement interpret `Cnn` using the table order at
that point in operation replay. Expressions using stable keys remain
independent of presentation labels.

## 3. Row operations

The existing Locate field defines row sets by key or label. A non-empty query
and at least one match are required.

Suppression removes the matched result rows. Aggregation sums every numeric
column and either:

- replaces the source rows with the aggregate; or
- appends an aggregate marked `excludeFromTotal`, preventing double counting.

Source `TabulationResult`, records and QueryPlan remain unchanged. Undo rebuilds
from the base executor output and replays only the retained operations.

## 4. Recipe safety

Recipe parsing validates structural kinds, stable column keys, movement
direction, non-empty row-key sets, aggregate identity, total exclusion and the
replace/append flag before replay. Unknown or destructive requests fail
explicitly.

## 5. Verification

`npm run check` passed:

- 65 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

Four new tests cover column/cell alignment, source immutability, row
suppression, both aggregation modes, total exclusion and invalid boundary or
empty requests.

Browser verification over `RDAC2401.dbc` observed:

| Workflow | Result |
| --- | --- |
| `C01 * 2`, rename, move left | headers `Frequência dobrada`, `Freqüência`; first values `4`, `2` |
| Locate `1200` | 22 municipality rows |
| Replace with aggregate | base `4,113`; doubled `8,226`; total row count 30 |
| Suppress `110012` | 51 → 50 rows |
| Undo suppression | `110012` restored |

## 6. Compatibility boundary

The original TabWin defaults for aggregate placement, duplicate labels,
subtotal participation and downstream `.TAB` state require focused oracle
cases. The Web implementation keeps each policy explicit and reversible until
those goldens exist.
