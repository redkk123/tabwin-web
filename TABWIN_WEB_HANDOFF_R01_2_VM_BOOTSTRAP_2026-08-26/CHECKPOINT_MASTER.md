# CHECKPOINT MASTER — TabWin Web

**Revision:** R04.3-advanced-filters-and-unclassified
**Date:** 2026-08-27
**Status:** G001 exact golden passed; table operations, presentation and advanced selection workbench implemented
**Working name:** TabWin Web  
**Canonical role of this file:** project memory, context handoff, decision ledger, risk register and roadmap.  

> **Rule for future work:** do not rely on chat history as the only source of project state. Every meaningful decision, discovered behavior, test result, blocker, dependency change, compatibility finding, data-format discovery or roadmap change must be reflected here (or in a linked ADR) before a revision is considered closed.

## 2026-08-27 R04.3 advanced-selection update

Filters now have explicit include/exclude mode, category or numeric-range kind,
open/closed numeric boundaries, select-all/clear controls and unmatched-CNV
selection. Row dimensions may explicitly discriminate unmatched or empty
values as `Não classificados`; omission remains the default, preserving G001.
All policies compile into the QueryPlan and persist in recipes rather than
being applied as hidden UI filtering.

Portable verification is 57/57 plus browser typecheck and production build.
Real SIH-RD browser testing verified `SEXO=3` exclusion, `IDADE=20–39`
inclusion and zero-valued unclassified materialization for `COMPLEX2.CNV`.
Exact TabWin dialog defaults and labels remain golden-pending. Evidence is in
`docs/handoffs/R04_3_ADVANCED_FILTERS_REPORT.md`.

## 2026-08-27 R04.2 table-presentation update

The table now supports stable non-mutating sorting by key or numeric column,
accent-insensitive category location, automatic or 0–6 fixed decimals,
show/hide key, spreadsheet-ready TSV clipboard copying and a print stylesheet.
Sorting, decimal and key settings persist in `.twrecipe` and appear in Audit;
the locate query remains deliberately transient. Portable verification is
54/54 plus browser typecheck and production build. Real-DBC browser testing
verified descending sort, exact location, key visibility and clipboard output.
Evidence is in `docs/handoffs/R04_2_TABLE_PRESENTATION_REPORT.md`.

After the named functional matrix is substantially closed, the oracle phase
will generate short (target 2–5 minute) seeded and pairwise-selected TabWin
4.15 cases in batches of five. Reproducible randomized failures become
immutable goldens; no reference output is edited to make the Web candidate
pass.

## 2026-08-27 R04.1 table-operation update

R04.1 begins closing the complete TabWin 4.15 feature inventory after G001.
The browser now appends immutable derived columns for addition, subtraction,
multiplication, division, minimum, maximum, percentage, factor, accumulation,
absolute value, integer conversion, sequence and constants. Derived columns
carry explicit total policies: none, sum, product, mean, initial, final,
minimum or maximum. Division by zero is never implicit.

Operations execute after `TabulationResult`, never rewrite the source plan,
appear in the Audit view, support undo/reset, and persist in `.twrecipe` files
for ordered replay. The UI labels these as modern explicit policies until
focused 4.15 goldens establish dialog defaults, rounding and edge semantics.
Portable verification is 51/51 plus browser typecheck and production build.
Real-DBC browser inspection verified factor application, total recalculation,
history, undo and the 390 px responsive layout. Full evidence is in
`docs/handoffs/R04_1_AUDITABLE_TABLE_OPERATIONS_REPORT.md`.

## 2026-08-27 R04.0 golden-equivalence update

The user-provided TabWin 4.15 lossless BIFF export closed G001. The committed
reference has SHA-256
`2ECF97628F3658C98A7F366A3419C1388E024F2FAE94F81A66C10A77EB019D16`.
The local verifier checked the exact DBC/DEF/CNV hashes, decoded all 4,315
records and compared row labels, order, column label, shape and cells with
tolerance zero. Result: PASS, zero differences.

The oracle exposed two real implementation defects before passing: complete
`RD2008.DEF` parsing had to preserve unresolved six-field lookup tails, and
the TabWin 4.15 count header had to retain its exact legacy spelling
`Freqüência`. Both were fixed behind existing format/compatibility boundaries;
no golden value was altered. Evidence is in
`docs/handoffs/R04_0_G001_EXACT_GOLDEN_EQUIVALENCE_REPORT.md`.

Current portable verification is 46/46 tests plus web typecheck and production
build. Development now proceeds through the complete named-feature inventory
and additional focused golden cases.

## 2026-08-27 implementation update

The repository now contains a static Vite browser workbench that opens real
DBC/DBF files locally, tabulates through the preserved
`AnalysisSpec -> QueryPlan -> Executor -> TabulationResult` pipeline, applies
supported DEF/CNV metadata, displays tables/charts/maps/audit and exports CSV,
XML and PNG.

R02.1 added a separate official-source acquisition adapter. The browser can
search the public DATASUS Transferencia de Arquivos service by system, type,
year, month and UF, ask DATASUS to prepare the selected FTP resource as an
official HTTPS ZIP, expand it locally and open its DBC. The live verifier
confirmed `RDAC2401.dbc` (313,213 bytes; 4,315 records) and current
`TAB_SIH.zip` (886 entries including `RD2008.DEF` and `COMPLEX2.CNV`).

At R03.3, portable verification was 44/44 tests plus web typecheck and production
build. Full evidence and limitations are in
`docs/handoffs/R02_1_OFFICIAL_DATASUS_ACQUISITION_AND_EXPORT_REPORT.md`.
No compatibility golden had yet been captured at R03.3. R04.0 closes that
external-oracle requirement as recorded above.

R02.2 subsequently surfaced tested frequency/sum measures and one raw or
DEF/CNV-backed inclusion filter in the browser UI. These controls compile to
the existing QueryPlan model and are visible in audit output. Multiple filters,
exclusion/range dialogs and legacy total policies remain pending. Evidence is
in `docs/handoffs/R02_2_MEASURE_AND_SELECTION_UI_REPORT.md`.

R02.3 added deterministic `.twrecipe` save/open with source and CNV
fingerprints, safe plan validation, different-source warnings and simultaneous
filter cards. This is a modern reproducibility surface and not a claim of
legacy `.TAB` parsing. Evidence is in
`docs/handoffs/R02_3_RECIPES_AND_MULTI_FILTER_REPORT.md`.

R03.0 added accessible SVG renderers for all eight chart families cataloged in
the supplied TabWin help: horizontal/vertical bars, lines, areas, sectors,
points, bubbles and arrows. The selected family persists in recipes and every
chart exports standalone SVG or a 2,000 x 1,000 PNG. These are modern
presentation defaults, not a pixel-equivalence claim. Evidence is in
`docs/handoffs/R03_0_CHART_FAMILIES_REPORT.md`.

R03.1 added continuous, equal-interval and quantile thematic-map modes, class
count and palette controls, recipe/audit persistence, zoom, pan, reset and
local polygon hit testing. These are explicitly modern presentation modes;
legacy class endpoint and rounding equivalence remain unclaimed. Evidence is
in `docs/handoffs/R03_1_INTERACTIVE_MAP_CLASSIFICATION_REPORT.md`.

R03.2 added a Statistics result tab with descriptive statistics, Pearson
correlation, simple linear regression and histogram analysis over current
result columns. The calculations are pure, tested and recipe-persisted, but are
explicitly modern numerical policies until Windows reference cases establish
TabWin denominators, missing-value and rounding behavior. Evidence is in
`docs/handoffs/R03_2_STATISTICAL_ANALYSIS_REPORT.md`.

R03.3 published the static workbench at
`https://redkk123.github.io/tabwin-web/`, corrected stale READMEs and exposed a
strict allowlisted proxy contract for the official DATASUS transfer endpoints.
The public static site itself works, but direct catalog calls are blocked by
the official portal's duplicated CORS header; the proxy is specified and
tested but not deployed. A deterministic G001 materializer also reproduced the
exact documented DBC/DEF/CNV hashes, and the supplied TabWin 4.15 executable is
isolated for the Windows reference capture. Evidence is in
`docs/handoffs/R03_3_PUBLIC_RELEASE_AND_G001_ORACLE_READY_REPORT.md`.

---

# 0. Executive summary

We have a confirmed project: modernize the TabWin experience by building a web application rather than attempting to wrap or “convert” the legacy Windows executable.

The supplied archive contains the **TabWin 4.1.5 distribution**, dated in its own history file as **August 2018**, including the Windows executable, `dbf2dbc.exe`, legacy help/documentation, `.MAP` base maps, R integration scripts and configuration files. It does **not** contain TabWin source code.

Therefore the project should be treated as an **independent compatibility-oriented reimplementation**, not as a port of the original Delphi application.

The core product thesis is now stronger than “TabWin in the browser”:

> **A local-first, open, auditable and reproducible web workbench for DATASUS tabulation that preserves the important semantics and workflows of TabWin 4.15 while modernizing the interface and deployment model.**

A competing non-official web platform already advertises DBC download, browser tabulation, DuckDB, indicators and maps. Therefore a generic web clone is not sufficient differentiation. Our strongest defensible differentiators are:

- formal compatibility targets with TabWin 4.15;
- `.DEF` / `.CNV` semantics as first-class objects;
- `.TAB` replay / analysis reproducibility;
- deterministic provenance and equivalence tests;
- open-source governance and auditable builds;
- local-first/offline operation;
- institutional accessibility and deployment profiles;
- migration path for users with years of TabWin definitions and saved workflows;
- explicit separation between compatibility behavior and modern extensions.

The first technical milestone is **not** “make a pretty dashboard.” It is:

> **Load a real DATASUS dataset in the browser, execute a canonical tabulation represented by a normalized query plan, and prove the result matches a TabWin 4.15 golden output.**

---

# 1. Context and why this project matters

## 1.1 Confirmed project context

The current work is to transform the TabWin workflow into a modern website/web application and substantially update the UI. There is an expectation that the result may be shown or circulated to people in ministries / public-sector health institutions. That potential audience changes the engineering bar.

We should assume from the beginning that a credible institutional reviewer may ask:

- Can results be independently reproduced?
- Does it match TabWin on the same inputs?
- What happens to data loaded by the user?
- Can it run without sending data to a third party?
- Is it accessible by keyboard and screen readers?
- Is it deployable on an intranet or offline workstation?
- What licenses apply to the code and included assets?
- Can the build be audited?
- Can an old `.DEF`, `.CNV` or `.TAB` workflow be migrated?
- What happens when DATASUS changes a field or dataset?
- Who controls releases and security fixes?

The architecture must make good answers possible before those questions arrive.

## 1.2 Product identity

This project should **not** initially present itself as an official DATASUS/Ministry product. Until there is formal authorization, all public builds should clearly identify themselves as independent/non-official.

The working name “TabWin Web” is useful internally but branding/trademark/legal review is a **pre-public-release task**.

## 1.3 Product principles

1. **Compatibility before decoration.**
2. **Local-first by default.** User data should not be uploaded merely to perform a tabulation.
3. **Reproducibility is a product feature.** Every result should be explainable by inputs + configuration + software version.
4. **Progressive disclosure.** A beginner can tabulate without learning the legacy internals; an expert can inspect the exact semantics.
5. **No hidden transformations.** Any mapping, recoding, suppression or derived measure must be inspectable.
6. **Offline and intranet are legitimate deployment targets, not edge cases.**
7. **Public-health accessibility is non-negotiable.**
8. **Open formats at boundaries.** Even when we support legacy formats, modern exports should be portable.
9. **The original TabWin remains a reference oracle during compatibility development.**
10. **Never confuse a modern default with a compatibility default.** Modern convenience must not silently change a legacy result.

---

# 2. Evidence from the supplied TabWin 4.15 archive

## 2.1 Archive identity

Supplied nested package examined in R00:

