# R04.1 — Auditable post-tabulation table operations

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — MODERN EXPLICIT POLICIES, LEGACY GOLDENS PENDING

## 1. Outcome

The first post-G001 inventory slice is usable in the browser. A user can create
derived result columns, choose how each derived total is calculated, undo or
reset transforms, inspect them in Audit and save/replay them in a `.twrecipe`.

This milestone deliberately does not call the transformation defaults TabWin
4.15-compatible. The supplied reverse specification confirms the operations
exist, but focused oracle exports are still required for exact defaults,
rounding and exceptional cases.

## 2. Architectural boundary

The preserved analytical path remains:

```text
AnalysisSpec -> QueryPlan -> Executor -> TabulationResult
                                             |
                                             v
                                  ordered TableOperation[]
                                             |
                                             v
                              derived TabulationResult + audit
```

Operations are pure and immutable. They do not alter the source records,
`AnalysisSpec`, compiled `QueryPlan` or executor semantics. This prevents a
modern presentation feature from silently becoming a legacy compatibility
rule.

## 3. Implemented operation model

The explicit discriminated operation contract covers:

- pairwise add, subtract, multiply, divide, minimum and maximum;
- `A / B × 100` percentage;
- multiplication by a numeric factor;
- accumulation in current result-row order;
- absolute value;
- integer conversion (truncate, round, floor and ceil in the model; current UI
  uses truncation toward zero);
- numeric sequence;
- constant numeric column.

Division and percentage require `error` or `zero` as the denominator-zero
policy. Every result is checked for finite numeric output. Missing source
columns, duplicate output keys and inconsistent result shapes fail explicitly.

## 4. Total policies

Derived columns carry one of the documented total policies:

- none;
- sum;
- product;
- mean;
- initial value;
- final value;
- minimum;
- maximum.

Rows marked `excludeFromTotal` are excluded from these calculations. The
`precalculated` legacy policy remains modelled in the analytical core but is
not offered for derived columns because no independent precomputed value is
available in this workflow.

## 5. Browser workflow

The Table tab now contains a responsive operation bench with source-column
selection, factor/value input, output label, zero-denominator policy and total
policy. Operations may reference earlier derived columns, allowing pairwise
addition to be chained across more than two inputs. History chips, Undo and
Restore rebuild the result deterministically from the base executor output.

The table footer is now rendered and uses each derived column's selected total
policy. Charts, maps, statistics and CSV/XML exports consume the current
derived result automatically.

## 6. Reproducibility and audit

`AnalysisRecipeV1` has a backward-compatible optional `resultOperations`
array. Recipe parsing validates every operation's kind, fields, numeric values,
rounding/zero policy, output identity and total policy before replay. Existing
recipes without operations remain valid.

Audit JSON includes the exact ordered operation payloads. No timestamps are
embedded in the operation model, so recipe serialization remains deterministic.

## 7. Verification

`npm run check` passed:

- 51 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

Five new tests cover immutable binary transforms, explicit division by zero,
deterministic replay of all unary/scalar/sequence families, total policies with
excluded rows and invalid references/duplicates. Recipe round-trip and invalid
operation validation are covered in the core suite.

A browser inspection loaded the real 313,213-byte `RDAC2401.dbc`. Applying a
factor of two produced:

| Check | Observed |
| --- | --- |
| First frequency | `2` |
| Derived first value | `4` |
| Base total | `4,315` |
| Derived total | `8,630` |
| History | `Frequência dobrada · fator` |
| Undo | restored the single original column |
| Mobile viewport | 390 px; one-column operation grid; no document overflow |

## 8. Compatibility boundary and next work

These are modern, documented and reproducible implementations, not yet golden
equivalence claims. Future oracle cases must determine TabWin 4.15 behavior for
rounding, division by zero, totals over subtotals, percentages and accumulation
after visual sorting.

The next table slice is presentation and editing: safe expression columns,
sorting, move/delete columns, row suppression/aggregation, titles/footnotes,
decimal formatting, clipboard and print. Each data-changing action will remain
separate from purely visual state.
