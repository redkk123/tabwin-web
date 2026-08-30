# Golden compatibility test strategy

## Goal

Prove that TabWin Web reproduces the result of TabWin 4.15 for defined, versioned input bundles.

A compatibility claim is allowed only for behaviors represented by passing golden fixtures.

## Golden bundle layout

Each case should eventually live under `fixtures/golden/<case-id>/` with:

- `README.md` — human explanation;
- `input.manifest.json` — hashes, sizes and provenance;
- exact DBC/DBF input or a retrieval manifest when redistribution is not permitted;
- exact DEF;
- dependent CNVs;
- `recipe.json` — normalized TabWin Web analysis recipe;
- `tabwin415/`:
  - screenshot of control panel;
  - screenshot of result;
  - exported table;
  - `.TAB` when permitted;
  - TabWin log;
- `expected.json` — normalized expected row/column/cell matrix;
- notes about version-specific quirks.

## Minimum golden ladder

### G001 — Frequency, one row dimension

- real SIH-RD data;
- no filters;
- one simple conversion;
- measure = frequency.

### G002 — Row × column frequency

Adds a second dimension.

### G003 — Selection/filter

Exercises conversion-backed selection semantics.

### G004 — Numeric increment

Exercises a monetary/numeric sum field and rounding.

### G005 — Overlapping CNV rules

Proves precedence behavior.

### G006 — Subtotal CNV

Proves parent accumulation and total semantics.

### G007 — Missing/blank/deleted records

Proves edge-case handling.

### G008 — Saved `.TAB` replay

Proves migration/reproducibility behavior.

## Comparison layers

1. **Structural:** same row/column labels and order.
2. **Numeric:** identical cells for integer frequency cases.
3. **Formatting:** separately compare displayed numeric formatting.
4. **Provenance:** hashes and definitions recorded.
5. **Behavioral:** warnings/ignored records documented.

## Rule

A failing golden case blocks a release when it covers a behavior advertised as `TabWin 4.15 compatible`.