- `TAB415.zip` SHA-256: `a7371b19292f368212575d9bb59e261c95b3135c46a1294bc370f04ba21192e6`
- `TabWin415.exe` SHA-256: `0e29a44de78d164ce13faa73ec74b76c77041fcf3d8bf6374a893b5e6a713f02`
- `dbf2dbc.exe` SHA-256: `f58411855f3bfa134006bb830b66ea67d8322fc6ca0d53927d6533bb881fc1db`
- `defcnv.htm` SHA-256: `d7e00573a0d0b9250401fadf949da17f1a0e1a1698a5eb33d77bad2757f5cc9c`
- `HISTORIA.TXT` SHA-256: `a24f337cf10409c2f7162442a90196019615b8071c4b3f4b9923d9d68c07305a`

Executable identification:

- `TabWin415.exe`: PE32 GUI executable, Intel i386 / Windows.
- `dbf2dbc.exe`: PE32 console executable, Intel i386 / Windows.

The distribution contains roughly 25 MB extracted.

## 2.2 Files of architectural relevance

Observed files include:

- `TabWin415.exe` — application binary;
- `dbf2dbc.exe` — DBC/DBF utility;
- `defcnv.htm` — documentation of conversion tables and related behavior;
- `DocTabWin.htm` — documentation including R/SQL integration;
- `HISTORIA.TXT` — long feature/change history reaching back to early versions;
- `TabWin.ini` — persistent desktop preferences;
- `autoexec.r`, `menu.r`, `modelo.rx` — R integration;
- `MAPAS/*.MAP` — national/UF/health-region/municipality map bases;
- legacy help (`.HLP`, `.GID`, `.CNT`), XSL/XML helper files and DLLs.

**Critical finding:** no TabWin source code was supplied. We must not architect around modifying the executable.

## 2.3 TabWin is not merely a DBC viewer

The history and documentation show a much broader application model. Relevant legacy capabilities include:

### Tabulation and data handling

- DBC/DBF processing;
- DEF-driven tabulation definitions;
- CNV code conversion/grouping tables;
- line, column, selection and increment concepts;
- many simultaneous selections/increments;
- zero-line suppression;
- searching long category lists;
- saving selected records/subsets;
- DBF viewing/editing and DBF generation;
- opening DBF directly as a table;
- PRN/TXT/XML import paths;
- automatic DEF/CNV prototype generation from DBF;
- column/row swap and table inclusion operations.

### Reproducibility / saved analysis

A particularly important historical feature is that TabWin can recover the control panel from a saved `.TAB`, restoring the selections used in the original tabulation so the operation can be repeated against updated data.

This is conceptually close to a modern **analysis recipe** and should be treated as a P0/P1 product idea, not a historical curiosity.

### Derived calculations

- new columns from expressions involving existing columns;
- arithmetic operations;
- minimum/maximum/absolute/normalization operations;
- descriptive statistics;
- multiple total semantics: no total, sum, product, mean, initial, final, min, max, pre-calculated.

### Mapping / spatial work

- thematic maps;
- `.MAP` bases;
- imports from historical GIS formats including SHP and MapInfo/ArcInfo-related formats;
- GPX/waypoint point layers;
- labels and point layers from DBF;
- configurable class boundaries / histogram-informed classes;
- area selection from the map;
- distance calculation from a selected point;
- exporting map bases including KML in 4.1.5;
- origin–destination flow matrices and flow arrows;
- saving flow tables.

The flow functionality is especially interesting because it points to use cases beyond simple choropleths: referral patterns, patient movement, service catchments and intermunicipal flows.

### R integration

TabWin historically supports analysis schemes (`.RX`) that pass the current table, titles, selected columns and parameters to R, receive text/plots and can load a modified data frame back into TabWin.

Modernization implication: we should preserve the **extension point concept**, but we do not need to reproduce the exact Windows `.Rprofile` process in the MVP.

### SQL integration

Legacy versions exposed SQL through the Borland Database Engine / ODBC, including saved queries, parameter substitution, visual query construction and DBF result output.

Modernization implication: BDE itself is obsolete and should not be reproduced. The user need is **queryability and repeatable queries**, which can be satisfied through DuckDB SQL locally and optional database connectors later.

## 2.4 CNV semantics already recovered from supplied documentation

The supplied `defcnv.htm` gives enough information to establish a first compatibility specification for `.CNV`.

Known behaviors include:

- first line contains category count and comparison/code length;
- fixed-position category rows;
- category sequence field;
- description field;
- comma-separated code list;
- inclusive ranges with hyphen notation;
- continuation rows using the same category sequence;
- comments after `;`;
- ordering can affect precedence when codes overlap;
- explicit literal mode (`L`);
- long-code/literal behavior;
- subtotal indicators in columns 1–3 when used as line definitions;
- special comment/non-total marker behavior documented historically;
- continuous numeric range mode (`F` / “Faixas”);
- later history notes a newer CNV format indicated by `N` in the first position of the first line, supporting a wider subtotal/description layout.

**Important implementation consequence:** CNV is not just a dictionary lookup. It can encode ranges, precedence, hierarchy/subtotals and numeric bins. Treating it as a simple `Map<code,label>` would be wrong.

A dedicated parser + normalized intermediate representation is required.

---

# 3. Current external landscape (checked 2026-08-26)

## 3.1 Browser DBC decoding is technically viable

The open-source project `@precisa-saude/datasus-dbc` currently documents:

- pure TypeScript DBC decoding;
- browser and Node compatibility;
- DBF parsing;
- CP850/Latin-1 to UTF-8 handling;
- validation on real SIA, CNES, SIH and SINAN files;
- Apache-2.0 licensing.

Reference: <https://github.com/Precisa-Saude/datasus-dbc>

This is a strong candidate for the initial DBC ingestion adapter. We should depend on the public API rather than embed/copy the implementation.

## 3.2 DuckDB-Wasm is a plausible execution backend

DuckDB-Wasm provides an in-browser analytical SQL engine and reads Arrow/Parquet/CSV/JSON. Its current repository is MIT licensed.

Reference: <https://github.com/duckdb/duckdb-wasm>

**Architectural warning:** DuckDB should be an **execution backend**, not the compatibility specification itself. TabWin semantics must be represented in our own normalized query plan so the same operation can be tested independently of the SQL generated for it.

## 3.3 There is already a non-official commercial/private web platform using the “TabWin” concept

At R00, `tabwin.blancsystem.com.br` advertises, among other features:

- DATASUS retrieval;
- DBC decompression in TypeScript;
- crossed tabulations;
- indicators;
- choropleths;
- descriptive statistics;
- search/drill-down;
- DuckDB embedded;
- a wide catalog of DATASUS systems.

Reference: <https://tabwin.blancsystem.com.br/>

Its public landing page describes itself as a non-official application and does not advertise a GitHub/open-source license on that page.

**Strategic consequence:** “DBC + DuckDB + charts in browser” is not a sufficient unique claim. Compatibility, reproducibility, migration and public governance become central differentiators.

## 3.4 Brazilian federal digital standards matter if this reaches ministries

The federal government Design System states that it standardizes digital interfaces, while current accessibility guidance references WCAG 2.1 and government accessibility practices. The eMAG remains a Brazilian government accessibility model.

References:

- <https://www.gov.br/ds/>
- <https://www.gov.br/ds/acessibilidade>
- <https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/acessibilidade-digital/modelo-de-acessibilidade>

This does **not** mean an independent prototype should impersonate an official gov.br property. It means we should architect components and accessibility so an institutional deployment can align with those standards later.

## 3.5 R01 fixture candidate identified after R00 baseline

A concrete small DBC fixture was located in the Apache-2.0 `Precisa-Saude/datasus-dbc` repository:

- file: `RDAC2401.dbc`;
- system: SIH-RD;
- geography/period: Acre, January 2024;
- repository file size shown by GitHub: ~306 KB;
- decoder repository's own end-to-end test documents 4,315 records and record size 702 bytes;
- the test states that the file was downloaded from the official DATASUS FTP and is used as a real decoder fixture.

References:

- <https://github.com/Precisa-Saude/datasus-dbc/tree/main/packages/dbc/test/fixtures>
- <https://github.com/Precisa-Saude/datasus-dbc/blob/main/packages/dbc/test/e2e.test.ts>

**Decision:** use this as the first R01 ingestion fixture if its redistribution/use under the repository license is confirmed in the cloned dependency context. It is intentionally not copied into this artifact yet.

**Runtime limitation in this session:** the web index exposed the binary and its metadata, but the current execution container could not materialize the raw octet-stream file. Therefore no claim is made that our own decoder path has executed successfully yet.


---

# 4. Product scope model: COMPAT vs UX vs INNOVATION

Every backlog item must have one primary tag.

## 4.1 COMPAT — replacement-critical behavior

These capabilities exist primarily because users already rely on TabWin semantics/workflows.

### P0/P1 compatibility targets

- load DBC;
- load DBF;
- inspect fields/schema;
- parse DEF sufficiently to expose valid dimensions/measures/selections;
- parse CNV with precedence, ranges, literals, subtotals and comments;
- lines;
- columns;
- measures / increment;
- selections / filters;
- deterministic total semantics;
- zero suppression;
- tabulation logs/provenance;
- save/reopen an analysis;
- eventually read/replay useful metadata from `.TAB`;
- CSV and modern spreadsheet export;
- compatibility-mode number formatting;
- encoding handling;
- tests against TabWin 4.15 outputs.

### P2/P3 compatibility targets

- DBF output/subset generation;
- legacy `.MAP` import or a deterministic migration converter;
- flow-table semantics;
- map association semantics;
- legacy SQL saved-query migration where practical;
- `.RX` migration/bridge concept;
- selected historical interchange formats only when real user demand is demonstrated.

### Legacy functionality we should not reproduce literally

- Borland Database Engine;
- Windows Registry discovery;
- WinHelp;
- WMF-centric graphics;
- desktop modal-window behavior;
- FTP as a browser protocol;
- obsolete spreadsheet formats solely for historical fidelity.

We reproduce the **user need**, not obsolete infrastructure.

## 4.2 UX — modernizing existing jobs

- drag-and-drop files;
- recent files/analysis history locally;
- universal search for variables/categories;
- filter chips rather than nested modal dialogs;
- live estimated row count / selected files;
- preview before execution;
- keyboard-first navigation;
- undo/redo for analysis configuration;
- autosave analysis configuration (not raw data by default);
- responsive layout;
- accessible tooltips and explanations;
- human-readable data dictionary;
- clear “basic” and “advanced” modes;
- progress/cancel for long jobs;
- virtualized large tables;
- downloadable error report when parsing fails;
- one-click “show how this result was produced.”

## 4.3 INNOVATION — capabilities beyond TabWin

High-value candidates:

### Reproducible analysis recipe

A versioned JSON model representing:

- input dataset identifiers;
- file hashes;
- source URLs when applicable;
- DEF/CNV hashes;
- selected periods/files;
- rows/columns/measures;
- filters;
- derived columns;
- display rules;
- app version;
- execution engine version.

Working future extension name: `.twproj` or `.tabwin.json` — **not decided**.

A recipe should contain **configuration and provenance, not user microdata**.

### Audit mode

For any output cell or table:

- show source dataset(s);
- show file fingerprint(s);
- show selected fields/categories;
- show generated normalized query plan;
- optionally show generated SQL;
- show warnings / missing files;
- show software/build version;
- export a machine-readable audit bundle.

This could become a defining institutional feature.

### “Repeat with latest data”

Modern equivalent of the legacy `.TAB` panel recovery:

1. open saved recipe;
2. detect newly available periods;
3. show what changed;
4. rerun using the same semantics;
5. compare old and new outputs.

### Result diff

Compare two runs and highlight:

- changed rows/cells;
- new/removed categories;
- changed input file hashes;
- changes due to software version vs data version.

### Data quality diagnostics

Without pretending to validate epidemiological truth, the app can flag structural anomalies:

- unexpected missing fields;
- field type drift;
- duplicate file periods;
- unknown categories;
- codes not covered by CNV;
- sudden category disappearance;
- inconsistent encoding;
- invalid dates;
- incompatible DEF-to-DBF schema.

### Codebook explorer

Click a variable/category to see:

- raw code;
- converted description;
- source CNV/rule;
- observed frequency;
- missing/unknown count;
- related official metadata link where available.

### Analysis export

Generate reproducible equivalents for advanced users:

- SQL;
- R script;
- Python script;
- possibly Quarto/Jupyter-ready snippets.

