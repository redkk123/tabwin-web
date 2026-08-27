# TabWin 4.15 — feature inventory and compatibility matrix

## Evidence and scope

This inventory was rebuilt on 2026-08-26 from the project-owner-supplied
TabWin 4.15 distribution. The WinHelp contents index (`TABWIN32.CNT`) contains
17 sections and 150 named help topics. `DocTabWin.htm`, `defcnv.htm`,
`HISTORIA.TXT`, the shipped maps and the existing architecture documents were
used as supporting evidence.

The catalog is complete at the **named help-topic level**. It is not a claim
that every topic's detailed computational behavior has been specified or
implemented. Each family below distinguishes those states explicitly.

Status vocabulary:

- **Web** — usable through the browser UI;
- **Kernel** — implemented behind `AnalysisSpec -> QueryPlan -> Executor`, but
  not yet fully surfaced in the UI;
- **Parsed** — input is read and preserved, but execution may remain guarded;
- **Cataloged** — confirmed in 4.15 help; behavioral oracle work remains;
- **Replaced** — the user outcome stays, but an obsolete mechanism will not be
  recreated literally.

## 1. Source opening and tabulation

| TabWin capability | Web status | Notes |
| --- | --- | --- |
| Open `.DBC` and `.DBF` | **Web** | Browser-compatible decoder; no upload. |
| Search/download official microdata | **Web / modern extension** | Official DATASUS catalog, system/type/year/month/UF filters, official HTTPS preparation and local opening. Not a claimed 4.15 compatibility behavior. |
| Resolve official DEF/CNV auxiliaries | **Web / partial** | Verified SIH-RD rule downloads current `TAB_SIH.zip` and loads `RD2008.DEF` plus referenced CNVs. Other systems remain explicit pending rules. |
| Select `.DEF` | **Web / Parsed** | `A`, `R`, `S/L/C/Q/D/T`, `I`, `G`; unknown directives retained. |
| Apply `.CNV` | **Web / Kernel** | Legacy short, literal and numeric-range forms; source-order precedence retained. New `N` layout remains guarded. |
| Row and column dimensions | **Web** | Raw rows/columns; row CNV in the current UI. |
| Frequency | **Web** | Ordinary and `G` weighted frequency in kernel. |
| Increment / sum | **Web / Kernel** | Numeric and DEF increment labels surfaced; compiled as explicit sum measure. Total policies remain pending. |
| Selections / filters | **Web / Kernel** | Multiple simultaneous raw or DEF/CNV-backed inclusion filters; exclusion and range-dialog UX remain pending. |
| Suppress zero rows | **Web** | Applied after materializing CNV categories. |
| Row subtotals | **Kernel** | CNV subtotal propagation tested. |
| Tabulate list of files | **Cataloged** | Multi-period ingestion/merge semantics pending oracle cases. |
| Value ranges | **Parsed / Kernel** | Numeric-range CNV supported; full dialog behavior pending. |
| Top `n` categories | **Cataloged** | Must define tie/order semantics from the oracle. |
| Unclassified data | **Cataloged** | No guessed fallback category. |
| Log file | **Replaced** | Audit JSON exists; legacy log import/export pending. |

## 2. Tables, saved work and exports

| Capability family | Web status | Named 4.15 topics |
| --- | --- | --- |
| Open/save table | **Web recipe / Cataloged `.TAB`** | Portable `.twrecipe` save/open is usable; legacy `.TAB` parsing and exact table-state recovery remain pending. |
| Print | **Cataloged** | Print table. Browser print stylesheet pending. |
| Export | **Web (CSV/XML)** | Complete result matrix and provenance-aware XML; XLSX, DBF, Parquet and legacy formats pending. |
| Copy/paste/include table | **Cataloged** | Clipboard and table inclusion semantics pending. |
| Save selected records as DBF | **Cataloged** | Local download adapter pending. |
| Audit/recipe | **Web / Kernel** | QueryPlan and hashes visible; deterministic recipe save/open validates plans and fingerprints. |

## 3. Table calculations

All of the following are confirmed by individual help topics. They must become
explicit, replayable result transforms and must never mutate the source
`QueryPlan` silently.

| Operation | Status |
| --- | --- |
| Indicator calculation | **Cataloged** |
| Add two or more columns | **Cataloged** |
| Subtract, multiply or divide two columns | **Cataloged** |
| Minimum and maximum | **Cataloged** |
| Multiply by a factor | **Cataloged** |
| Percentage | **Cataloged** |
| Accumulate a column | **Cataloged** |
| Absolute value and integer values | **Cataloged** |
| Define sequence | **Cataloged** |
| Recalculate total / change total type | **Cataloged** |
| Insert a new column | **Cataloged** |

## 4. Table presentation

Confirmed topics: sort values; alter column header, width and decimal places;
delete and move columns; suppress/aggregate rows; show/hide key; fix key
length; edit two table headers; insert footnote; locate a row category.

These are **Cataloged**. Modern table presentation may differ visually, but
every operation that changes data must be represented separately from purely
visual sorting or formatting.

