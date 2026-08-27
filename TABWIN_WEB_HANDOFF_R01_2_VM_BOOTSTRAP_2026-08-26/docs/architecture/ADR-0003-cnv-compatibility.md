# ADR-0003 — CNV compatibility is source-order-sensitive

**Status:** Accepted for R01  
**Date:** 2026-08-26

## Context

The supplied TabWin documentation establishes that `.CNV` files are fixed-column conversion tables, not simple dictionaries. They can encode exact codes, inclusive ranges, repeated category rows, row subtotals, comment/non-total markers and continuous numeric ranges.

Most importantly, overlap behavior is observable. The documentation's month example explicitly demonstrates that in short-code mode a later specific rule overrides an earlier broad range. The documentation separately notes first-index behavior for long/literal variables.

## Decision

1. Preserve every rule line and its original source order.
2. Represent categories separately from rule lines.
3. Use explicit precedence metadata:
   - short codes: `last-match-wins`;
   - literal/long codes: `first-match-wins` until contradicted by golden tests;
   - numeric ranges: first inclusive upper bound reached in source order.
4. Apply subtotal pointers only to row dimensions, matching the legacy documentation.
5. Parse `#` in the legacy subtotal field as `excludeFromTotal` metadata.
6. Detect the post-2011 `N` CNV format but do not guess its widened field offsets until a canonical file/specimen is acquired.

## Consequences

- A `Map<code,label>` representation is forbidden for the compatibility layer.
- Reordering CNV rules during serialization or optimization can change results and is therefore a breaking transformation.
- Golden tests must include overlapping rules, literal codes, ranges and subtotal cases.
