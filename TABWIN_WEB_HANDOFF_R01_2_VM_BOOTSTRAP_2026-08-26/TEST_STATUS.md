# Test Status

Verified on 2026-08-27 for the R02.1 official acquisition/export milestone.

## Portable check

Command:

```bash
npm run check
```

Result:

- 31 tests;
- 31 passed;
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
