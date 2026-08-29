# G004 fixture workspace

Semantic under test: **CNV-backed selection filtering records before aggregation**.

Captured from the real TabWin 4.15 on 2026-08-29, part of the G002–G005 batch
defined in `docs/testing/G002_G006_CAPTURE_PROTOCOL.md`. Raw DBC/DEF/CNV
inputs stay outside Git; their exact hashes are in `manifest.json`.

Every case in this batch reuses G001's row dimension (`Complexidade do
Procedimento`, `COMPLEX` + `COMPLEX2.CNV`) and changes exactly one thing,
so a mismatch points at one semantic layer instead of several at once.

- `reference-tabwin415/result.xls` — the lossless BIFF export TabWin produced,
  unedited. This is the oracle.
- `reference-tabwin415/recipe.txt` — exactly what was selected in the UI.
- `reference-tabwin415/capture-notes.md` — findings, including anything that
  contradicted the prediction.
- `expected/golden-table.json` — the normalized table, derived from the export.
- `manifest.json` — asset hashes, evidence hashes and the recorded comparison.

This golden is immutable. If a change makes it fail, the change is wrong until
proven otherwise — never edit the expectation to make a run pass.

Committed regression (parses the BIFF export independently of the normalizer):

```bash
node --test tests/golden-corpus.test.mjs
```

Full executor run against the external raw assets:

```bash
npm run verify:goldens -- <asset-directory> <capture-root>
```