The app should never imply the generated script is identical internally to TabWin; it is an explicit reproducibility export.

### Spatial innovations

- modern choropleths;
- flow maps;
- proportional symbols;
- region/municipality drill-down;
- time slider;
- side-by-side comparison;
- export GeoJSON/KML/PNG/SVG;
- map/table linked brushing;
- accessible non-map alternative table for all spatial findings.

### Deployment profiles

1. **Public demo:** static host, user provides files.
2. **Institutional static:** self-hosted PWA, no application server for analysis.
3. **Intranet/offline:** pre-bundled app and optional curated metadata/catalog.
4. **Optional broker deployment:** server only for downloads/catalog/connectors, never required for local analysis.

---

# 5. User archetypes and workflows

## 5.1 Epidemiologist / surveillance analyst

Needs fast repeatable tabulations, monthly updates, filters, maps, code dictionaries and auditability.

## 5.2 Health service planner / manager

Needs facility/municipality summaries, trends, referral flows, indicators and exports that are understandable without learning file internals.

## 5.3 Researcher

Needs exact input provenance, stable definitions, raw/converted categories, reproducible recipes and machine-readable exports.

## 5.4 Legacy TabWin power user

Needs migration without losing `.DEF/.CNV/.TAB` knowledge and should recognize the conceptual model immediately.

## 5.5 Beginner/student

Needs guided dataset selection, search, sensible defaults and explanations without seeing a 1990s-style control panel.

## 5.6 Institutional IT/security team

Needs static/self-hosted deployment, dependency inventory, no hidden telemetry, CSP, release hashes, SBOM and predictable update behavior.

---

# 6. Proposed architecture

## 6.1 High-level model

```text
                        ┌─────────────────────────────┐
                        │      Modern Web UI / PWA    │
                        │ React/TS (candidate)        │
                        └──────────────┬──────────────┘
                                       │
                             Analysis Configuration
                                       │
                        ┌──────────────▼──────────────┐
                        │  Compatibility Domain Core │
                        │ normalized QueryPlan       │
                        │ DEF/CNV semantics          │
                        │ totals / suppressions      │
                        └───────┬───────────┬─────────┘
                                │           │
                       ┌────────▼───┐   ┌───▼────────────┐
                       │ Executor   │   │ Provenance/Audit│
                       │ DuckDB-Wasm│   │ hashes, recipe  │
                       └──────┬─────┘   └────────────────┘
                              │
                ┌─────────────▼───────────────────────┐
                │ Normalized records / Arrow-like    │
                └─────┬──────────────┬────────────────┘
                      │              │
             ┌────────▼──────┐ ┌─────▼────────────┐
             │ DBC/DBF adapter│ │ Modern formats   │
             │ datasus-dbc    │ │ CSV/Parquet etc. │
             └────────────────┘ └──────────────────┘
```

## 6.2 Why a compatibility domain core is mandatory

The most important architectural decision in R00 is to avoid implementing the app as “UI components that generate DuckDB SQL directly.”

Instead:

```text
UI state
  ↓
AnalysisSpec
  ↓
Compatibility compiler
  ↓
Normalized QueryPlan
  ↓
Executor adapter (DuckDB-Wasm first)
  ↓
TabulationResult
```

This gives us:

- unit-testable semantics;
- a place to encode CNV precedence/subtotals;
- future alternative executors;
- the ability to compare the same query plan to TabWin golden results;
- stable serialized recipes even if the backend engine changes.

## 6.3 Initial domain objects

Candidate concepts:

- `DataSource`
- `DataFile`
- `SourceFingerprint`
- `DatasetSchema`
- `FieldDefinition`
- `DefDefinition`
- `ConversionTable` / `CnvDefinition`
- `ConversionCategory`
- `SelectionRule`
- `DimensionSpec`
- `MeasureSpec`
- `TabulationSpec`
- `DerivedColumnSpec`
- `TotalPolicy`
- `SuppressionPolicy`
- `QueryPlan`
- `TabulationResult`
- `AnalysisRecipe`
- `ProvenanceManifest`
- `CompatibilityWarning`

## 6.4 File adapter strategy

Adapters should be isolated so legacy formats do not leak into UI components.

```text
packages/formats/
  dbc/
  dbf/
  def/
  cnv/
  tab/
  map/
```

Each adapter should expose:

- detection;
- parser;
- validation result;
- warnings;
- normalized model;
- round-trip writer only where safe/needed.

## 6.5 DBC pipeline

Initial candidate:

```text
File/ArrayBuffer
   ↓
@precisa-saude/datasus-dbc
   ↓
record stream / DBF schema
   ↓
normalization layer
   ↓
DuckDB table / Arrow pathway
```

Performance tests must determine whether we should:

- stream into Arrow batches;
- materialize records;
- convert DBC → temporary DBF buffer;
- use worker threads for decode;
- persist derived Parquet in browser storage only when explicitly requested.

No performance strategy should be committed before benchmarks on real SIH/SIA/SIM files.

## 6.6 Browser workers

Long-running decode and tabulation must run outside the UI thread.

Proposed workers:

- ingestion worker;
- query worker / DuckDB worker;
- optional geo conversion worker.

The user must be able to cancel work.

## 6.7 Local-first storage rules

Default:

- raw opened files: memory / file handle, not uploaded;
- recipes/settings: IndexedDB/local storage permitted;
- raw-data persistence: **opt-in only**;
- telemetry: **off by default** for institutional profile;
- third-party analytics: avoid in the core app;
- cloud sync: not part of MVP.

If browser persistent storage is later enabled for large files, shared-workstation threat models must be documented.

## 6.8 Data download is a separate architecture problem

A browser cannot simply depend on legacy FTP behavior. Direct official retrieval may face protocol/CORS/server limitations.

Therefore:

- MVP must work perfectly with user-selected local files;
- official data catalog/download is a separate adapter;
- we may support an optional broker/proxy deployment for retrieval;
- mirrored Parquet/DBC can be supported only with visible provenance and checksums;
- official-source vs mirror-source status must be obvious.

This prevents data-download infrastructure from blocking the compatibility engine.

## 6.9 Geography strategy

For built-in modern maps, prefer modern official/geospatial sources and a modern format (GeoJSON/TopoJSON/PMTiles as appropriate), with provenance.

Do **not** automatically redistribute the legacy `.MAP` files from the supplied archive until licensing/redistribution rights are clarified.

Legacy `.MAP` compatibility can be provided as:

- user-import parser, or
- one-time converter.

Candidate renderer: MapLibre GL JS (BSD-3-Clause), subject to proof-of-concept and accessibility strategy.

Reference: <https://github.com/maplibre/maplibre-gl-js>

---

# 7. Reproducibility and provenance model

This should become a first-class subsystem, not a later metadata feature.

## 7.1 Every run should have an immutable manifest

Candidate fields:

```json
{
  "recipeVersion": 1,
  "appVersion": "0.1.0",
  "buildCommit": "<git sha>",
  "executionEngine": {
    "name": "duckdb-wasm",
    "version": "..."
  },
  "inputs": [
    {
      "name": "RDDF2401.dbc",
      "size": 123,
      "sha256": "...",
      "source": "local|official|mirror",
      "sourceUrl": null
    }
  ],
  "definitions": {
    "def": {"sha256": "..."},
    "cnv": [{"sha256": "..."}]
  },
  "tabulation": {},
  "warnings": [],
  "createdAt": "..."
}
```

## 7.2 Determinism

Given the same:

- input file bytes;
- definitions;
- recipe;
- compatibility mode/version;

we should aim for the same tabulation values.

Presentation formatting can change independently, but raw result semantics must be versioned.

## 7.3 Compatibility profiles

Future possibility:

- `tabwin-4.15` compatibility profile;
- `modern` profile.

Example: a modern mode might present missing categories differently, but the compatibility profile must retain legacy calculation rules.

No such behavioral divergence should be introduced without explicit versioning and tests.

---

# 8. Equivalence testing strategy — core scientific/engineering requirement

## 8.1 Golden tests

For each canonical test case, preserve:

- input DBC/DBF fixture or reproducible download reference + hash;
- DEF;
- CNV(s);
- exact TabWin panel configuration;
- exported `.TAB`/CSV output;
- TabWin log if available;
- screenshot only as supplementary evidence;
- expected machine-readable table.

Test assertion:

```text
same input + same legacy semantics
→ same row categories
→ same column categories
→ same cell values
→ same totals, subject to documented formatting tolerance
```

## 8.2 Golden corpus matrix

Must eventually cover:

### Input types
- DBF;
- DBC.

### CNV behavior
- direct code mapping;
- overlapping mappings / precedence;
- short codes;
- literal codes;
- long codes;
- ranges;
- numeric `Faixas`;
- subtotal hierarchy;
- unknown codes;
- comments;
- new-format CNV (`N`) once fully specified.

### Tabulation behavior
- line only;
- line × column;
- multiple files/months;
- selections;
- multiple selections;
- increment/measure;
- zero suppression;
- totals;
- missing field error;
- encoding/accents;
- large cardinality.

### Real datasets
At least one canonical case each from:

- SIH;
- SIA;
- SIM;
- SINASC;
- SINAN;
- CNES.

## 8.3 Differential testing

Where possible, generate multiple randomized/simple DBF fixtures and run the same definitions through TabWin 4.15 and our engine to detect semantic mismatches.

This is especially useful for CNV precedence, totals and missing values.

## 8.4 TabWin oracle environment

We should maintain a documented Windows environment capable of running the original 4.15 package for reference tests.

The original binary should **not** be shipped inside our public repository unless redistribution rights are confirmed.

---

# 9. UI / interaction design

## 9.1 Target mental model

Legacy user recognizes:

- data files;
- line;
- column;
- increment/measure;
- selections;
- tabulate;
- result table;
- map/chart.

New user sees a guided analysis builder.

## 9.2 Proposed desktop layout

```text
┌────────────────────────────────────────────────────────────────────┐
│ Project / Analysis      Data status              Run      Export    │
├─────────────────┬──────────────────────────────────────────────────┤
│ DATA            │ Analysis / Results                                  │
│ dataset/files   │                                                     │
│ definitions     │  Table | Chart | Map | Audit                        │
│                 │                                                     │
│ BUILD           │  ┌──────────────────────────────────────────────┐   │
│ Rows            │  │                                              │   │
│ Columns         │  │              result surface                  │   │
│ Measure         │  │                                              │   │
│ Filters         │  └──────────────────────────────────────────────┘   │
│                 │                                                     │
│ ADVANCED        │  warnings / provenance / job progress               │
│ totals          │                                                     │
│ suppressions    │                                                     │
└─────────────────┴──────────────────────────────────────────────────┘
```

## 9.3 Essential UX decisions

- file opening should accept drag/drop and file picker;
- opening a DEF should surface compatible data patterns and associated CNVs;
- selected filters appear as removable chips;
- search works in every long category selector;
- result table must handle hundreds of thousands of visible/virtual rows without freezing;
- map and graph are alternate views of the same result model;
- “Audit” is a peer tab, not a hidden developer screen;
- errors must include actionable causes and downloadable technical details.

## 9.4 Accessibility target

Initial engineering target: **WCAG 2.1 AA-oriented implementation**, while also checking applicable eMAG / Brazilian public-sector guidance.

Required practices include:

- full keyboard operation;
- logical focus order;
- visible focus;
- semantic HTML;
- accessible names for all controls;
- no color-only encoding;
- contrast requirements;
- screen-reader compatible table summaries;
- chart/map results always available as text/table alternatives;
- reduced motion support;
- large hit areas;
- accessible error/status announcements.

Automated accessibility tests are necessary but not sufficient; human/manual testing must be part of release criteria.

---

# 10. Security, privacy and institutional deployment

## 10.1 Default privacy claim we want to be able to make

> “Files opened for local analysis are processed on the user’s device and are not transmitted to an application server by default.”

Only state this publicly once network behavior is verified in tests.

## 10.2 Threat model items

