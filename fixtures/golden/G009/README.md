# G009 fixture workspace

Semantic under test: **numeric-range CNV (F mode)**.

Captured 2026-08-29 with `AIH_MA.DEF` + `PERM.CNV` over a byte-identical,
renamed copy of `RDAC2401.dbc` (see `reference-tabwin415/capture-notes.md`
for why the rename was necessary and why it is safe).

This case found a real executor defect — the DEF start position was being
applied to numeric-range classification. This golden is immutable; if it
fails, the change is wrong until proven otherwise.
