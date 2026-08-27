# Test Status

Verified on 2026-08-27 through the R03.1 interactive-map milestone.

## Portable check

Command:

```bash
npm run check
```

Result:

- 38 tests;
- 38 passed;
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

This verifies acquisition and format envelopes. It does **not** constitute
TabWin 4.15 golden equivalence; the exact Windows reference capture for G001
is still pending and no golden expected output was changed.

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
