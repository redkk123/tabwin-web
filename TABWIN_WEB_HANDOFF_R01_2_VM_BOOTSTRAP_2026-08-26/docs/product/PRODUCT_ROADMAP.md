# Product roadmap — TabWin Web

## North star

A user can open official DATASUS microdata locally, reproduce a familiar TabWin analysis, inspect every transformation, save a portable recipe and rerun the same analysis on updated data without installing a legacy Windows application.

## Product surfaces

### 1. Data workspace

- open local `.DBC` / `.DBF`;
- inspect source metadata and SHA-256;
- schema preview;
- multi-file period selection;
- official-source catalog for system/type/year/month/UF (**initial Web slice complete**);
- local persistence optional, explicit and revocable.

### 2. Tabulation builder

- row;
- column;
- increment/measure (**frequency and sum Web slice complete**);
- selections (**multiple inclusion filters Web slice complete; exclusion/ranges pending**);
- search inside category lists;
- zero suppression;
- compatibility/modern mode indicator;
- expert panel exposing DEF/CNV provenance.

### 3. Results

- virtualized table;
- sorting without silently mutating recipe semantics;
- charts;
- map;
- origin–destination flows;
- export CSV/XML/PNG (**initial Web slice complete**), then XLSX/Parquet/SVG as appropriate.

### 4. Audit

Every result should expose:

- application version/build;
- source filenames, hashes and sizes;
- DEF/CNV hashes;
- normalized QueryPlan;
- compatibility profile;
- warnings;
- record counts seen/accepted;
- generated recipe.

### 5. Recipes

Portable JSON recipes are a first-class product object.

Initial deterministic save/open is implemented in the Web workbench with
source/conversion fingerprints and safe plan validation.

Long-term operations:

- save analysis;
- open analysis;
- update data period while preserving logic;
- compare old vs new run;
- semantic diff of two recipes;
- share a recipe without sharing microdata;
- optionally encode/share recipe state in a URL when small enough.

## Release ladder

### R01 — Semantic kernel

Definition of done:

- CNV legacy parser;
- source-order matching;
- in-memory deterministic executor;
- count/sum;
- rows/columns/filters;
- row subtotals;
- deterministic recipe serialization;
- CI test runner.

### R02 — Real DBC ingestion

- pin browser-compatible DBC decoder;
- ingest real small fixture;
- hash file locally;
- schema preview;
- stream/cancel processing;
- benchmark memory;
- web worker boundary.

### R03 — DEF compatibility

- corpus of real DEFs;
- parser + normalized model;
- dependent CNV resolution;
- first UI generated from DEF.

### R04 — First true golden equivalence

- execute same case in TabWin 4.15 and TabWin Web;
- publish normalized evidence bundle;
- no compatibility branding before this milestone.

### R05 — Usable tabulation workbench

- modern control panel;
- local file drop;
- table result;
- recipe save/open;
- audit drawer;
- accessibility baseline.

### R06 — Geography

- modern licensed administrative geometries;
- choropleth;
- compatibility mapping adapters;
- origin–destination flow visualization.

### R07 — Institutional hardening

- offline/PWA/intranet deployment;
- dependency/SBOM policy;
- security headers;
- no-telemetry profile;
- accessibility audit;
- Design System GOV.BR compatibility assessment;
- release signing/checksums;
- admin deployment documentation.

## Deliberately deferred

- AI-generated epidemiological interpretation;
- user accounts;
- cloud storage;
- collaborative editing;
- server-side ingestion;
- arbitrary database connectors;
- perfect recreation of historical BDE/ODBC internals.
