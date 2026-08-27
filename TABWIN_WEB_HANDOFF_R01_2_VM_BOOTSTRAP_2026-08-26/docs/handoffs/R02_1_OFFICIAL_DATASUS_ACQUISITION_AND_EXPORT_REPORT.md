# R02.1 — Official DATASUS acquisition and modern exports

**Date:** 2026-08-27  
**Status:** IMPLEMENTED AND LIVE-VERIFIED  
**Compatibility impact:** no new TabWin 4.15 equivalence claim; acquisition is a modern extension

## 1. Objective

Add a browser-native way to find official public microdata without requiring
users to understand FTP directory names, while preserving the local-first
analysis architecture. Add immediate portable exports requested for tables,
charts and maps.

This milestone preserves the boundary:

```text
Official catalog/download -> DBC/DEF/CNV/MAP inputs
                                      |
                                      v
AnalysisSpec -> QueryPlan -> Executor -> TabulationResult -> exports/views
```

The acquisition adapter cannot create or reinterpret `AnalysisSpec` and does
not define legacy analytical semantics.

## 2. Official service discovery

The public DATASUS Transferencia de Arquivos page publishes its catalog data
and request behavior in:

- `https://datasus.saude.gov.br/transferencia-de-arquivos/`;
- `https://datasus.saude.gov.br/wp-content/transferencia.js`.

The official page uses two public, cross-origin-enabled endpoints:

1. `POST https://datasus.saude.gov.br/wp-content/ftp.php` searches by source,
   modality, file type, year, month and UF and returns official FTP addresses;
2. `POST https://datasus.saude.gov.br/wp-content/download.php` asks DATASUS to
   prepare selected FTP resources as a temporary HTTPS `arquivo.zip` hosted on
   `datasus.saude.gov.br`.

This resolves the browser's lack of FTP support without adding a TabWin Web
proxy or redistributing DATASUS files. The Web app accepts only
`ftp.datasus.gov.br` catalog entries and only prepared HTTPS URLs under the
official `/wp-content/zipupload/` path.

## 3. Product behavior

The new **Buscar no DATASUS** dialog provides:

- system selection;
- official data-type selection;
- year;
- month when the system is monthly;
- Brazil/UF coverage according to the selected file type;
- real-time official search;
- explicit not-found state;
- one-step **Baixar e abrir**;
- optional automatic auxiliary loading when a rule has been verified.

The initial catalog covers the major SIH, SIA, SIM, SINASC, CNES and SINAN
families plus CIH/CIHA, SISCOLO, SISMAMA, SISPRENATAL, e-SUS Notifica, RESP,
Painel de Oncologia, PCE and IBGE. SINAN currently exposes a representative
high-use subset in the friendly selector; expanding the list is catalog work,
not a compiler change.

## 4. Download and ZIP safety

The official HTTPS response is fetched directly by the browser and expanded
in memory. The extractor:

- admits only ZIP plus DBC, DBF, DEF, CNV and MAP entries;
- permits at most two nested ZIP levels;
- limits entry count to 5,000;
- limits one expanded file to 256 MiB;
- limits total expanded content to 512 MiB;
- does not write microdata to a server or repository.

Prepared archives are cached in IndexedDB on the user's device: data archives
for up to 24 hours and verified auxiliary bundles for up to seven days. The
cache retains at most six recent archives. Storage denial or private-browsing
restrictions are non-fatal and acquisition continues without persistence.

`fflate@0.8.2` is pinned for ZIP expansion. DBC decoding remains handled by
the separately pinned `@precisa-saude/datasus-dbc@2.0.2` adapter.

## 5. Auxiliary resolution

Automatic resolution is intentionally evidence-gated. The verified SIH-RD
rule currently:

1. searches the official SIHSUS auxiliary modality;
2. chooses the current `TAB_SIH.zip`, not a historical range bundle;
3. expands the nested package;
4. selects `RD2008.DEF`;
5. parses the DEF without changing its semantics;
6. loads the CNV resources referenced by that DEF;
7. leaves unsupported `N` CNV and `X` DEF behavior guarded as before.

No guessed definition-name rule was added for other systems. Those sources
continue to work as raw DBC data while their auxiliary mapping is verified.

## 6. Exports

Implemented exports:

- CSV: complete result matrix, UTF-8 BOM, RFC-style field quoting;
- XML: versioned tabulation structure with source, generation timestamp,
  dimensions, keys, labels, cells and record counts;
- chart PNG: current horizontal ranking rendered at export resolution;
- map PNG: current canvas choropleth at device-aware resolution.

The XML namespace is project-owned and must not be confused with a legacy
TabWin XML schema. XLSX, Parquet, SVG, GeoJSON and KML remain later slices.

## 7. Live official verification

`npm run verify:datasus-live` executed the complete official flow:

```text
catalogFile:          RDAC2401.dbc
preparedHost:         datasus.saude.gov.br
DBC bytes:            313,213
declared records:     4,315
record size:          702
auxiliary bundle:     TAB_SIH.zip
auxiliary entries:    886
verified entries:     RD2008.DEF, COMPLEX2.CNV
```

The test downloads public inputs temporarily and does not add them to Git.

## 8. Automated verification

`npm run check` result:

```text
31 tests passed
0 failed
browser typecheck passed
production build passed
```

New tests cover official request serialization, response parsing, domain/path
validation, catalog selection and deterministic CSV/XML generation. The 22
inherited tests and three R02.0 DEF/MAP tests remain unchanged and passing.

## 9. Known limits and next safe work

- Official search requires connectivity even when a previously prepared
  archive remains cached; an offline recent-files screen is not implemented.
- DBC decoding and ZIP expansion still run in the main browser thread. A
  cancellable Web Worker is required before large-file mobile claims.
- Friendly type coverage is not yet exhaustive for every SINAN notification.
- Automatic auxiliary selection is verified only for current SIH-RD.
- The official temporary ZIP endpoint can be slow; the UI times out with a
  recoverable message rather than fabricating a path.
- G001 still requires the exact Windows TabWin 4.15 capture. No golden was
  created or modified in this milestone.

Recommended next milestone: R02.2, moving ZIP/DBC work into a cancellable Web
Worker with progress and IndexedDB cache, followed by DEF-driven increments
and selection controls.
