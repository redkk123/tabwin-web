# G003 TabWin 4.15 reference capture

Semantic under test: **sum measure instead of frequency**.

The user ran the protocol in the isolated TabWin 4.15 directory and provided
`result.xls`, a 380-byte BIFF export generated directly by TabWin.
No row, label or value was edited afterwards.

The export preserves:

- table title: `(blank)`
- analysis title: `Valor Total segundo Complexidade do Procedimento`
- row dimension header: `Complexidade do Procedimento`
- 4 ordered result row(s) across 1 column(s)
- TabWin's own column totals: [4308072.7600000035]

## Findings

- Column header is "Valor Total" — the DEF increment label verbatim, not a generic word. This case established that behavior; the executor previously emitted "Valor" behind a comment saying it was waiting for exactly this golden.
- Float accumulation: TabWin stores 3016736.9200000037 for Média complexidade; this executor computes 3016736.920000003 — exactly 1 ULP apart, with our value marginally closer to the mathematically exact sum (3016736.92). Both render identically at the two decimals VAL_TOT declares in the DBF header, so the comparison runs at that declared precision. See CompareGoldenOptions.decimalPlaces for why that is the field talking, not a softened tolerance.

## Comparison result

Compared against this executor with absolute tolerance 0, at the source field's declared 2 decimal places:
**PASS** — row labels true, column labels true, shape true, 0 differing cell(s).
