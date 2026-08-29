# G005 TabWin 4.15 reference capture

Semantic under test: **zero-row suppression**.

The user ran the protocol in the isolated TabWin 4.15 directory and provided
`result.xls`, a 344-byte BIFF export generated directly by TabWin.
No row, label or value was edited afterwards.

The export preserves:

- table title: `TabWin:C:\Users\angelogabriel860\Desktop\gol\g002.tab`
- analysis title: `Freqüência segundo Complexidade do Procedimento`
- row dimension header: `Complexidade do Procedimento`
- 2 ordered result row(s) across 1 column(s)
- TabWin's own column totals: [4315]

## Findings

- The two zero rows present in G001 (Atenção Básica, Não se aplica) are absent from the result entirely — not blank, not collapsed into an "outros" row. Row count drops from 4 to 2.
- The Total row still reports 4,315: suppression removes presentation rows, it does not change what was counted.

## Comparison result

Compared against this executor with absolute tolerance 0:
**PASS** — row labels true, column labels true, shape true, 0 differing cell(s).
