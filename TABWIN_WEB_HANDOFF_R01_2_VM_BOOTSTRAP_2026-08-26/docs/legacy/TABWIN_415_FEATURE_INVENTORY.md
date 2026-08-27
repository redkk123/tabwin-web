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
| G001: one CNV-backed row, frequency | **Golden** | Exact TabWin 4.15 BIFF comparison passed with tolerance zero. |
| Increment / sum | **Web / Kernel** | Numeric and DEF increment labels surfaced; compiled as explicit sum measure. Total policies remain pending. |
| Selections / filters | **Web / Kernel** | Multiple simultaneous raw or DEF/CNV-backed inclusion/exclusion filters, explicit numeric intervals and selection-all/clear controls. Exact 4.15 dialog defaults remain golden-pending. |
| Suppress zero rows | **Web** | Applied after materializing CNV categories. |
| Row subtotals | **Kernel** | CNV subtotal propagation tested. |
| Tabulate list of files | **Cataloged** | Multi-period ingestion/merge semantics pending oracle cases. |
| Value ranges | **Web / Kernel** | Numeric-range CNV plus explicit open/closed filter bounds in the browser. |
| Top `n` categories | **Cataloged** | Must define tie/order semantics from the oracle. |
| Unclassified data | **Web / explicit policy** | Omit remains the default; users may select unmatched CNV values in filters or materialize a `Não classificados` axis row. Exact 4.15 label/default remains golden-pending. |
| Log file | **Replaced** | Audit JSON exists; legacy log import/export pending. |

## 2. Tables, saved work and exports

| Capability family | Web status | Named 4.15 topics |
| --- | --- | --- |
| Open/save table | **Web `.twtable` + recipe / Cataloged `.TAB`** | Portable results reopen without the source DBC and retain operations/presentation; `.twrecipe` re-executes against data. Legacy `.TAB` parsing remains pending. |
| Print | **Cataloged** | Print table. Browser print stylesheet pending. |
| Export | **Web (CSV/XML/XLSX)** | Complete result matrix, provenance-aware XML and two-sheet XLSX with audit metadata; DBF, Parquet and legacy formats pending. |
| Copy/paste/include table | **Web copy / Cataloged paste+include** | Current presented rows copy as spreadsheet-ready TSV; paste and table inclusion semantics pending. |
| Save selected records as DBF | **Web / golden-pending** | The executor's accepted record set is written as standard local xBase DBF; exact 4.15 dialog/schema defaults need an oracle artifact. |
| Audit/recipe | **Web / Kernel** | QueryPlan and hashes visible; deterministic recipe save/open validates plans and fingerprints. |

## 3. Table calculations

All of the following are confirmed by individual help topics. They must become
explicit, replayable result transforms and must never mutate the source
`QueryPlan` silently.

| Operation | Status |
| --- | --- |
| Indicator calculation | **Web / partial** — explicit numerator/denominator percentage is available; legacy indicator dialog defaults still need an oracle. |
| Add two or more columns | **Web / modern policy** — pairwise addition can be chained and is persisted in recipes. |
| Subtract, multiply or divide two columns | **Web / modern policy** — division-by-zero behavior is explicit (`error` or `zero`). |
| Minimum and maximum | **Web / modern policy** |
| Multiply by a factor | **Web / modern policy** |
| Percentage | **Web / modern policy** — computes `A / B × 100` with explicit zero policy. |
| Accumulate a column | **Web / modern policy** — current result row order is authoritative. |
| Absolute value and integer values | **Web / modern policy** — UI integer conversion uses truncation toward zero; kernel also represents round/floor/ceil. |
| Define sequence | **Web / modern policy** — UI exposes start value and unit step. |
| Recalculate total / change total type | **Web / modern policy** — none, sum, product, mean, initial, final, min and max are explicit per derived column. |
| Insert a new column | **Web / modern policy** — constants and safe expressions support `C01`, exact keys, bracketed titles, parentheses and `+ - * / ^`. |

All implemented transforms are immutable, replayable and shown in the Audit
view. They sit after `TabulationResult`; none silently rewrites the source
`AnalysisSpec` or `QueryPlan`. The operation family is not marked golden until
focused TabWin 4.15 reference cases establish defaults, rounding and edge cases.

## 4. Table presentation

| Presentation capability | Status |
| --- | --- |
| Sort values | **Web / modern presentation** — original, ascending and descending by key or numeric column; stable and non-mutating. |
| Decimal places | **Web / modern presentation** — automatic or 0–6 fixed decimal places. |
| Show/hide key | **Web / modern presentation** — sticky key remains the default. |
| Locate row/category | **Web / modern presentation** — accent-insensitive key and label search. |
| Print table | **Web / modern presentation** — dedicated browser print stylesheet. |
| Alter column header and width | **Cataloged** |
| Delete and move columns | **Web / modern policy** — rename, move left/right and remove are immutable recipe operations; the final numeric column cannot be deleted. |
| Suppress/aggregate rows | **Web / modern policy** — locate selects rows; suppression or sum aggregation is reversible and audited. |
| Fix key length | **Cataloged** |
| Edit two table headers / insert footnote | **Cataloged** |

Sorting, decimals and key visibility persist in recipes and appear in Audit.
The locate query intentionally does not persist because it is transient UI
state. Modern presentation may differ visually, but every operation that
changes data remains separate from purely visual sorting or formatting.

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

Four named operations are confirmed and now have an initial **Web** surface:

1. descriptive statistics for one column;
2. Pearson correlation coefficient;
3. simple linear regression;
4. histogram analysis.

They operate over columns of the current `TabulationResult`, persist their view
settings in recipes and are labeled as modern calculations. Each still needs
golden numerical cases, including missing-value, population/sample and rounding
policy, before compatibility claims.

## 8. DEF/CNV authoring and DBF utilities

Confirmed topics include concepts, edit and create flows for DEF/CNV; DBF
viewer; DBF compression to DBC; DBC expansion; CRC test; accent conversion;
and saving records to a new DBF. Reading/parsing, DBC expansion and
executor-selected record writing are now **Web**. DBF-to-DBC encoding,
authoring, CRC reporting and accent conversion remain **Cataloged**.

## 9. Integrations and historical mechanisms

| Capability | Decision |
| --- | --- |
| TabWin + R analysis schemes | **Cataloged** as an expert workflow. A browser-safe recipe/plugin boundary is preferred; arbitrary local R cannot run on GitHub Pages. |
| TabWin + SQL saved queries | **Cataloged**. DuckDB/WASM may execute compiled plans later but must not define legacy semantics. |
| XML/SDF/CSV/DBF import | **Web CSV/TSV / Cataloged others**; delimited input runs under the modern profile and does not claim legacy importer defaults. |
| Wine instructions | **Replaced** by the native browser application. |
| BDE, WinHelp, Registry discovery, WMF-first graphics, FTP browser assumptions | **Replaced**; do not recreate. |

## Next compatibility slices

1. Move DBC decoding to a cancellable Web Worker and benchmark mobile memory.
2. Surface remaining DEF-driven columns, increments and selection modes in the UI.
3. Continue `.TAB` archaeology and add explicit result transforms; portable recipe save/open is now Web.
4. Complete legacy map classes, labels, layers and selection bridging.
5. Establish focused goldens for statistics, saved `.TAB`, DBF subsets and
   origin–destination flow.
