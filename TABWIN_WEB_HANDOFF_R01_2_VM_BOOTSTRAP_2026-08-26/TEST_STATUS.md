# Test Status

Verified on 2026-08-27 through the local R05.3-A offline-cache/provenance slice.

## Portable check

Command:

```bash
npm run check
```

Result:

- 86 tests;
- 86 passed;
- 0 failed or skipped;
- TypeScript kernel build passed;
- browser typecheck passed;
- Vite production build passed.

The separate `npm run proxy:check` Wrangler gate also passed: the production
Worker configuration bundled to 18.43 KiB (4.81 KiB gzip) with the exact
GitHub Pages origin and all seven limit/timeout bindings.

R05.3-A extends recipe round-trip validation with optional official source URL,
retrieval time and archive SHA-256 provenance. Browser typecheck and production
build cover recent-download listing, aggregate cache size, individual/all-entry
removal and offline data-envelope reopen. A local 390 x 844 browser case found
no horizontal overflow or console errors. Pages deployment `a902224` migrated
the existing public-browser SIH cache and reopened `RDAC2401.dbc` offline with
4,315 records, 113 fields and separate DBC/archive SHA-256 provenance.

R05.2 replaces the two proxy-envelope tests with eleven focused tests covering
fixed routes, exact archive URLs, origin canonicalization, unconfigured and
hostile origins, per-route methods, constrained preflight, form media/size
limits, header filtering, redirect rejection, normalized failures and bounded
ZIP streaming. No test changes a legacy analytical golden.

Production evidence additionally verifies Worker health 200, hostile origin
403 without CORS reflection, hostile archive target 400, valid preflight 204,
catalog/prepare 200 and a complete 287,299-byte ZIP stream. The published Pages
build found `RDAC2401.dbc`, opened it and loaded the verified SIH auxiliaries;
the file list included `COMPLEX2.CNV`.

The root GitHub Actions workflow is discoverable. Retried run `33120550257`
created a build job, then GitHub rejected it before checkout with the annotation
that the account is locked due to a billing issue. Therefore CI execution is
externally blocked; it did not produce a failing test or build step.

The inherited 22-test baseline remains intact. Nine tests now additionally
cover real DATASUS request/response contracts, rejection of non-official
download domains, catalog coverage, CSV/XML export and the three R02.0
DEF/MAP cases.

R04.1 adds five pure table-operation tests covering immutable binary columns,
explicit division-by-zero behavior, deterministic multi-step replay, every
documented total policy and invalid column references. Recipe parsing now
validates persisted operation payloads. A local browser run against the real
G001 DBC verified factor application, totals, history, undo and a 390 px mobile
layout without horizontal document overflow.

R04.2 adds three pure presentation tests covering stable numeric/key sorting
without source mutation, accent-insensitive key/label location and exact TSV
clipboard output in presented order. Browser verification over the real G001
DBC checked descending frequency order, locating municipality `120040`, key
visibility, Audit state and clipboard content.

R04.3 adds three executor tests covering exclusion inversion, inclusive and
exclusive numeric bounds, unmatched CNV selection and explicit unclassified
axis materialization. Browser verification over the real G001 assets checked
`SEXO=3` exclusion (1,761 accepted), `IDADE=20–39` inclusion (1,663 accepted)
and a zero-valued `Não classificados` row for `COMPLEX2.CNV`.

R04.4 adds four expression tests covering precedence, parentheses,
right-associative power, unary signs, `Cnn`/key/bracketed-label references,
explicit zero-division handling, non-finite results and rejection of executable
syntax. Browser verification over the real G001 DBC checked `C01 * 2 + 1`
and obtained `2 -> 5` with the exact expression recorded in Audit.

R04.5 adds four structural-operation tests covering immutable rename/move/delete,
row suppression, replacement or appended aggregation, total exclusion and
guards against final-column deletion, boundary movement and empty row sets.
Browser verification chained expression/rename/move, aggregated 22 matching
municipalities and proved suppression undo restores the removed row.

R04.6 adds a deterministic OOXML workbook test. It opens the generated ZIP,
checks both `Tabela` and `Auditoria` worksheets, verifies numeric result cells,
escaped provenance, a fixed workbook timestamp and byte-identical repeated
generation. Browser typecheck and production build include the local XLSX
download button without introducing a spreadsheet runtime dependency.

R04.7 adds three portable-table tests covering deterministic serialization and
round-trip parsing, exact result matrix shape, finite numeric cells, unique
axis keys, record counts, QueryPlan compilation, operation validation and
presentation bounds. Browser verification opened a `.twtable` without a DBC,
restored its title/row label/sort, then applied a factor column (`12 -> 24`).

R05.0 adds two DBF-source tests covering validated pass-through copies,
metadata retention, safe local filenames and extension rejection. Browser
verification expanded the real 313,213-byte `RDAC2401.dbc`, revalidated its
xBase header and reported `RDAC2401.dbf` with all 4,315 declared records.

R05.1 adds six tests for UTF-8 BOM, CSV/semicolon/TSV delimiters, quoted
delimiters and line breaks, decimal comma, leading-zero preservation, malformed
row/header rejection, Windows-1252 DBF writing, character/numeric/date/logical/
integer round trips, explicit width errors and CSV -> QueryPlan selection -> DBF
decoding. Browser verification loaded three CSV rows, applied `UF = AC`, showed
two accepted records and produced a two-record selected DBF.

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
