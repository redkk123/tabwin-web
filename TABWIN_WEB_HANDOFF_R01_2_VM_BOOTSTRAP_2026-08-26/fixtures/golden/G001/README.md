# G001 fixture workspace

The first real TabWin 4.15 reference capture is committed here as a compact,
derivative BIFF table export. Raw DBC/DEF/CNV assets remain outside Git; their
exact hashes and acquisition sources are recorded in `manifest.json`.

See `docs/testing/G001_CAPTURE_PROTOCOL.md`.

R01.2-A acquired and inspected the real inputs outside Git. The selected row is
now `Complexidade do Procedimento` (`COMPLEX` + `COMPLEX2.CNV`) because the real
DEF exposes `Sexo` only through unresolved directive `X`. See
`docs/handoffs/R01_2_A_G001_ASSET_ACQUISITION_REPORT.md` for hashes and evidence.

G001 passed locally with tolerance zero on 2026-08-27. Run the reproducible local
check with the externally materialized input directory:

```text
npm run verify:g001 -- <asset-directory> <reference-tabwin415/result.xls>
```

The committed regression test independently parses the original BIFF export.
The separate TabWin log/screenshot were unavailable and are explicitly noted;
they were not reconstructed.
