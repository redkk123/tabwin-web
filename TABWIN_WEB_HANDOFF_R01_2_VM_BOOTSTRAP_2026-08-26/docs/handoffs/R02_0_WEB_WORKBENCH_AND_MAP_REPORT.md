# R02.0 — Web workbench and legacy MAP milestone report

Date: 2026-08-26  
Status: implementation complete; GitHub Pages publication pending at the time
of this report revision.

## 1. Objective

Turn the R01 semantic kernel into the first useful cross-platform product slice:

- open a real DATASUS DBC/DBF entirely in the browser;
- run an immediate, deterministic frequency tabulation;
- show table, chart, map and audit views;
- accept legacy DEF, CNV and MAP files;
- remain deployable as static files on GitHub Pages;
- preserve `AnalysisSpec -> QueryPlan -> Executor -> TabulationResult`.

This milestone does not claim complete TabWin behavioral compatibility and does
not mark G001 as golden-equivalent.

## 2. Supplied TabWin 4.15 reference

The project owner supplied `arquivo.zip` as an authorized reference package.
It was inspected statically; no executable was launched in this milestone.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `arquivo.zip` | 15,651,984 | `C757F1174FA79D84D83887EF5F1306E09565D566C1A585065C455B519FF88853` |
| nested `TAB415.zip` | 15,670,769 | `A7371B19292F368212575D9BB59E261C95B3135C46A1294BC370F04BA21192E6` |
| `MAPAS/br_municip.MAP` | 4,987,642 | `BB8D09EA2B47CF422F8ADD4C49C16AB8D5EEA0487CC1E76FC398B7E7140011FA` |
| `MAPAS/br_ufsigla.MAP` | 443,058 | `D97DA34FD7831B0577A37135C6875F9BE5968281AA7D1F57E552A3ADDE92AD56` |

The distribution contains the executable, WinHelp contents/help, DEF/CNV
documentation, history, utilities and 39 cartographic MAP files. Its
`TABWIN32.CNT` index catalogs 17 sections and 150 named topics. The resulting
feature matrix is in `docs/legacy/TABWIN_415_FEATURE_INVENTORY.md`.

## 3. Compatibility changes

### DEF

Real `RD2008.DEF` uses textual third fields with non-DBF resources, for example:

```text
LSubTp FAEC,FAEC_TP,DS_TPFIN,CNV\TP_FINAN.CNV
```

The parser previously misclassified this as a DBF lookup and rejected it in
strict mode. R02.0 adds a loss-aware `external-lookup` node. The node retains
the field, label field, resource path, roles and source line but remains
non-executable. No semantics were invented.

### MAP

The new binary MAP parser reads:

- little-endian version (`100` = 1.00);
- east/north/west/south float32 bounds;
- polygon, polygon-with-seat, line and point object types;
- Pascal-length geocode and name fields stored in fixed-width slots;
- label coordinates;
- point sequences and repeated-start polygon parts.

It rejects truncation, unknown types, invalid Pascal lengths, non-finite
coordinates and configurable safety-limit violations with byte offsets.

Validation against the supplied assets:

| Map | Objects | First object | Bounds |
| --- | ---: | --- | --- |
| `br_ufsigla.MAP` | 27 | geocode `11`, name `RO`, 1,746 points | Brazil extent |
| `br_municip.MAP` | 5,570 | geocode `110001`, Alta Floresta D'Oeste, 316 points | Brazil extent |

## 4. Browser application

The Vite-powered static application provides:

- touch-friendly responsive layout for desktop, macOS and Android browsers;
- multi-file drag/drop and picker for DBC, DBF, DEF, CNV and MAP;
- browser-only DBC decompression and DBF decoding;
- local SHA-256 fingerprints;
- automatic first frequency after a DBC is opened;
- raw row and column selection;
- row CNV selection with DEF-derived start position when available;
- zero-row suppression;
- full result table (first 500 shown on screen) and complete CSV export;
- responsive horizontal bar chart for the top 24 result rows;
- canvas choropleth for uploaded or bundled TabWin MAP files;
- automatic bundled municipality/UF map selection for geographic fields;
- audit view with source hashes, related artifacts, QueryPlan, warnings and
  record counts.

No microdata upload, account, telemetry or backend is used.

## 5. Real-input verification

The R01.2-A candidate was rerun end-to-end through the decoder, real CNV parser,
compiler and executor:

```text
Source: RDAC2401.dbc
Rows: Complexidade do Procedimento / COMPLEX
Conversion: COMPLEX2.CNV
Records decoded: 4,315

Atenção Básica          0
Média complexidade  4,153
Alta complexidade     162
Não se aplica           0
Warnings                 0
```

These values are an expected Web candidate only. They must not become a golden
fixture until the exact same case is executed and exported from TabWin 4.15
under `docs/testing/G001_CAPTURE_PROTOCOL.md`.

## 6. Automated verification

The milestone command runs kernel compilation, Node tests, web type checking
and the production web build.

Result on 2026-08-26:

```text
25 tests passed, 0 failed
web typecheck passed
production build passed
application JS: 33.52 kB (12.58 kB gzip), excluding bundled maps
```

The local production-shaped flow was also exercised in a browser with the real
`RDAC2401.dbc`:

- automatic `MUNIC_RES` frequency produced 51 result rows;
- table view was visible and the empty state was hidden;
- chart view rendered 24 ranked bars;
- the bundled municipality map associated all 51 result areas and displayed a
  maximum of 1,789;
- audit view contained the source hash, QueryPlan and 4,315 record count.

The 22-test inherited baseline was preserved and expanded with:

- external DEF lookup retention;
- synthetic TabWin MAP polygon parsing;
- truncated MAP rejection with offset evidence.

## 7. Known limits and next safe work

- DBC decompression is currently in the main browser thread; large files need a
  cancellable Web Worker and memory benchmark before the mobile claim is hard.
- The UI currently surfaces frequency and row CNV. Sum/increment and filters
  exist in the kernel but need DEF-driven controls.
- The first chart is horizontal bars. The other chart families are cataloged,
  not yet implemented.
- The first map uses a continuous square-root color scale. TabWin equal-range,
  equal-frequency and manual-class behaviors still require oracle cases.
- Area hit testing, labels, seats, layers, zoom/pan and origin–destination flows
  remain future geography slices.
- Recipe save/open, `.TAB`, DBF subset writing and statistical operations remain
  separate milestones.
- G001 still needs the reference application run and evidence capture; no
  golden was modified to make a test pass.
