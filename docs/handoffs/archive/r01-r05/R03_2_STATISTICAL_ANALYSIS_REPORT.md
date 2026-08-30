# R03.2 — Statistical analysis surface

**Date:** 2026-08-27
**Status:** FOUR CATALOGED OPERATIONS IMPLEMENTED AS MODERN CALCULATIONS
**Compatibility impact:** no numerical equivalence claim without oracle cases

## 1. Objective

Expose the four statistical operations named in the supplied TabWin 4.15 help
without inserting presentation or library behavior into the compatibility
compiler or executor.

## 2. Implemented

The new Statistics result tab operates over numeric columns already present in
the immutable `TabulationResult`:

1. descriptive statistics: count, sum, mean, median, minimum, maximum, sample
   variance and sample standard deviation;
2. Pearson correlation coefficient;
3. simple linear regression: slope, intercept and R-squared;
4. histogram with one to fifty configurable bins.

The selected operation, column keys and histogram bin count persist in portable
`.twrecipe` files. Invalid operation names and invalid bin counts are rejected.

## 3. Architecture and numerical policy

Pure calculations live in `packages/analysis/src/statistics.ts`. The module has
no DOM, DBC, DEF/CNV or query-planning dependency. The browser binds result
columns to those functions and renders cards/bars using text-safe DOM creation.

Current policy is explicit and modern: finite paired values, sample variance
and sample standard deviation, ordinary least squares, and endpoint-safe equal
width histogram bins. These policies must not be relabeled as TabWin 4.15
semantics until reference cases establish missing-value, denominator and
rounding behavior.

## 4. Verification

`npm run check` completed with 42/42 tests, browser typechecking and a production
build. New tests cover descriptive measures without input mutation, exact-line
Pearson/regression behavior, inclusion of the maximum histogram endpoint and
explicit failure for undefined constant-series cases. The empty-state interface
was visually inspected in the running app.

No golden expected output was changed.

## 5. Remaining statistics/table work

- Windows oracle cases and compatibility policies;
- sorting, percentage, cumulative and arithmetic table transformations;
- cell/row/column selection and derived-column workflows;
- export of statistics as structured CSV/XML and printable reports.
