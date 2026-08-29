# G004 TabWin 4.15 reference capture

Semantic under test: **CNV-backed selection filtering records before aggregation**.

The user ran the protocol in the isolated TabWin 4.15 directory and provided
`result.xls`, a 431-byte BIFF export generated directly by TabWin.
No row, label or value was edited afterwards.

The export preserves:

- table title: `TabWin:C:\Users\angelogabriel860\Desktop\gol\g002.tab`
- analysis title: `Freqüência segundo Complexidade do Procedimento`
- row dimension header: `Complexidade do Procedimento`
- 4 ordered result row(s) across 1 column(s)
- TabWin's own column totals: [2092]

## Findings

- Records seen 4,315; records accepted 2,092 — the filter runs before aggregation, and 2,092 is exactly the Eletivo column total TabWin reports independently in G002.
- The selection role binds to CARATEND.CNV, a different file from the column role CARATENDc.CNV used by G002. Both are real, both are present, and their category labels differ.

## Comparison result

Compared against this executor with absolute tolerance 0:
**PASS** — row labels true, column labels true, shape true, 0 differing cell(s).
