# Assisted data cleaning — progress report

**Date:** 2026-08-28  
**Status:** MODERN, NON-DESTRUCTIVE FIRST SLICE COMPLETE

## 1. Outcome

The analysis panel now provides assisted numeric data cleaning while preserving
the original DBC/DBF records. It supports the professor-guided workflow where a
researcher notices a suspicious value — for example an extreme age in a study
of pregnancy — examines its distribution, chooses a defensible valid interval
and records that decision as part of the reproducible analysis.

No value is silently corrected, overwritten or deleted.

## 2. User workflow

1. Select any source field in **Limpeza assistida**.
2. Inspect numeric, missing, invalid, observed-range, median and IQR-outlier
   counts calculated from the loaded raw records.
3. Either type a valid minimum/maximum manually or ask the application to fill
   the conventional 1.5×IQR suggestion.
4. Review the proposed limits in their clinical/research context.
5. Explicitly apply the range.

The IQR action only fills the editable inputs; it never applies a filter by
itself. A manually entered range is equally supported and is the intended path
for domain rules such as a researcher-defined maximum age.

## 3. Reproducibility and audit

An applied cleaning range becomes a normal inclusive numeric `FilterSpec` with
`origin: data-quality`. Therefore it:

- passes through `AnalysisSpec -> QueryPlan -> Executor`;
- appears as **Limpeza** in the active filter list;
- is included in the QueryPlan audit with a non-destructive-policy warning;
- is saved and replayed by `.twrecipe`;
- can be removed like any other filter;
- affects selected-DBF export only when the user deliberately exports the
  selected subset;
- never mutates the loaded source records.

## 4. Numeric diagnostics

The profile separates:

- missing values;
- non-numeric/invalid values;
- finite numeric values;
- distinct numeric values;
- minimum, Q1, median, Q3 and maximum;
- values outside the conventional 1.5×IQR fences.

Decimal commas are accepted consistently with the existing numeric range
executor. IQR outliers are statistical signals, not declarations of error.

## 5. Verification

`npm run check` passed:

- 100 tests passed, 0 failed;
- semantic-kernel TypeScript build passed;
- browser TypeScript check passed;
- Vite production build passed.

Tests cover mixed numeric/missing/invalid input, an extreme value, constant and
empty fields, immutability, filter provenance and rejection of an unknown
automatic-cleanup origin.

The local browser-control surface refused the localhost URL under its URL
policy. No bypass was attempted. Visual interaction remains a release-smoke
item; static UI bindings, strict type checking and the production build passed.

## 6. Compatibility classification

### KEEP

- manual minimum/maximum cleaning range;
- diagnostic-only numeric profile;
- suggestion that fills but does not apply;
- explicit recipe/audit provenance;
- immutable source records.

### DEFER

- clinical presets such as biologically plausible pregnancy-age ranges until
  an authoritative source and scope are attached;
- cross-field rules (`pregnant = yes` AND `age > threshold`);
- category-frequency shifts and null-rate drift across periods;
- duplicate-person/event diagnostics;
- correction/imputation workflows, which require a separate provenance model.

## 7. Next safe step

Resume the navigable Data Catalog block. Later Research Mode can extend this
same diagnostics layer to multi-period schema drift, missing UF/period files
and abrupt category/null changes without silently cleaning them.