- accidental upload of local data;
- persistent cache on shared computers;
- malicious/corrupted DBF/DBC/DEF/CNV inputs;
- decompression bombs / memory exhaustion;
- crafted strings affecting HTML rendering;
- CSV formula injection on export;
- dependency/supply-chain compromise;
- unsafe third-party map tiles/analytics;
- service-worker stale builds;
- GitHub Pages/demo configuration accidentally enabling external telemetry.

## 10.3 Security baseline

Planned:

- CSP;
- strict escaping/no unsafe HTML from dataset text;
- file size / memory guardrails;
- worker isolation;
- dependency lockfile;
- dependency review;
- SBOM on release;
- vulnerability scanning;
- release checksums;
- `SECURITY.md`;
- no secrets in frontend;
- no telemetry in institutional build by default.

## 10.4 Static deployment advantage

A local-first static application can greatly simplify institutional deployment:

- no patient/public-health dataset must traverse our server for ordinary tabulation;
- can be hosted on internal infrastructure;
- can be packaged for offline use;
- update process can be versioned and audited.

---

# 11. Licensing / clean reimplementation rules

## 11.1 Current unknown

The supplied TabWin 4.15 distribution does not by itself establish a license allowing us to redistribute its binaries, maps, help files, images or code-derived assets.

Therefore, until confirmed:

- do not commit original executables to a public repository;
- do not redistribute original `.MAP` bases;
- do not copy proprietary UI assets;
- do not claim ownership of TabWin formats or branding;
- use original software/documentation as behavioral reference;
- document compatibility behavior in our own words;
- prefer independently licensed/open geodata for built-in maps.

## 11.2 Candidate third-party licensing

- `@precisa-saude/datasus-dbc`: Apache-2.0 (per current repository);
- DuckDB-Wasm: MIT;
- React: MIT;
- MapLibre GL JS: BSD-3-Clause.

A dependency license inventory must be generated automatically before a public release.

## 11.3 Project license

**Not yet decided.**

Candidates should be discussed with the professor/institution before first public release. Apache-2.0 is attractive for explicit patent language and institutional reuse; MIT is simpler. No final decision in R00.

---

# 12. GitHub strategy

GitHub should be the project’s engineering control plane, not just a backup folder.

## 12.1 Proposed repository structure

```text
.
├── apps/
│   └── web/
├── packages/
│   ├── core/
│   ├── formats/
│   ├── geo/              # later
│   └── audit/            # later
├── docs/
│   ├── architecture/
│   ├── legacy/
│   ├── research/
│   └── compatibility/
├── fixtures/             # only redistributable/synthetic fixtures
├── .github/
│   └── workflows/
└── CHECKPOINT_MASTER.md
```

## 12.2 Branching/review

Recommended:

- protected `main`;
- short-lived feature branches;
- PR required once more than one maintainer exists;
- conventional commit messages;
- ADR for architectural changes;
- compatibility changes require golden test update or explicit explanation.

## 12.3 CI pipeline

On PR:

1. format/lint;
2. typecheck;
3. unit tests;
4. parser fixture tests;
5. golden compatibility tests;
6. accessibility smoke tests;
7. production build;
8. dependency/license/security checks.

On tagged release:

1. repeat full CI;
2. build static web artifact;
3. generate SBOM;
4. generate SHA-256 checksums;
5. publish release artifact;
6. optionally deploy demo to GitHub Pages;
7. preserve provenance linking artifact → git commit.

## 12.4 GitHub Pages role

Good for:

- public demo;
- documentation;
- static preview.

Not necessarily the final institutional deployment. The exact same build should be deployable on another static host/intranet.

## 12.5 Issue taxonomy

Suggested labels:

- `compat`
- `ux`
- `innovation`
- `format:dbc`
- `format:def`
- `format:cnv`
- `format:tab`
- `geo`
- `performance`
- `accessibility`
- `security`
- `research`
- `golden-test`
- `blocked:spec`
- `good-first-issue`

## 12.6 GitHub integration inside the app

Do **not** make GitHub authentication part of the MVP.

Possible later opt-in features:

- open a public recipe from a GitHub URL;
- publish a recipe/example to a repository;
- link a result to an issue/repro fixture.

Institutional users should not need GitHub accounts to use the core product.

---

# 13. Roadmap

The roadmap is intentionally gated. We do not move to the next stage because the UI “looks done”; we move when the defined evidence exists.

## R00 — baseline and archaeology **[CURRENT]**

### Goals

- inspect supplied TabWin package;
- establish product thesis;
- identify non-obvious legacy capabilities;
- define architecture principles;
- establish external-memory/checkpoint system;
- identify current ecosystem/competitors;
- create repo skeleton.

### Exit criteria

- [x] archive inventory recorded;
- [x] hashes of key legacy files recorded;
- [x] compatibility/UX/innovation separation defined;
- [x] high-level architecture defined;
- [x] CNV semantics partially reverse-specified from supplied documentation;
- [x] major legal/licensing unknown documented;
- [x] current browser DBC candidate identified;
- [x] competitor existence documented;
- [x] public-sector accessibility requirement documented;
- [x] initial repository skeleton created;
- [ ] confirm professor/institution’s desired public license;
- [ ] confirm permission/branding expectations around “TabWin” name;
- [ ] acquire canonical DEF + CNV + DBC/DBF sample set for first golden test.

## R01 — format spike + first real file **[NEXT]**

### Goals

- build a minimal web app that accepts `.dbc` and `.dbf`;
- decode a real DBC locally;
- show schema, record count and first rows;
- compute SHA-256 provenance;
- benchmark memory/time;
- no tabulation UI complexity yet.

### Exit criteria

- [ ] real SIH/SIM/SINAN/CNES DBC loads in supported browser;
- [ ] no data network upload occurs during local ingestion;
- [ ] schema is shown correctly;
- [ ] cancellation/error behavior tested;
- [ ] benchmark logged in checkpoint;
- [ ] malformed-file test exists.

## R02 — CNV parser specification

### Goals

Implement and test normalized CNV representation.

### Required tests

- [ ] comments;
- [ ] continuation rows;
- [ ] exact codes;
- [ ] ranges;
- [ ] overlaps/precedence;
- [ ] literal mode;
- [ ] long values;
- [ ] numeric faixa mode;
- [ ] subtotals;
- [ ] new `N` format once spec is complete;
- [ ] encoding.

### Exit criterion

Synthetic CNV fixtures pass and at least one real DATASUS CNV is parsed into expected categories.

## R03 — DEF archaeology/specification

### Goals

- collect canonical DEF files;
- document all record types/commands actually needed by current DATASUS datasets;
- implement parser for P0 commands;
- map DEF variables to DBF schema and CNVs.

### Exit criterion

Opening a DEF produces the same conceptual selectable rows/columns/selections/increments for a canonical test case.

## R04 — first compatibility tabulation

### Goals

- `AnalysisSpec` → `QueryPlan` compiler;
- DuckDB executor;
- line × column frequency table;
- filters;
- canonical totals;
- golden comparison to TabWin 4.15.

### Exit criterion — FIRST MAJOR DEMO

**At least one real DATASUS tabulation matches TabWin 4.15 exactly in raw cell values.**

## R05 — usable MVP

- modern analysis builder;
- search selectors;
- saved local recipe;
- CSV/XLSX export;
- provenance/audit panel;
- robust error handling;
- accessibility baseline;
- multiple golden datasets.

## R06 — `.TAB` / repeat-analysis bridge

- investigate actual `.TAB` structure;
- recover/replay legacy selections where possible;
- “repeat with updated data” workflow;
- diff between runs.

## R07 — maps

- official modern geography source;
- choropleth;
- UF/municipality/health-region support;
- accessible table alternative;
- export;
- legacy `.MAP` importer/converter feasibility.

## R08 — flows and advanced spatial analysis

- origin/destination matrix;
- flow arrows;
- configurable thresholds;
- catchment/referral analysis primitives.

## R09 — institutional hardening

- PWA/offline profile;
- self-host guide;
- SBOM;
- security review;
- manual accessibility evaluation;
- deterministic releases;
- documentation/user guide;
- migration guide for TabWin users.

## R10 — optional advanced ecosystem

Candidate work, only after core replacement value is proven:

- data download/catalog;
- official-source/mirror provenance;
- SQL workspace;
- R/Python exports;
- plugin/extension API;
- dashboards;
- collaborative recipe repositories.

---

# 14. MVP definition — deliberately narrow

The word MVP can become dangerous because “minimum” is subjective. Our MVP is defined by a concrete institutional demonstration.

## MVP must do

1. Open a local real DATASUS `.DBC`.
2. Decode/process locally.
3. Load the relevant DEF/CNV definitions for a canonical case.
4. Let a user choose line, column, measure and filters in a modern UI.
5. Produce a table.
6. Export the result.
7. Show an audit/provenance summary.
8. Save the analysis recipe.
9. Reopen and rerun it.
10. Match TabWin 4.15 on a documented test corpus.

## MVP explicitly does not require

- user accounts;
- cloud backend;
- collaboration;
- every legacy map import format;
- BDE/ODBC parity;
- R execution in browser;
- every DATASUS system catalogued;
- dashboard builder;
- mobile-first full analysis experience;
- AI features.

---

# 15. Performance targets — provisional, must be measured

These are targets, not promises.

## UX budget

- app shell interactive quickly after static load;
- opening small/medium files provides immediate progress feedback;
- UI never blocks during decode/query;
- category search responds interactively;
- large result tables use virtualization.

## Engineering benchmarks to record

For each fixture:

- compressed DBC size;
- decompressed DBF size;
- record count;
- decode time;
- peak/approx memory;
- load-to-query time;
- group-by time;
- browser/device;
- engine/package versions.

We should benchmark on ordinary public-sector office hardware, not only a development machine.

---

# 16. Failure modes we want to avoid

1. **Pretty clone trap:** UI finished before compatibility semantics exist.
2. **DuckDB-as-spec trap:** SQL quirks become accidental product behavior.
3. **Dashboard trap:** curated dashboards overshadow generic tabulation.
4. **Server trap:** local public data gets uploaded because implementation was easier.
5. **FTP trap:** data retrieval blocks the entire project.
6. **Legacy-everything trap:** spend months on obsolete formats no one uses.
7. **Legacy-nothing trap:** ignore DEF/CNV/TAB and lose the migration value.
8. **Map-only accessibility trap:** important information becomes inaccessible to nonvisual users.
9. **Branding trap:** independent prototype looks officially endorsed.
10. **License trap:** redistribute old binaries/maps without clear permission.
11. **Reproducibility trap:** saved “project” references mutable URLs but not hashes.
12. **Memory trap:** browser crashes on large DBC because we materialize every record as JS objects.
13. **Silent mismatch trap:** modern “helpful” missing-value behavior changes TabWin results.
14. **One-dataset trap:** architecture accidentally optimized around SIH only.

---

# 17. Decisions made in R00

## D-R00-001 — Reimplementation, not executable conversion

**Decision:** Build an independent web application; do not attempt to wrap/convert `TabWin415.exe`.

**Reason:** no source was supplied; browser architecture and institutional deployment require a different runtime model.

## D-R00-002 — Local-first analysis

**Decision:** ordinary local-file tabulation must not require an application server.

## D-R00-003 — Compatibility core independent of UI/executor

**Decision:** encode TabWin semantics in a normalized domain/query model before DuckDB execution.

## D-R00-004 — DEF/CNV are first-class compatibility objects

**Decision:** do not flatten them into undocumented UI configuration.

## D-R00-005 — Reproducibility is P0/P1

**Decision:** recipes, hashes and run provenance begin with the MVP architecture.

## D-R00-006 — GitHub is engineering infrastructure, not user authentication

**Decision:** use GitHub for source/CI/releases/docs; app login is not MVP.

## D-R00-007 — Built-in geography should use modern licensed sources

**Decision:** legacy `.MAP` redistribution waits for license clarification; importer/converter can be implemented separately.

## D-R00-008 — Institutional accessibility from the beginning

**Decision:** UI architecture must be keyboard/screen-reader compatible; accessibility is a release gate, not cosmetic remediation.

## D-R00-009 — Competitor changes positioning

**Decision:** “TabWin in browser” alone is insufficient differentiation. Lead with compatibility, migration, auditability, local-first behavior and open governance.

---

# 18. Open decisions / questions

