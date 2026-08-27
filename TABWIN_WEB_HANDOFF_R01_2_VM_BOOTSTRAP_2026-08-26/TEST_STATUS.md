# Test Status

Verified on 2026-08-27 through the R04.0 G001 exact-golden milestone.

## Portable check

Command:

```bash
npm run check
```

Result:

- 46 tests;
- 46 passed;
- 0 failed or skipped;
- TypeScript kernel build passed;
- browser typecheck passed;
- Vite production build passed.

The inherited 22-test baseline remains intact. Nine tests now additionally
cover real DATASUS request/response contracts, rejection of non-official
download domains, catalog coverage, CSV/XML export and the three R02.0
DEF/MAP cases.

## Live official-source verification

Command:

```bash
npm run verify:datasus-live
```

Observed against the public DATASUS service:

- catalog returned `RDAC2401.dbc` for SIH-RD / AC / 2024-01;
- DATASUS prepared an HTTPS archive on `datasus.saude.gov.br`;
- archive contained the 313,213-byte DBC;
- DBC metadata declared 4,315 records of 702 bytes;
- auxiliary catalog returned current `TAB_SIH.zip`;
- nested auxiliary archive contained 886 entries;
- `RD2008.DEF` and `COMPLEX2.CNV` were present.

This verifies acquisition and format envelopes. G001 separately establishes
exact TabWin 4.15 equivalence for its narrowly defined frequency workflow.

## G001 real TabWin 4.15 golden

Commands:

```bash
npm run verify:g001 -- <asset-directory> <reference-export.xls>
npm test
```

Observed result:

- lossless TabWin BIFF export SHA-256:
  `2ECF97628F3658C98A7F366A3419C1388E024F2FAE94F81A66C10A77EB019D16`;
- DBC records declared/decoded/seen/accepted: `4315/4315/4315/4315`;
- row labels and order: exact;
- column label and order: exact (`Freqüência`);
- matrix shape: exact;
- numeric tolerance: zero;
- differing cells: zero;
- result: PASS.

The two new portable tests cover real six-field DEF metadata preservation and
the committed TabWin BIFF reference export. Raw DBC/DEF/CNV assets remain
external and are verified by hash during the local end-to-end run.

R02.2 reuses the already tested sum, raw/CNV filter, DEF start-position and
DEF bridge behavior. Browser typechecking and the production build cover its
new controls; dedicated interaction tests remain future browser-test work.

R02.3 adds tests for invalid recipe plans/fingerprints and deterministic
intersection of simultaneous filters. Portable recipe round-trip coverage
remains passing.

R03.0 adds pure visualization-model tests for ranked row totals without
result mutation and first-to-last arrow derivation/order. Recipe validation
also rejects unknown chart types. SVG renderer behavior is covered by browser
typechecking and the production build; dedicated visual regression cases are
still pending.

R03.1 adds deterministic tests for equal-interval and quantile map classes,
stable equal-value coloring and source-array immutability. Browser typechecking,
the production build and a local interface inspection cover the new map
toolbar and interaction bindings; automated pointer-level browser tests remain
future work.

R03.2 adds tests for descriptive sample measures without input mutation, exact
Pearson/regression behavior, histogram maximum-endpoint inclusion and explicit
constant-series errors. Browser typechecking, production build and local visual
inspection cover the new Statistics tab shell.

R03.3 adds two tests proving that the optional DATASUS proxy exposes only the
fixed official catalog/prepare routes and accepts archive streaming only for
the official prepared `zipupload/.../arquivo.zip` envelope. The published site
shell and official catalog dialog were inspected in GitHub Pages; the static
origin correctly surfaces the unresolved official CORS blocker.
