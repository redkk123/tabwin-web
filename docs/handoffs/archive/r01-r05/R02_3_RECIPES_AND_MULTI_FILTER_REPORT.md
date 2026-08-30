# R02.3 — Portable recipes and multiple filters

**Date:** 2026-08-27
**Status:** IMPLEMENTED
**Compatibility impact:** modern reproducibility surface; legacy `.TAB` equivalence remains unclaimed

## 1. Objective

Make an analysis reusable without sharing microdata and expand the initial
selection control from one filter to a deterministic intersection of multiple
filters.

## 2. Portable recipe workflow

The workbench now provides **Salvar analise** and **Abrir analise** controls.
The `.twrecipe` JSON contains:

- schema and version;
- optional analysis name;
- complete `TabulationSpec`;
- source filename, size and SHA-256 hint;
- every used CNV identifier, filename, size and SHA-256.

Opening a recipe:

1. validates schema/version and required collections;
2. runs the loaded spec through `compileQueryPlan` validation;
3. validates source/conversion fingerprint shapes;
4. verifies required fields exist in the current DBC/DBF;
5. requires every referenced CNV to be loaded;
6. applies rows, columns, measure, zero suppression and filters;
7. executes through the normal compiler/executor boundary;
8. tells the user whether the source hash matches or the recipe was applied to
   a different period/source.

Applying a recipe to a newer competence is intentional and visible. A source
mismatch is never hidden.

## 3. Multiple filters

The filter builder now creates removable filter cards. Each card preserves:

- field;
- accepted raw values or CNV sequence identifiers;
- conversion identifier when present;
- DEF one-based start position when present.

All active cards are serialized into `spec.filters` and evaluated as a logical
intersection by the existing executor. Builder checkboxes do not affect a
result until **Adicionar filtro** is chosen, preventing accidental half-edited
queries.

## 4. Relationship to legacy `.TAB`

This milestone implements the user outcome behind saved/replayable analysis,
but does not claim to parse or reproduce the undocumented `.TAB` format. The
portable recipe is a modern, inspectable format and creates the target model
against which future `.TAB` archaeology can be mapped.

## 5. Verification

`npm run check`:

```text
33 tests passed
0 failed
browser typecheck passed
production build passed
```

New coverage rejects invalid recipe plans/fingerprints and proves deterministic
intersection of multiple filters. Existing recipe round-trip, raw/CNV filter,
DEF position, compiler and executor tests remain passing. No golden was
modified.

## 6. Known limits

- Exclusion filters and explicit range-selection UI are pending.
- Raw-value enumeration shows the first 500 distinct values; category search
  and virtualization are pending.
- A recipe references but does not embed CNV content.
- Legacy `.TAB` parsing requires evidence from real files and TabWin 4.15.

Recommended next slice: complete chart families with a versioned chart-view
specification, followed by map class methods and interaction.