These are intentionally unresolved and must not be guessed later.

## Product/governance

- [ ] Who is the formal project owner/maintainer?
- [ ] Is the desired end state an official institutional project, academic open-source project, or both?
- [ ] Which public license is acceptable?
- [ ] Can/should the name “TabWin” be used publicly?
- [ ] May original map/data definition assets be redistributed?
- [ ] Is a Portuguese-only MVP acceptable, with i18n architecture retained?

## Compatibility

- [ ] Exact DEF grammar/specification.
- [ ] Exact `.TAB` format including saved panel state.
- [ ] New CNV `N` format complete field positions.
- [ ] DBC CRC behavior needed for compatibility/integrity reporting.
- [ ] Numeric rounding/formatting rules in edge cases.
- [ ] Missing/blank/invalid value semantics.
- [ ] How measures/increments map across historical DEF variants.
- [ ] Which map association rules must be preserved.

## Technical

- [ ] React or another frontend framework — React is current candidate, not irreversible decision.
- [ ] exact table component / virtualization strategy;
- [ ] DuckDB-Wasm memory model on large national datasets;
- [ ] Arrow pathway vs JS object ingestion;
- [ ] web-worker topology;
- [ ] PWA persistent storage strategy;
- [ ] geospatial renderer/data format;
- [ ] direct official data retrieval feasibility/CORS.

---

# 19. Immediate next work queue

Order matters.

## NEXT-01 — Assemble canonical public test assets

A small real DBC candidate has now been identified: `RDAC2401.dbc` (SIH-RD, Acre, 2024/01; ~306 KB; 4,315 records according to the upstream decoder test). Remaining pieces:

- [x] small real DBC candidate identified;
- [ ] materialize/clone fixture into the development environment;
- [ ] corresponding `RD2008.DEF`;
- [ ] corresponding CNV(s);
- [ ] known TabWin 4.15 output for a simple canonical tabulation.

The first golden case should remain deliberately simple before testing complex CNV hierarchies.

## NEXT-02 — Build DBC browser ingestion spike

Implement:

- file drop;
- extension/type detection;
- SHA-256;
- DBC decode;
- schema preview;
- first rows;
- record counter;
- cancellation;
- no-upload network verification.

## NEXT-03 — Formalize CNV parser

We already have enough supplied documentation to begin unit tests before DEF is fully understood.

## NEXT-04 — Acquire/reverse-spec DEF

Search official/current definition files and preserve a format corpus.

## NEXT-05 — Create first TabWin golden result manually

Use the original Windows application on the exact fixture and save:

- screenshot;
- output `.TAB`;
- log;
- export;
- exact panel selections.

## NEXT-06 — Compile first query plan and compare

This is the first true proof of replacement viability.

---

# 20. What would make this project genuinely exceptional

Not AI. Not a flashy dashboard. The strongest version is a tool where an epidemiologist can send another analyst a tiny recipe and say:

> “Open this. These are the exact DATASUS files and hashes I used, these are the legacy definitions, this is the transformation, and this is the result. You can reproduce it locally, update the period, or inspect every rule.”

That combines the best historical idea already present in TabWin — recoverable/repeatable tabulation state — with modern software reproducibility.

A ministry-facing demo becomes much more credible if it shows the following sequence:

1. open official DBC locally;
2. use familiar TabWin concepts in a modern UI;
3. obtain the same result as TabWin 4.15;
4. click **Audit** and see exactly how it was produced;
5. save a small recipe;
6. reopen it with a new month and reproduce/update the analysis;
7. run the same static application offline or on an intranet.

That is a much stronger story than “we redesigned the interface.”

---

# 21. Sources / references captured in R00

## Supplied legacy package

- `HISTORIA.TXT`
- `defcnv.htm`
- `DocTabWin.htm`
- `autoexec.r`
- `menu.r`
- `TabWin.ini`
- `MAPAS/*.MAP`

These files are preserved only in the private working inspection directory; they are **not** included in this generated repository artifact.

## External references checked 2026-08-26

- Precisa Saúde — `datasus-dbc`: <https://github.com/Precisa-Saude/datasus-dbc>
- DuckDB-Wasm: <https://github.com/duckdb/duckdb-wasm>
- MapLibre GL JS: <https://github.com/maplibre/maplibre-gl-js>
- React: <https://github.com/facebook/react>
- Federal Design System / accessibility: <https://www.gov.br/ds/acessibilidade>
- eMAG: <https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/acessibilidade-digital/modelo-de-acessibilidade>
- Non-official TabWin web landscape example: <https://tabwin.blancsystem.com.br/>

---

# 22. Revision log

## R00 — 2026-08-26

Created first externalized project memory. Added:

- project thesis;
- archive evidence and hashes;
- legacy feature archaeology;
- recovered CNV semantics;
- competitor/landscape finding;
- compatibility/UX/innovation classification;
- architecture;
- reproducibility model;
- equivalence strategy;
- UI principles;
- security/privacy/accessibility/licensing requirements;
- GitHub strategy;
- phased roadmap;
- open questions;
- immediate next work queue.

**Next revision trigger:** first executed DBC ingestion spike, or acquisition of canonical `RD2008.DEF`/CNVs/golden output.

## R00.1 — 2026-08-26

Post-baseline continuation:

- identified `RDAC2401.dbc` as a small real SIH-RD ingestion fixture in the upstream `datasus-dbc` repository;
- recorded upstream reference metadata (4,315 records, 702-byte record size);
- recorded that the current container could not materialize the raw binary, so R01 execution remains pending;
- changed NEXT-01 from “find a DBC” to “assemble the remaining DEF/CNV/golden-output bundle.”


---

# 23. R01.0-dev — semantic kernel implementation

## 23.1 What changed

R01 has begun as executable engineering rather than further concept work.

Implemented in the repository:

- root TypeScript build configuration with no runtime dependencies for the semantic kernel;
- legacy fixed-column CNV parser;
- CNV normalized representation that preserves source rule order;
- short-code exact/range matching;
- explicit literal/long-code precedence behavior;
- continuous numeric-range (`F` / `FAIXAS`) matching;
- row subtotal metadata and propagation;
- legacy `#` non-total/comment-row marker capture;
- explicit detection of the post-2011 `N` CNV format;
- QueryPlan validation/compilation;
- deterministic in-memory tabulation executor;
- frequency/count measure;
- numeric sum measure;
- row and column dimensions;
- raw-value and CNV-backed filters;
- zero-row suppression after conversion-category materialization;
- deterministic portable analysis-recipe JSON;
- run/provenance manifest model;
- GitHub Actions CI workflow;
- automated tests.

Current test state at this revision:

> **12 tests passing, 0 failing.**

This is still a semantic-development harness. It is not yet evidence of end-to-end TabWin equivalence because no canonical TabWin 4.15 golden output has been captured for the same real input bundle.

## 23.2 Files added in R01.0-dev

Core:

- `packages/core/src/model.ts`
- `packages/core/src/plan.ts`
- `packages/core/src/execute.ts`
- `packages/core/src/recipe.ts`
- `packages/core/src/index.ts`

Formats:

- `packages/formats/src/cnv-model.ts`
- `packages/formats/src/cnv-parser.ts`
- `packages/formats/src/cnv-match.ts`
- `packages/formats/src/index.ts`

Tests:

- `tests/cnv.test.mjs`
- `tests/core.test.mjs`

Engineering/product docs:

- `docs/architecture/ADR-0003-cnv-compatibility.md`
- `docs/testing/GOLDEN_TEST_STRATEGY.md`
- `docs/product/PRODUCT_ROADMAP.md`
- `docs/security/LOCAL_FIRST_THREAT_MODEL.md`
- `docs/government/FEDERAL_UI_PROFILE.md`
- `.github/workflows/ci.yml`

## 23.3 CNV behavior now encoded

### Legacy fixed columns

For the classic layout, the parser follows the supplied documentation:

- subtotal indicator: columns 1–3;
- category sequence: columns 4–7;
- description: columns 10–59;
- code list: column 61 onward.

### Source order

Source order is retained as data. This is not an implementation accident.

The supplied documentation explicitly demonstrates a broad `00-99` month rule appearing before specific months, with later specific rows taking precedence. Therefore short mode is represented as:

`last-match-wins`

The documentation separately describes first-index behavior for long/literal codes. R01 encodes literal mode as:

`first-match-wins`

**Important:** literal precedence remains a golden-test target. If direct TabWin 4.15 evidence contradicts our interpretation, the compatibility profile changes and the test corpus records the versioned behavior.

### Numeric ranges

`F` / `FAIXAS` mode interprets the code field as an inclusive upper bound. Values are assigned to the first bound that contains them in source order.

### Subtotals

Subtotal pointers are applied only to rows, matching the documentation. Detail rows are accumulated bottom-up so future multi-level hierarchies do not lose descendant values.

### `#` marker

The historical `#` subtotal-field marker is preserved as `excludeFromTotal` metadata. Grand-total rendering is not yet implemented, so this metadata is captured now to avoid throwing semantic information away.

## 23.4 Explicit non-guess: new `N` CNV format

TabWin 3.7a (2011) added a new CNV format with four subtotal positions and 100 description positions and requires `N` in the first position of the first line.

The supplied history proves the format exists but does not provide enough exact field offsets to implement it safely.

**Decision:**

- detect `N` correctly;
- fail with an actionable parser error;
- do not infer offsets from intuition;
- acquire a canonical real `N` CNV or authoritative specification before support is marked implemented.

This is an example of a project-wide rule:

> **An explicitly recorded unsupported legacy behavior is safer than silent approximate compatibility.**

## 23.5 QueryPlan / executor boundary now exists

The first executable compatibility path is:

```text
TabulationSpec
      ↓
compileQueryPlan()
      ↓
QueryPlan v1
      ↓
executeInMemory(records, plan, conversions)
      ↓
TabulationResult
```

DuckDB is intentionally absent from this semantic proof path.

That gives us a reference executor against which a future DuckDB-Wasm implementation can be tested. Optimization must reproduce this behavior rather than redefine it.

## 23.6 Recipe/provenance direction is now code, not only roadmap

R01 introduces two first-class structures:

### `AnalysisRecipeV1`

Contains:

- schema/version;
- optional analysis name;
- normalized TabulationSpec;
- conversion fingerprints;
- source name/hash/size hints.

The serializer recursively sorts object keys while preserving array order. Array order is preserved because rule/filter order may be semantically relevant.

### `RunManifestV1`

Designed to record:

- app version;
- execution timestamp;
- exact QueryPlan;
- source fingerprints;
- conversion fingerprints;
- records seen/accepted;
- result dimensions;
- warnings.

This is the seed of **Audit Mode**.

## 23.7 Real DBC fixture status

The candidate remains:

- `RDAC2401.dbc`;
- SIH-RD;
- Acre;
- competence 2024-01;
- approximately 306 KB in the upstream GitHub repository;
- upstream decoder test expects 4,315 records and DBF record size 702 bytes.

The current environment successfully verified the GitHub fixture page and upstream end-to-end test, but binary materialization through the available transport path failed. This is an infrastructure/download limitation in this run, not evidence that the fixture itself is invalid.

Therefore:

- [x] fixture independently confirmed;
- [x] upstream expected metadata confirmed;
- [ ] fixture binary present in this repository;
- [ ] DBC decoder dependency pinned here;
- [ ] local R02 ingestion test executed.

## 23.8 External evidence newly captured

Checked 2026-08-26:

- `@precisa-saude/datasus-dbc` documents a pure TypeScript browser/Node decoder, zero native runtime dependencies, Apache-2.0, high-level record iterator, DBC→DBF and DBF parser APIs.
- The upstream end-to-end test explicitly uses `RDAC2401.dbc`, says it is a real Acre 2024/01 DATASUS file from official FTP, and checks `recordCount=4315` and `recordSize=702`.
- Current Padrão Digital de Governo material exposes Design System version 3.7.0 and Web Components intended for multiple frontend frameworks.
- Official government material frames the Design System as a standard for consistent federal digital interfaces; current site materials state CC0/MIT licensing.
- eMAG/accessibility guidance remains available through Governo Digital, with WCAG treated as an important international baseline.

References:

