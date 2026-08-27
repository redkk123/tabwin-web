# CHECKPOINT MASTER — TabWin Web

**Revision:** R00  
**Date:** 2026-08-26  
**Status:** Architecture baseline / pre-MVP  
**Working name:** TabWin Web  
**Canonical role of this file:** project memory, context handoff, decision ledger, risk register and roadmap.  

> **Rule for future work:** do not rely on chat history as the only source of project state. Every meaningful decision, discovered behavior, test result, blocker, dependency change, compatibility finding, data-format discovery or roadmap change must be reflected here (or in a linked ADR) before a revision is considered closed.

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

## NEXT-01 — Obtain canonical public test assets

Need a small but real set containing:

- DBC;
- corresponding DEF;
- corresponding CNV(s);
- known TabWin output.

Prefer SIH or SIM first because they are familiar, but fixture size should be manageable.

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

**Next revision trigger:** first executed technical spike or new authoritative finding about DEF/TAB/licensing/governance.
