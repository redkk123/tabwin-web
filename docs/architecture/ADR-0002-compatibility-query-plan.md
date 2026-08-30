# ADR-0002 — Compatibility semantics precede SQL execution

- **Status:** Accepted in R00
- **Date:** 2026-08-26

## Context

DuckDB-Wasm is attractive for local analytics, but TabWin behavior includes semantics not naturally represented by a generic `GROUP BY`: CNV precedence, ranges, subtotals, total policies, selections and legacy-specific edge cases.

## Decision

UI state compiles into a versioned normalized `QueryPlan`. An executor adapter translates that plan to DuckDB (or another engine). The query engine is not the canonical definition of TabWin compatibility.

## Consequences

- semantic unit tests do not depend on SQL strings;
- executor can change without changing saved recipes;
- compatibility profiles can be versioned;
- initial implementation is more structured but avoids later rewrite.
