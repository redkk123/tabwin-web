# R04.4 — Safe expression columns

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — DOCUMENTED GRAMMAR, LEGACY EDGE GOLDENS PENDING

## 1. Outcome

The browser now implements the documented TabWin New Column outcome with a
small arithmetic language. Users can derive a column from constants and
existing base or previously derived columns without running JavaScript or
mutating the executor result.

## 2. Supported grammar

Expressions support:

- decimal and scientific-notation constants;
- one-based `C01`, `C02`, `C1` column references;
- exact internal column keys;
- labels with spaces using brackets, for example `[População residente]`;
- parentheses;
- unary `+` and `-`;
- addition, subtraction, multiplication, division and power;
- ordinary arithmetic precedence and right-associative power.

Examples:

```text
C01 * 100 / C02
(C01 + C02) / 2
[Eventos] / [População residente] * 100000
2 ^ 3 ^ 2
```

The parser never calls `eval`, `Function` or a JavaScript interpreter. Unknown
tokens, missing/ambiguous columns, incomplete parentheses and trailing input
fail explicitly.

## 3. Numerical policies

Division by zero uses the existing explicit `error` or `zero` policy. Infinity,
NaN and power overflow are rejected with the result row number. Missing cells
within an otherwise valid column retain the result model's current numeric-zero
policy.

Exact TabWin 4.15 behavior for locale decimal syntax, rounding, error cells and
ambiguous duplicate titles remains golden-pending. The Web grammar's bracketed
title syntax is a safe modern extension until the oracle establishes any
legacy quoting form.

## 4. Architecture and reproducibility

`TableOperation` adds an `expression` variant containing the source string,
zero-division policy and derived-column metadata. Parsing happens once before
row evaluation. The operation appends an immutable derived column and is
replayed in recipe order, so expressions may reference an earlier derived
column.

Recipe validation rejects empty expressions and invalid policies before
replay. Audit retains the exact source expression.

## 5. Verification

`npm run check` passed:

- 61 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

Four new tests cover precedence, parentheses, unary/power behavior, all column
reference forms, division-by-zero policies, non-finite results, missing columns
and executable-looking syntax rejection.

A browser inspection loaded `RDAC2401.dbc`, entered `C01 * 2 + 1` and observed:

| Field | Value |
| --- | --- |
| Original first row | `2` |
| Derived first row | `5` |
| Header | `Teste fórmula` |
| Audit expression | `C01 * 2 + 1` |

## 6. Remaining table editing

Column rename/move/delete, row suppression/aggregation, normalization,
editable headers/footnotes and legacy `.TAB` persistence remain separate
inventory items. They will not be folded into expression execution because
presentation state and data transforms require distinct audit semantics.