- https://github.com/Precisa-Saude/datasus-dbc
- https://github.com/Precisa-Saude/datasus-dbc/blob/main/packages/dbc/test/e2e.test.ts
- https://github.com/Precisa-Saude/datasus-dbc/tree/main/packages/dbc/test/fixtures
- https://www.gov.br/ds
- https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/acessibilidade-digital/modelo-de-acessibilidade

## 23.9 Federal UI implication

We should not make the semantic engine depend on GOV.BR components. However, if the project receives formal federal adoption or ministry deployment, there is a credible path to an `institutional-govbr` presentation profile.

This lets us support two truths simultaneously:

1. the open-source project remains independently usable and non-official;
2. an institutional deployment can align visually and accessibly with government standards without forking the engine.

No use of government visual identity should imply official endorsement before it exists.

---

# 24. Updated priority queue after R01 semantic work

## P0-A — Acquire the complete first golden bundle

Required artifacts:

- [ ] `RDAC2401.dbc` locally;
- [ ] canonical `RD2008.DEF` compatible with the period;
- [ ] every CNV referenced by the chosen dimension/filter;
- [ ] exact TabWin 4.15 control-panel selections;
- [ ] TabWin 4.15 screenshot of result;
- [ ] exported table;
- [ ] `.TAB` and log where legally/shareably possible;
- [ ] hashes for every artifact.

**Definition of done:** a stranger can reconstruct what was run without asking what somebody clicked.

## P0-B — DBC ingestion adapter

Implement after fixture materialization:

- [ ] pin exact decoder version;
- [ ] local SHA-256;
- [ ] DBC metadata inspect;
- [ ] stream records;
- [ ] cancellation signal;
- [ ] worker boundary;
- [ ] schema preview;
- [ ] benchmark peak memory on small, medium and large datasets;
- [ ] prove zero upload/network dependency during local execution.

## P0-C — DEF reverse specification

Need a corpus rather than one file.

- [ ] SIH `RD2008.DEF`;
- [ ] at least one SIA DEF;
- [ ] one SIM/SINASC/SINAN-style DEF if publicly available;
- [ ] annotate every record type/field;
- [ ] parser with lossless/raw representation first;
- [ ] normalized semantic representation second;
- [ ] dependency resolution for CNVs.

## P0-D — First golden comparison harness

Create `fixtures/golden/G001-*` and a command that produces:

- normalized actual JSON;
- expected JSON;
- structural diff;
- cell diff;
- provenance diff;
- machine exit code for CI.

## P1-A — Browser workbench shell

Only after core contracts stabilize enough:

- [ ] React candidate spike;
- [ ] accessible file drop + ordinary file picker;
- [ ] data-source card with privacy statement;
- [ ] row/column/measure controls;
- [ ] conversion-backed category selector;
- [ ] virtualized result grid;
- [ ] Audit drawer;
- [ ] save/open recipe.

## P1-B — `.TAB` archaeology

`.TAB` replay is strategically important because it is the migration bridge for existing users.

- [ ] collect several saved TabWin tables;
- [ ] separate display matrix from embedded execution state;
- [ ] determine encoding/version markers;
- [ ] build parser that can recover panel state;
- [ ] map recoverable state into `AnalysisRecipeV1`;
- [ ] preserve unrecognized metadata losslessly where possible.

## P1-C — Geography baseline

- [ ] choose licensed canonical Brazilian geometries;
- [ ] municipality code versioning strategy;
- [ ] health-region versioning strategy;
- [ ] MapLibre vs alternative benchmark;
- [ ] choropleth accessibility behavior;
- [ ] tabular fallback for all map information;
- [ ] origin–destination data model.

---

# 25. Product ideas promoted after additional reasoning

These ideas are now considered serious design candidates rather than brainstorming noise.

## 25.1 Compatibility badge with evidence scope

Do not display a generic “TabWin compatible” badge.

Instead expose a compatibility matrix, for example:

```text
TabWin 4.15 compatibility
✓ Frequency tabulation
✓ Legacy short CNV
✓ Legacy literal CNV
✓ Numeric CNV ranges
△ Row subtotals — synthetic tests only
△ DEF import/semantics — parser + synthetic tests, no real corpus golden yet
✗ New N-format CNV
✗ Related-DBF lookup execution
✗ TAB replay
```

Eventually each check should link to its golden test corpus.

This makes compatibility auditable and prevents marketing language from outrunning evidence.

## 25.2 Semantic diff for recipes

Two recipes should be compared at the level users understand:

```text
Changed data period: 2025-01 → 2025-02
Added filter: sexo = feminino
CNV unchanged: SHA256 ...
Measure unchanged: frequency
```

This is substantially more useful in epidemiology than a raw JSON diff.

## 25.3 “Update this analysis” workflow

Inspired directly by TabWin's saved-panel recovery:

1. open old recipe;
2. application verifies old hashes;
3. user chooses newer competence(s);
4. all analytical logic remains pinned;
5. result runs;
6. application shows run-to-run diff.

This could become one of the project's signature workflows.

## 25.4 Definition health / linter

Before running a DEF/CNV bundle, show warnings such as:

- overlapping codes;
- category count mismatch;
- missing subtotal targets;
- non-monotonic numeric ranges;
- referenced CNV missing;
- suspicious field offsets;
- code widths incompatible with source schema.

Compatibility mode should distinguish **legacy-valid weirdness** from actual corruption.

## 25.5 Provenance sidecar for exports

When exporting a table/chart/map, optionally export:

`analysis.csv`

plus

`analysis.provenance.json`

The sidecar contains source/definition hashes and the recipe. A figure in a paper or ministry report can therefore be traced back to an exact computation.

## 25.6 No-telemetry institutional build

Provide a build/profile with:

- no analytics SDK;
- no external CDN;
- all production assets self-hosted;
- offline-capable service worker;
- documented network allowlist = empty for local analysis.

This turns local-first from a promise into something an IT team can inspect.

## 25.7 Dataset schema registry with versioned drift

DATASUS schemas evolve. We should eventually maintain a registry that records:

- system;
- file prefix;
- competence ranges;
- fields and types;
- known renames;
- known encoding peculiarities;
- associated official definitions.

The application can then say **why** a saved recipe no longer maps cleanly to a new period instead of simply failing.

## 25.8 Expert mode: show generated SQL without making SQL the specification

A future DuckDB executor can expose generated SQL for transparency and advanced users, while the semantic QueryPlan remains the normative representation.

This is useful for teaching, debugging and migration to R/Python/SQL workflows.

## 25.9 Reproduction capsule

A small zip could contain:

- recipe;
- hashes/manifests;
- legal-to-redistribute DEF/CNVs;
- optional small data fixture;
- expected result;
- app version/build metadata.

For large/public DBCs, the capsule contains retrieval identifiers rather than duplicating data.

## 25.10 “Explain this field” without AI dependency

Definitions, labels, source-system descriptions and CNV mappings should supply deterministic help first. AI explanation, if ever added, must remain an optional layer and cannot define computation semantics.

---

# 26. Newly recorded engineering risks

15. **Precedence risk:** optimizing CNV lookup may accidentally reverse source-order semantics.
16. **New-format risk:** treating `N` CNV as legacy offsets yields silently corrupt categories.
17. **Subtotal risk:** naive parent-first propagation loses nested descendants or double-counts.
18. **Recipe privacy risk:** future convenience features might accidentally serialize raw values/samples.
19. **Government-branding risk:** GOV.BR styling can falsely imply official endorsement.
20. **CDN risk:** production dependency on external CDN defeats offline/intranet guarantees.
21. **Framework lock risk:** UI design system choice leaks into compatibility engine contracts.
22. **Golden-corpus licensing risk:** canonical DEF/CNV/TAB assets may have redistribution constraints.
23. **Comparator risk:** numeric equality can pass while row order/labels differ; compatibility tests need structural comparison too.
24. **Schema-drift risk:** a recipe can remain syntactically valid while referring to a field whose meaning changed historically.
25. **Large-file risk:** reference in-memory executor is correctness infrastructure, not a production strategy for national datasets.

---

# 27. Decisions added in R01.0-dev

## D-R01-001 — Preserve CNV source rule order

**Decision:** rule order is part of the compatibility model and must survive parsing/serialization.

## D-R01-002 — Reference executor before optimization

**Decision:** maintain a simple deterministic executor as semantic oracle even after DuckDB-Wasm is introduced.

## D-R01-003 — Unsupported is preferable to guessed compatibility

**Decision:** the `N` CNV format is detected and rejected until exact offsets are evidenced.

## D-R01-004 — Recipe is a stable public domain object

**Decision:** saved analyses use a versioned, deterministic JSON schema rather than UI component state.

## D-R01-005 — Government UI is a profile, not the engine identity

**Decision:** preserve ability to align with Padrão Digital de Governo without coupling computation or falsely implying official status.

## D-R01-006 — CI starts before frontend framework selection

**Decision:** core semantic tests are repository gates now; React/other framework selection does not block correctness work.

---

# 28. Revision log continuation

## R01.0-dev — 2026-08-26

First executable semantic implementation.

Added:

- build/test harness;
- CNV parser and matcher;
- explicit precedence semantics;
- numeric ranges;
- subtotal propagation;
- QueryPlan validation;
- deterministic reference executor;
- filters, count and sum measures;
- recipes and run-manifest domain models;
- deterministic JSON serialization;
- 12 passing automated tests;
- CI workflow;
- golden-test strategy;
- product roadmap;
- local-first threat model;
- federal UI profile research;
- new product candidates including semantic recipe diff, provenance sidecars and evidence-scoped compatibility badges.

**Next revision trigger:** successful real DBC ingestion or acquisition of the complete `RD2008.DEF` + CNV + TabWin golden bundle.


---

# 29. R01.1-dev — DEF becomes executable metadata

**Date:** 2026-08-26  
**State change:** the project now parses the documented core `.DEF` language and carries DEF semantics into the reference execution model. The first real golden test remains blocked only on asset/reference capture and DBC adapter integration, not on a conceptual DEF gap.

## 29.1 Why this revision matters

R01.0 could parse CNV and execute a hand-authored QueryPlan, but a crucial compatibility layer was missing: **how TabWin decides which field, which substring, which conversion and which increment correspond to the options shown in the panel.**

The historical manual establishes that `.DEF` specifies those relationships. In particular, for S/L/C-style options it associates:

- the panel label;
- the source DBF field;
- the **initial character position** within that field;
- the CNV or related DBF used to decode the value.

This means a web reimplementation that ignores DEF's start position can produce plausible but wrong tables. R01.1 closes that gap in the reference engine.

Primary evidence used:

1. TabWin manual, pages 86–89, mirror at Secretaria de Estado da Saúde do Paraná: `https://www.saude.pr.gov.br/sites/default/arquivos_restritos/files/documento/2022-04/manualtabwin.pdf`.
2. `defcnv.htm` included in the supplied TabWin 4.15 package.
3. DATASUS TabWin 3.x documentation for the later `A<pattern>,<query.sql>` extension: `https://siab.datasus.gov.br/DATASUS/tabwin/doctabwin.htm`.

## 29.2 Implemented DEF model

New files:

```text
packages/formats/src/def-model.ts
packages/formats/src/def-parser.ts
packages/core/src/def-bridge.ts
docs/legacy/DEF_SPEC_R01.md
docs/architecture/ADR-0004-def-is-executable-metadata.md
```

Recognized directives:

| Directive | Normalized meaning | Parse | Execution status |
|---|---|---:|---:|
| `A` | input file pattern | yes | source matcher later |
| `A...,query.sql` | source + SQL refresh query | yes | no SQL execution |
| `S` | selection | yes | CNV-backed bridge yes |
| `L` | row/line | yes | CNV-backed bridge yes |
| `C` | column | yes | CNV-backed bridge yes |
| `Q` | legacy quadro/TABDOS | yes | retained only |
| `D` | row + quadro | yes | row role available |
| `T` | row + column + quadro | yes | row/column roles available |
| `I` | increment field | yes | sum measure bridge yes |
| `G` | grouped-record frequency field | yes | weighted frequency yes |
| `R` | TABDOS report file | yes | retained only |

