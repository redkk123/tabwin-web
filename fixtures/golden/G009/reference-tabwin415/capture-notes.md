# G009 TabWin 4.15 reference capture

Semantic under test: **numeric-range CNV (F mode)** — `PERM.CNV` classifying
`DIAS_PERM` into length-of-stay bands.

## Why this capture needed a renamed source file

`AIH_MA.DEF` declares its data source as `D:\MA\MA\MA*.DBC`, so TabWin's
file picker never lists `RDAC2401.dbc`. The first attempt was recorded as a
protocol blocker for exactly that reason. The pattern is only a listing
filter, though — TabWin resolves fields by **name**, and every field this DEF
option uses exists in the RD file. Capturing therefore used
`MAAC2401.dbc`, a byte-identical copy of `RDAC2401.dbc` (same SHA-256)
renamed solely to match the pattern. Nothing that gets tabulated changed.

`AIH_MA.DEF` also references its CNVs without the `CNV\` prefix that
`RD2008.DEF` uses, so `PERM.CNV` had to sit beside the DEF rather than in
the `CNV\` subfolder.

## Finding: this case caught a real defect

The DEF declares **start position 2** for `DIAS_PERM`. The executor honoured
that for any position other than 1, slicing the value as text — and
`String(2).slice(1)` is `""`, which `Number()` turns into 0. That collapsed
**3,932 of 4,315** records into the "0 dias" band.

The real engine puts only **212** there and reproduces a plausible
length-of-stay distribution. A numeric-range CNV classifies the **value
itself**; the DEF start position does not apply to that mode at all. Fixed in
`packages/core/src/execute.ts`, covered by a unit test, and this golden now
reproduces cell-for-cell.

- Title: `Movimento de AIH - Maranhão`
- Subtitle: `Freqüência segundo Permanência`
- Shape: 12 row(s) x 1 column
- TabWin Total row: 4315
- Session log reported by TabWin: 4315 records processed