## 5. Charts

| Chart or operation | Status |
| --- | --- |
| Horizontal bars | **Web** | First responsive chart view, driven by the current `TabulationResult`. |
| Lines | **Web** | SVG renderer over current result; legacy display options still need oracle cases. |
| Vertical bars | **Web** | SVG renderer over current result. |
| Pie / sectors | **Web** | Top positive categories with explicit percentages. |
| Areas | **Web** | SVG area/line renderer over source row order. |
| Points / scatter | **Web** | Point view over row position and value; expert axis binding remains pending. |
| Bubbles | **Web** | Bubble size derives from result magnitude. |
| Arrows | **Web** | Requires two or more columns and displays first-to-last change; distinct from map flows. |
| Empty chart / add chart type | **Cataloged** | Composition workflow pending. |
| Edit background, title font, legend and display options | **Cataloged** | Will be expressed as portable view settings. |
| Edit axes, zoom and zoom reset | **Cataloged** | Touch/keyboard behavior required on web. |
| 3D effect | **Cataloged / likely historical** | Compatibility option only if it changes an exported artifact users still need. |
| Background image | **Cataloged** | Local-only image input if retained. |
| Copy, print and save chart | **Web (PNG/SVG) / Cataloged** | Every current chart family exports PNG and SVG; browser print remains pending. |

## 6. Maps and geographic analysis

| Capability | Status | Notes |
| --- | --- | --- |
| Open TabWin `.MAP` | **Web / Parsed** | Version 1.00 parser validated on the supplied UF and 5,570-municipality maps. |
| Choropleth from table | **Web** | Canvas renderer associates result keys or labels locally. |
| Bundled municipality and UF maps | **Web** | A DBC geographic row can map without a second download. |
| Equal interval / equal frequency classes | **Web** | Continuous, equal-interval and quantile/equal-frequency presentations are explicit; exact legacy break/rounding semantics remain pending. |
| Edit class count, limits, colors and palette | **Web / Partial** | Class count and four accessible palettes persist in recipes; manual limits and individual colors remain pending. |
| Zoom, pan and repaint | **Web** | Buttons, wheel/touchpad zoom, pointer/touch pan and reset are available. |
| Borders, seats, names and values | **Parsed / Cataloged** | MAP seat/type and label coordinates retained; display controls pending. |
| Select areas / obtain information | **Web / Partial** | Local polygon hit testing identifies name/code and associated value; selection-to-filter bridge remains pending. |
| Add/remove layers and new base map | **Cataloged** | Must remain local-first. |
| Distance column | **Cataloged** | Geographic formula and projection handling require oracle evidence. |
| Origin–destination flows | **Cataloged** | Help confirms flow table, arrows, origin/destination totals and sector charts. |
| Import E00, SHP, BNA, BND, MIF/MID, XY, WPT, GPX, MME, SPRING | **Cataloged** | Demand-driven adapters; modern GeoJSON/GeoPackage may be offered alongside them. |
| Copy, print, bitmap and KML-related export | **Web (PNG) / Cataloged** | Current canvas map exports PNG; GeoJSON/KML, print and compatibility formats remain explicit future work. |

## 7. Statistical analysis

Four named operations are confirmed and currently **Cataloged**:

1. descriptive statistics for one column;
2. Pearson correlation coefficient;
3. simple linear regression;
4. histogram analysis.

Each needs golden numerical cases, including missing-value and rounding policy,
before compatibility claims.

## 8. DEF/CNV authoring and DBF utilities

Confirmed topics include concepts, edit and create flows for DEF/CNV; DBF
viewer; DBF compression to DBC; DBC expansion; CRC test; accent conversion;
and saving records to a new DBF. Reading/parsing is **Web / Parsed**; authoring,
writing and utility operations are **Cataloged**.

## 9. Integrations and historical mechanisms

| Capability | Decision |
| --- | --- |
| TabWin + R analysis schemes | **Cataloged** as an expert workflow. A browser-safe recipe/plugin boundary is preferred; arbitrary local R cannot run on GitHub Pages. |
| TabWin + SQL saved queries | **Cataloged**. DuckDB/WASM may execute compiled plans later but must not define legacy semantics. |
| XML/SDF/CSV/DBF import | **Cataloged**; CSV is a likely early adapter. |
| Wine instructions | **Replaced** by the native browser application. |
| BDE, WinHelp, Registry discovery, WMF-first graphics, FTP browser assumptions | **Replaced**; do not recreate. |

## Next compatibility slices

1. Capture the real G001 oracle export/log in TabWin 4.15.
2. Move DBC decoding to a cancellable Web Worker and benchmark mobile memory.
3. Surface DEF-driven rows, columns, increments and selections in the UI.
4. Continue `.TAB` archaeology and add explicit result transforms; portable recipe save/open is now Web.
5. Add remaining chart families, then legacy map classes and area selection.
6. Establish focused goldens for statistics, saved `.TAB`, DBF subsets and
   origin–destination flow.