The parser preserves source line and directive information to keep the model auditable.

## 29.3 Critical correctness fix: DEF start position

`DimensionSpec` and `FilterSpec` now have:

```ts
startPosition?: number
```

with TabWin-compatible 1-based semantics.

Execution now performs:

```text
DBF field value
  -> apply DEF start position
  -> take CNV codeLength characters
  -> classify through CNV
```

Example class of behavior now covered by tests:

```text
DATAOBITO = "240201"
DEF start = 3
CNV width = 2
value seen by CNV = "02"
```

This applies both to row/column dimensions and selection filters.

### Decision D-R01-007 — DEF slicing occurs before CNV classification

**Decision:** the normalized query model explicitly carries the DEF start position. The executor must not assume CNV comparison always begins at character 1.

**Reason:** this is observable legacy behavior and can change analytical results.

## 29.4 G directive implemented as weighted frequency

Historical DEF semantics include a `G<field>` directive for aggregated source files where one physical record represents multiple occurrences.

R01.1 adds:

```ts
MeasureSpec.weightField?: string
```

Frequency now means:

```text
ordinary dataset: +1 per accepted record
G dataset:        +numeric record[G field]
```

### Decision D-R01-008 — grouped frequency is a measure semantic, not preprocessing

**Decision:** preserve `G` as an explicit weight on the frequency measure rather than expanding a grouped record into N synthetic records.

**Reason:** exact result with drastically lower memory cost; provenance can state why frequency was weighted.

## 29.5 Related DBF lookup recognized but deliberately not executed

Historical DEF can reference another `.DBF` instead of a `.CNV`:

```text
<label>,<source key>,<related description field>,<related.DBf>
```

R01.1 parses and retains this as `kind: 'dbf-lookup'`.

Execution currently throws a clear `UnsupportedDefFeatureError` if code tries to bridge such an option into the current QueryPlan.

### Decision D-R01-009 — do not flatten related DBF lookup into CNV by assumption

Before execution we need real evidence for:

- index key selection;
- documented fallback to first field when same-name key does not exist;
- duplicate-key behavior;
- missing-key behavior;
- ordering;
- selection semantics.

## 29.6 Newly discovered unresolved `X` directive

The `defcnv.htm` shipped in the supplied TabWin 4.15 package says the CNV start position is indicated in field 4 of records of type:

```text
S, L, C, D, T ou X
```

However, the older full manual's directive list does not define `X`, and the supplied 4.15 documentation inspected so far does not explain its role.

R01.1 behavior:

- detect it;
- retain the source line;
- emit a warning;
- do **not** assign guessed roles.

### Decision D-R01-010 — X is a tracked archaeology target

This must be resolved by a modern DEF corpus or stronger documentation. It is not allowed to silently become S/L/C/T behavior based on intuition.

## 29.7 Golden comparator implemented

New file:

```text
packages/core/src/golden.ts
```

`GoldenTableV1` defines the normalized machine-readable oracle.

Comparator checks independently:

- row labels and order;
- column labels and order;
- matrix shape;
- every numeric cell;
- explicit absolute tolerance, default zero.

It returns structured cell diffs rather than a generic boolean.

### Decision D-R01-011 — golden equivalence is structural, not only numerical

A table with the same multiset of values but different categories/order is **not** compatible.

## 29.8 G001 capture protocol is now concrete

New file:

```text
docs/testing/G001_CAPTURE_PROTOCOL.md
```

and an empty committed workspace:

```text
fixtures/golden/G001/
├── source/
├── def/
├── cnv/
├── reference-tabwin415/
└── expected/
```

Preferred first reference case, after validating the real `RD2008.DEF` option name:

```text
source:     RDAC2401.dbc
row:        Sexo / simplest CNV-backed low-cardinality dimension
column:     inactive
increment:  frequency
filters:    none
source set: one DBC only
```

The point is to cover DBC + DEF + CNV + ordering + frequency with minimal unrelated behavior.

The protocol requires the original TabWin result **and log/export**, not a screenshot alone.

## 29.9 Decoder dependency pinned for integration

Repository `package.json` now records:

```json
"@precisa-saude/datasus-dbc": "2.0.2"
```

Upstream package metadata identifies it as a browser + Node pure TS/JS decoder with zero runtime dependencies and Apache-2.0 license.

The current isolated runtime cannot download/install the binary fixture or npm package from the network, so the adapter itself is the next integration step when the dependency can actually be materialized. This is an **execution-environment limitation**, not evidence of project infeasibility.

The repository also pins the compiler baseline used in this work:

```json
"typescript": "5.8.3"
```

## 29.10 CI correction

R01.0 CI invoked `npm test` without first installing a local TypeScript dependency; that would be unreliable on a fresh GitHub runner.

R01.1 fixes the contract:

```text
setup Node 22
-> npm install
-> npm test
-> tsc build
-> node test suite
```

When a lockfile exists, this should be tightened to `npm ci`.

### Decision D-R01-012 — fresh-clone CI is the actual CI target

A test suite passing only because the development runtime happens to have global `tsc` is insufficient.

## 29.11 Automated test state

R01.1-dev local result:

```text
22 tests
22 pass
0 fail
```

New coverage since R01.0:

- documented DEF parser;
- related DBF lookup recognition;
- D/T role expansion;
- A + SQL extension parsing;
- G/R parsing;
- X non-guessing behavior;
- DEF start-position slicing for dimensions;
- DEF start-position slicing for filters;
- weighted frequency via G;
- DEF-to-QueryPlan bridge;
- synthetic golden structural comparison.

**Important:** this remains **synthetic semantic evidence**, not a real compatibility claim.

## 29.12 Current compatibility matrix

```text
Feature                                      Evidence             Status
--------------------------------------------------------------------------------
QueryPlan validation                         unit/synthetic       ✓ implemented
Frequency                                    unit/synthetic       ✓ implemented
Numeric increment sum                        unit/synthetic       ✓ implemented
DEF parser A/S/L/C/Q/D/T/I/G/R              docs + G001 golden  △ covered slice
DEF start-position semantics                 docs + G001 golden  ✓ G001 ordinary L
DEF G grouped frequency                      docs + synthetic    △ no real golden
DEF DBF lookup parsing                       docs + synthetic    △ parse only
DEF DBF lookup execution                     none                 ✗
DEF X directive                              partial 4.15 docs    ✗ semantics unknown
Legacy short CNV                             docs + G001 golden  ✓ G001 later-match case
Legacy literal CNV                           docs + synthetic    △ no real golden
CNV F/Faixas                                 docs + synthetic    △ no real golden
CNV subtotals                                docs + synthetic    △ no real golden
New N-format CNV                             detection only       ✗
DBC ingestion                                G001 real pipeline    ✓ 4,315/4,315 records
G001 real TabWin 4.15 equivalence            lossless BIFF golden ✓ exact, tolerance 0
TAB replay                                   none yet             ✗
```

No public-facing generic compatibility badge is justified yet.

## 29.13 Project feasibility assessment at R01.1

**Technical feasibility remains high.** Nothing discovered so far suggests a project-scale blocker.

The work is not “stupendously” large if scope is disciplined:

### Small/straightforward

- modern web shell/UI;
- DEF panel generation once normalized;
- local file drag/drop;
- table rendering/export;
- charts;
- recipe persistence;
- provenance sidecars.

### Medium but bounded

- DBC integration in browser worker;
- complete real DEF/CNV corpus validation;
- performance executor (likely DuckDB-Wasm or equivalent);
- geography/map data/versioning;
- `.TAB` archaeology.

### Highest compatibility risk

- undocumented edge semantics (`X`, new CNV `N`, related DBF quirks, non-classified rules, exact total/subtotal behavior);
- these can be isolated behind evidence-scoped golden tests rather than blocking the whole product.

**Current recommendation:** continue. Do not switch implementation strategy merely because binary fixture acquisition is unavailable inside this runtime.

## 29.14 Codex/secondary-agent budget policy

The user has only a small remaining external coding-agent quota and wants it preserved.

### Decision D-R01-013 — external coding agent is contingency-only

Use an external coding agent only when all are true:

1. a concrete narrow blocker exists;
2. ordinary inspection/documentation/local implementation has failed;
3. the task can be expressed in a small isolated prompt;
4. expected output can be locally verified with tests;
5. it will not become a hidden source of architecture decisions.

Good candidates:

- reverse-engineer one undocumented sample line of `X` from a supplied real corpus;
- inspect one small parser bug whose fixture is available;
- derive one exact binary parsing edge case.

Bad candidates:

- “build the frontend”;
- “finish TabWin Web”;
- open-ended refactors;
- architecture generation;
- anything that duplicates work this repository can already do locally.

## 29.15 Immediate next sequence

### R01.2 target — real assets + DBC adapter

1. materialize `@precisa-saude/datasus-dbc@2.0.2` in a networked development environment;
2. materialize `RDAC2401.dbc`;
3. acquire current official SIH auxiliary bundle from `.../SIHSUS/200801_/Auxiliar/`;
4. copy `RD2008.DEF` and only needed CNVs into an uncommitted inspection workspace first;
5. run `parseDef` over the real file;
6. enumerate every encountered directive and referenced conversion/lookup;
7. open required CNVs with `parseCnv`;
8. resolve any corpus-driven parser failures without weakening strictness globally;
9. implement `readDbcRecords` adapter behind a small ingestion interface;
10. run the selected G001 recipe in TabWin Web;
11. capture original TabWin 4.15 output on Windows;
12. normalize to `GoldenTableV1`;
13. run comparator;
14. classify every mismatch by layer;
15. only then update a compatibility item from synthetic to golden.

### R01.2 stop conditions

Escalate explicitly rather than guessing if:

- actual `RD2008.DEF` contains an undocumented directive that affects G001;
- required CNV uses the unresolved N-format;
- DBC decoder differs from TabWin on record count/deleted records;
- original TabWin output cannot be exported losslessly;
- license/redistribution status prevents committing required auxiliary files.

None of those is known to be true yet.

---

# 30. Revision log continuation

## R01.1-dev — 2026-08-26

Added:

- `.DEF` normalized model;
- `.DEF` parser for A/S/L/C/Q/D/T/I/G/R;
- optional SQL source parsing on A;
- related DBF lookup recognition;
- explicit unknown/X retention;
- DEF 1-based source start-position semantics in QueryPlan;
- weighted frequency for grouped DEF files;
- DEF -> dimension/filter/measure bridge;
- structural golden comparator;
- G001 capture protocol + fixture workspace;
- ADR-0004;
- `DEF_SPEC_R01.md`;
- pinned planned DBC decoder dependency `@precisa-saude/datasus-dbc@2.0.2`;
- pinned TypeScript 5.8.3 development baseline;
- fresh-clone-oriented CI installation step;
- **22/22 passing tests**.

Still pending:

- materialize real DBC + SIH auxiliary assets;
- parse contemporary `RD2008.DEF` corpus;
- integrate DBC decoder;
- capture first TabWin 4.15 reference table/log;
- pass G001;
- investigate DEF `X`;
- investigate CNV `N`;
- implement related DBF lookup only when a golden case requires it.

**Next revision trigger:** real `RD2008.DEF` corpus parsed successfully + DBC records flowing into the reference executor, or discovery of a concrete compatibility blocker requiring an explicit architecture decision.

---

# 31. Cloud-credit and AI acceleration strategy — 2026-08-26

## 31.1 Context

The project currently has access to temporary cloud credits in more than one provider. These credits are useful acceleration capital, but they must not become architectural requirements for TabWin Web.

The product remains local-first: a user should be able to load and tabulate supported local health-data files without mandatory upload to a paid backend.

## 31.2 Decision D-R01-014 — cloud credits are acceleration capital, not architecture

No essential TabWin Web capability may depend on a cloud service whose cost becomes unacceptable after temporary credits expire.

Temporary credits may be used to accelerate:

- CI and compatibility experiments;
- temporary benchmarking;
- model inference for supervised coding/review tasks;
- disposable compute;
- public demo/staging infrastructure;
- large fixture conversion experiments;
- observability during development;
- optional backend prototypes.

The durable assets must remain portable:

