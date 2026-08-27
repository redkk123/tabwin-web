# R02.2 — Measure and selection controls

**Date:** 2026-08-27
**Status:** IMPLEMENTED
**Compatibility impact:** existing tested kernel behavior is now exposed; no new legacy semantic rule

## 1. Objective

Expose two analytical capabilities that already existed behind the normalized
plan boundary:

- frequency versus numeric sum/increment;
- an inclusion selection/filter using raw values or a loaded DEF/CNV category.

The UI produces a normal `AnalysisSpec`, which is validated and compiled into
`QueryPlan`; it does not transform records directly.

## 2. Measure control

The workbench now offers:

- **Frequencia** (`measure.kind = count`);
- **Somar um campo** (`measure.kind = sum`).

Numeric DBF fields are offered as sum candidates. When a DEF is active, its
`I` increment labels are displayed next to the underlying field. A dataset
without numeric/increment fields cannot select sum.

Existing kernel coverage already proves row x column sum execution and
non-numeric warning/zero handling. Legacy total policies beyond ordinary sum
remain cataloged and are not silently inferred.

## 3. Selection control

The initial browser selection builder supports one active field with multiple
accepted values:

- raw mode enumerates up to 500 observed source values;
- DEF/CNV mode finds a documented selection option for the field, resolves its
  loaded CNV by basename and displays category labels;
- selected CNV values are serialized as category sequence identifiers, as
  required by the tested kernel contract;
- DEF one-based start position is retained in the filter spec;
- clearing the selection removes the filter without mutating the source data.

This is deliberately an inclusion filter. Exclusion, range-dialog behavior,
search within very large category lists and multiple simultaneous filter cards
remain separate UI work.

## 4. Auditability

The resulting audit JSON records the complete measure and filter clauses in
the `QueryPlan`, together with DBC/DEF/CNV fingerprints and accepted/seen
record counts. The result heading distinguishes frequency from field sum.

## 5. Verification

`npm run check`:

```text
31 tests passed
0 failed
browser typecheck passed
production build passed
```

Relevant inherited tests cover:

- row x column sum;
- raw and conversion-backed filters;
- DEF start position for filters;
- DEF bridge compilation for increments and selections;
- deterministic plan execution.

No golden oracle was changed. G001 remains pending the original Windows
TabWin 4.15 capture.

## 6. Next safe slice

Add multiple filter cards with category search and explicit inclusion/exclusion
modes, then portable recipe save/open so the expanded analysis can be replayed.
