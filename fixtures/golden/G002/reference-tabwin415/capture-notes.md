# G002 TabWin 4.15 reference capture

Semantic under test: **row x column tabulation**.

The user ran the protocol in the isolated TabWin 4.15 directory and provided
`result.xls`, a 1133-byte BIFF export generated directly by TabWin.
No row, label or value was edited afterwards.

The export preserves:

- table title: `TabWin:C:\Users\angelogabriel860\Desktop\gol\g002.tab`
- analysis title: `Freqüência por Caráter atendimento segundo Complexidade do Procedimento`
- row dimension header: `Complexidade do Procedimento`
- 4 ordered result row(s) across 6 column(s)
- TabWin's own column totals: [2092,2223,0,0,0,0]

## Findings

- TabWin renders all six CARATENDc.CNV categories, including the four with no data in this file — it does not hide empty columns. That was the open question this case was designed to answer.
- The export carries a Total column and a Total row. Both are TabWin presentation and are recorded as evidence, never compared as result cells.

## Comparison result

Compared against this executor with absolute tolerance 0:
**PASS** — row labels true, column labels true, shape true, 0 differing cell(s).