- source code;
- tests;
- fixtures permitted for redistribution;
- golden-result metadata;
- documentation;
- recipes;
- manifests;
- benchmark reports;
- deployment definitions.

## 31.3 Google Cloud role

Preferred role during the credit window:

1. Vertex AI/Gemini inference for tightly scoped coding/review tasks when useful;
2. Cloud Run for optional APIs/demos that can scale to zero;
3. object storage for temporary benchmark artifacts if needed;
4. CI/CD experiments and public staging;
5. BigQuery only as an optional research/benchmark comparison, never as the semantic source of truth;
6. temporary compute for corpus-scale validation.

Do not introduce GKE/Kubernetes or permanently running VMs unless a measured requirement appears.

## 31.4 Azure role

Azure is secondary and disposable in the current architecture.

Good uses:

- Windows/Linux cross-platform benchmark workers;
- temporary high-memory/CPU experiments;
- optional comparison of model/tooling capabilities;
- isolated batch jobs.

Azure must not become a required runtime dependency merely because credits are available.

## 31.5 AI coding-agent policy

A cloud-paid model can be used as an additional engineering worker, but it is not trusted as an authority on TabWin semantics.

All model-produced compatibility changes require:

1. a bounded task;
2. a diff that can be inspected;
3. automated tests;
4. evidence for any legacy-semantic claim;
5. no direct write to protected/main branches;
6. checkpoint/ADR update when an architectural decision changes.

### Model tiering principle

Use cheaper/faster models for mechanical work and stronger models only for compatibility investigations, difficult debugging or review where the expected value justifies the cost.

## 31.6 Codex budget policy update

The user's remaining Codex allowance is approximately 7% and is intentionally preserved.

Codex remains contingency-only. Prefer local implementation and, when beneficial, cloud-credit-funded model inference before spending the remaining Codex budget.

A Codex call is justified only for a small, concrete blocker with independently verifiable output.

## 31.7 Portability requirement

The canonical source of truth remains the repository plus `CHECKPOINT_MASTER.md`.

The project must be transferable between ChatGPT, Gemini, Claude, Codex or a human developer without requiring hidden conversational memory.

Minimum handoff set:

- `CHECKPOINT_MASTER.md`;
- `README.md`;
- `PROJECT_STATE.json`;
- `docs/architecture/`;
- `docs/legacy/`;
- `docs/testing/`;
- `packages/`;
- `tests/`;
- golden fixture workspace.

## 31.8 Current recommendation

Do not spend meaningful cloud budget yet on infrastructure. The immediate critical path is still semantic compatibility:

`real DBC -> real DEF/CNV -> TabWin Web result -> original TabWin 4.15 result -> exact golden comparison`.

Cloud AI can accelerate implementation and investigation, but it cannot substitute for the G001 evidence.

---

# 32. Immediate handoff state — 2026-08-26

Current development revision: **R01.1-dev + cloud/agent policy update**.

Known working baseline at last local verification:

- 22/22 automated tests passing;
- CNV legacy parser and matcher;
- DEF parser/model/bridge;
- reference tabulation executor;
- QueryPlan/AnalysisSpec separation;
- deterministic recipes and run manifests;
- golden-table comparator;
- G001 fixture/capture protocol;
- CI workflow;
- local-first architecture and threat model.

Immediate next engineering milestone remains **R01.2**:

1. obtain/materialize a real SIH DBC fixture;
2. obtain the corresponding real `RD2008.DEF` and required CNVs;
3. parse the real corpus strictly;
4. connect DBC records to the reference executor;
5. generate the first TabWin Web real table;
6. capture the same recipe in TabWin 4.15;
7. compare with zero numeric tolerance;
8. classify and resolve discrepancies;
9. mark only evidence-backed compatibility as supported.

Do not spend time polishing the production UI before G001 unless UI work directly enables capture/debugging.

---

# 33. VM bootstrap and supervised Gemini workflow — 2026-08-26

## 33.1 Why the workflow changed

The project moved from Colab experimentation to a persistent Google Compute Engine development workstation. The purpose is not to make TabWin Web cloud-dependent. The VM is a temporary development accelerator paid from Google Cloud credits.

The division of responsibility is now:

- **ChatGPT in the main conversation:** architecture, semantic review, compatibility reasoning, review of Gemini-produced diffs, checkpoint governance.
- **Gemini on the VM:** bounded implementation tasks, repository inspection, mechanical refactors, tests, browser/UI inspection when configured.
- **User's local Windows PC:** original TabWin 4.15 oracle for reference executions and capture of golden results.
- **GitHub:** intended interchange layer for code, branches, pull requests, CI and review artifacts.

No AI model may independently declare TabWin compatibility. Compatibility remains evidence-backed by golden tests.

## 33.2 Google Cloud account/model findings

Observed during setup:

- Google Cloud billing/account is fully activated.
- Promotional credit shown during setup was approximately BRL 1.8k and expires on the trial schedule.
- Claude partner-model requests through Vertex/Agent Platform reached the provider endpoint successfully but returned HTTP 429 because project quota for the relevant global Anthropic base-model buckets was zero.
- The quota console confirmed `global_online_prediction_*` quota values of zero for `base_model: anthropic-claude-sonnet`; quota increases required provider approval.
- Google Cloud Support declined the immediate increase for the new project and instructed waiting approximately 48 hours / for billing history before resubmitting.
- The Marketplace activation flow for Claude warns that promotional credits may not apply to Marketplace purchases. Therefore partner MaaS usage must not be assumed to consume the promotional balance.
- Current preferred paid-credit-compatible model path is **Gemini via Google Cloud/Vertex**, supervised by ChatGPT.
- Self-hosted open models remain an optional experiment, not a current dependency. A Kimi-K3 deployment notebook was explicitly rejected for routine use because it targets a multi-host deployment with 16 NVIDIA B200 GPUs and would consume credits extremely quickly.

## 33.3 VM configuration actually chosen

The development VM was created in Google Compute Engine with the following intended configuration:

- instance name visible in SSH: `tabwin`;
- region/zone observed in the browser SSH URL: `southamerica-east1-a` (São Paulo region);
- machine family/type: `e2-standard-2`;
- CPU/RAM: 2 vCPU / 8 GB RAM;
- operating system: Ubuntu 26.04 LTS Minimal, x86_64;
- boot disk: 100 GB balanced persistent disk;
- display device enabled;
- HTTP/HTTPS public firewall checkboxes left disabled;
- no automatic backups/snapshots required for the development VM;
- no replication;
- no service account attached to the VM;
- vTPM enabled;
- integrity monitoring enabled;
- Secure Boot left disabled;
- confidential VM disabled;
- Google-managed disk encryption;
- IP forwarding disabled;
- deletion protection was recommended;
- SSH is accessed through Google browser SSH / IAP.

The purpose of choosing Ubuntu instead of Windows is to keep the development workstation cheaper/lighter and better suited to Git/Node/Gemini automation. The original Windows TabWin 4.15 remains on the user's local PC for oracle/reference runs.

## 33.4 IAP/SSH setup note

The first browser SSH attempt failed with IAP error 4003 because the backend was unreachable. The UI indicated the standard IAP source range `35.235.240.0/20` to TCP port 22. Access was subsequently established successfully.

Do not open SSH globally to `0.0.0.0/0` merely to simplify access. IAP/browser SSH is preferred.

## 33.5 Ubuntu upgrade/bootstrap state

Initial system update/upgrade completed. The VM then reported `System restart required`, and after reboot the running kernel was observed as `7.0.0-1010-gcp`.

A transient package-management issue occurred after the upgrade:

`dpkg was interrupted, you must manually run 'sudo dpkg --configure -a' to correct the problem.`

If this is still unresolved on continuation, run:

```bash
sudo dpkg --configure -a
sudo apt --fix-broken install -y
sudo apt install -y git curl wget unzip build-essential ca-certificates gnupg
```

The user's `sudo` was tested after reconnect/reboot and `sudo whoami` returned `root`, so root authorization is currently working.

## 33.6 Remaining bootstrap sequence on the VM

After `dpkg` is healthy, install the development stack in this order:

```bash
sudo apt install -y git curl wget unzip build-essential ca-certificates gnupg
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
sudo npm install -g @google/gemini-cli
gemini --version
```

Then upload the current project handoff ZIP through browser SSH or clone from GitHub once the repository is connected.

Do not install a GPU or self-host a large model on this VM. Gemini should be consumed as an external managed model; the VM is the coding workstation.

## 33.7 Gemini supervision contract

Gemini is a worker, not the semantic authority. Before making changes it must read:

1. `GEMINI_HANDOFF.md`;
2. `HANDOFF_README.md`;
3. `CHECKPOINT_MASTER.md`;
4. relevant ADRs/specifications for the assigned task.

Gemini must obey all of the following:

- do not invent TabWin behavior;
- distinguish documented/tested/inferred/unknown claims;
- run the existing test suite before edits;
- make bounded changes;
- add tests for behavior changes;
- never change a golden expected result only to make a failing test pass;
- never directly push to protected/main branches;
- produce a review handoff with changed files, test results, uncertainties and questions;
- update `CHECKPOINT_MASTER.md` when an architectural or compatibility decision materially changes;
- stop and ask for review when evidence is insufficient.

## 33.8 ChatGPT review contract

After Gemini completes a task, the preferred review bundle is:

- Git commit/branch or patch/diff;
- `git status`;
- `git diff --stat` and full diff;
- exact test command and output;
- updated checkpoint section if required;
- list of assumptions/unknowns;
- any new fixture/reference evidence.

ChatGPT should review semantic correctness before accepting changes to DEF/CNV/TAB behavior, golden tests, epidemiological calculations, provenance/audit logic, or architecture.

## 33.9 Golden-test oracle workflow

Because the VM is Ubuntu, the original TabWin 4.15 is not treated as a native oracle there.

Reference workflow:

```text
Local Windows PC
  TabWin 4.15
      -> run exact G001 recipe
      -> export/capture result.csv / .TAB / screenshot / notes
      -> transfer to repository/VM

Ubuntu VM
  TabWin Web
      -> execute same inputs/recipe
      -> compare exact matrix against captured reference
      -> classify discrepancy
```

Wine may be explored experimentally, but a Wine execution must not replace a validated Windows TabWin 4.15 oracle without evidence that it behaves identically for the relevant operation.

## 33.10 Current project baseline reverified before this handoff

On 2026-08-26, immediately before packaging this handoff, the repository test suite was rerun:

- **22 tests total**;
- **22 passed**;
- **0 failed**;
- build completed successfully with TypeScript compiler;
- command: `npm test`.

This is the baseline Gemini must preserve before beginning R01.2 work.

## 33.11 Immediate next actions

Operational next actions:

1. repair/complete `dpkg` configuration if needed;
2. install Git/curl/wget/unzip/build-essential;
3. install Node.js 22;
4. install Gemini CLI;
5. upload/extract this handoff or connect GitHub;
6. run `npm test` on the VM and confirm 22/22;
7. give Gemini the bounded R01.2 assignment using `GEMINI_HANDOFF.md`;
8. have Gemini produce a diff/handoff, not an unreviewed merge;
9. review with ChatGPT;
10. proceed toward the real DBC + real DEF/CNV + G001 exact comparison.

Engineering next milestone remains unchanged: **R01.2 = first real-data pipeline toward G001**.

## VM bootstrap update — 2026-08-27 00:56 UTC

- VM reachable via browser SSH after reboot.
- Kernel after reboot: 7.0.0-1010-gcp.
- `sudo whoami` returned `root`; sudo is functional.
- Base package installation resumed after `sudo dpkg --configure -a` / package-manager recovery.
- Gemini CLI installed successfully; reported version `0.57.0`.
- `npm` printed an optional upgrade notice to 12.0.2. Attempting `npm install -g npm@12.0.2` as an unprivileged user failed with `EACCES` on `/usr/lib/node_modules/npm`. This is NOT a project blocker and the npm upgrade is unnecessary. Do not change npm globally unless required; if ever needed, use a user-local Node manager (preferred) rather than sudo-global npm mutation.
- Next operational step: upload this handoff ZIP to the VM, extract it, run project baseline tests, then launch Gemini CLI from the repository root using `GEMINI_HANDOFF.md`.
