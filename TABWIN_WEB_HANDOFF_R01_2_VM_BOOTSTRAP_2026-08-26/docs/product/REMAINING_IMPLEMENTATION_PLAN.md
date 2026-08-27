# Remaining implementation plan

**Baseline:** R05.1 — 2026-08-27  
**Purpose:** turn the complete TabWin 4.15 inventory into ordered, verifiable
delivery blocks without confusing modern replacements with legacy equivalence.

## Status rules

- **Web** means the outcome is usable in the browser.
- **Compat** means an original TabWin artifact proves the scoped behavior.
- **Modern** means an explicit new policy; it cannot silently define legacy
  semantics.
- Every block ends with `npm run check`, real-browser evidence when applicable,
  a Markdown report, a main-branch commit and a Pages deployment when UI changes.
- Golden references are immutable. A candidate failure changes implementation
  or records an unknown; it never changes the oracle to pass.

## P0 — production DATASUS acquisition

### R05.2 — hardened CORS proxy and public deployment — NEXT

The Worker skeleton already allowlists the three official routes. The next
block must make it production-safe and connect GitHub Pages to it.

Deliverables:

1. strict route/method matrix: `POST /catalog`, `POST /prepare`,
   `GET /archive`, `OPTIONS`, and a local `GET /health`;
2. exact production-origin CORS allowlist, with no reflected arbitrary origin;
3. form content-type and request-size limits;
4. official-host/path validation before and after redirects;
5. archive content-type/length guards and streaming response;
6. upstream timeouts and normalized error envelopes without leaking internals;
7. `Cache-Control`, `Vary` and security headers appropriate to each route;
8. Worker deployment configuration plus a documented rollback command;
9. production build with `VITE_DATASUS_PROXY_BASE` pointing to the Worker;
10. live smoke test: SIH-RD / AC / 2024-01 plus `TAB_SIH.zip` auxiliaries from
    the public Pages origin on desktop and mobile viewport.

External requirement: deploying the Worker needs a Cloudflare account and a
scoped Worker API token or an interactive `wrangler login`. No credential is
committed to the repository.

Done when the public app can search, prepare, download, cache and open the real
G001 DBC without the current CORS error, while arbitrary targets/origins remain
rejected by tests.

### R05.3 — acquisition coverage and cache UX

- verify auxiliary-bundle and DEF/CNV selection rules system by system;
- expose archive contents when no automatic rule is verified;
- recent downloads screen, cache size, retention and explicit removal;
- offline reopening of cached official archives;
- source URL, retrieval time and archive hashes in Audit/recipe;
- clear retry/cancel/progress states for slow DATASUS responses.

Done when every cataloged system is either supported by a verified rule or
explicitly routed through a manual auxiliary picker—never guessed.

## P1 — close the analytical compatibility core

### R06.0 — multi-file and period tabulation

- open a list of compatible DBC/DBF files;
- schema compatibility check and per-source fingerprints;
- deterministic source order and duplicate handling;
- period/source dimension as an explicit option;
- oracle cases for separate(A)+separate(B) versus combined(A,B).

### R06.1 — remaining dimension and selection semantics

- surface DEF-driven row, column, quad and all increment choices;
- expose row subtotals already implemented in the kernel;
- top-N with oracle-defined tie and ordering rules;
- grouped-frequency and multiple-filter UI coverage;
- establish exact defaults for zero suppression and non-classified values;
- implement new-format `N` CNV rows only after real fixtures specify offsets;
- keep DEF `X` guarded until evidence defines its meaning.

### R06.2 — post-table compatibility

- short goldens for indicator, arithmetic, factor, percentage, accumulation,
  integer conversion, sequence, total types, rename/move/delete and row merge;
- headers, widths, key length, two table headers and footnotes;
- paste/include-table behavior;
- legacy log import/export only if an original artifact remains useful.

Done when the ordinary tabulation/table-calculation families have focused
goldens, not merely modern implementations.

## P2 — saved work, formats and authoring

### R07.0 — `.TAB` archaeology

- collect minimal save/reopen artifacts from TabWin 4.15;
- identify container/version, result matrix and recoverable analysis state;
- read-only parser first;
- compare `.TAB` reopened in 4.15 with `.twtable`/`.twrecipe` outcomes;
- add writing only for fields proven stable and necessary.

### R07.1 — DBF viewer and remaining utilities

- paged record viewer, column search, sort and selected-record preview;
- CRC/integrity report with documented scope;
- explicit encoding/accent conversion preview and reversible export;
- DBF-to-DBC only through a reviewed PKWARE DCL Implode encoder;
- deleted-record and code-page policies;
- golden for a selected-record DBF produced by TabWin 4.15.

### R07.2 — DEF/CNV authoring

- structured editor backed by the parsed models, not raw string surgery;
- validation with source-line diagnostics;
- preview classification against an opened dataset;
- deterministic Windows-1252 save;
- templates for common raw, literal and numeric-range definitions;
- never serialize unsupported `X`/new-`N` semantics speculatively.

### R07.3 — modern interoperability

- JSON/Parquet result export;
- GeoJSON/KML map export;
- XML, DBF and documented SDF import adapters;
- optional modern GeoJSON/SHP inputs before low-demand historical map formats;
- retain E00/BNA/BND/MIF/MID/XY/WPT/GPX/MME/SPRING as cataloged adapters,
  implemented according to real demand and fixtures.

## P3 — visualization parity

### R08.0 — chart editor

- title, fonts, legend, colors, background and value labels;
- explicit x/y binding for scatter and bubbles;
- axes, bounds, ticks, zoom/reset and accessible keyboard/touch controls;
- empty chart/composition workflow;
- print for every chart family and deterministic SVG/PNG snapshots;
- 3D retained only as a compatibility presentation if oracle evidence shows a
  still-required exported artifact.

### R08.1 — thematic maps

- manual breakpoints, class labels and individual colors;
- borders, seats, names and values from parsed MAP metadata;
- selectable areas bridged back to filters;
- add/remove local layers and new base maps;
- print plus GeoJSON/KML export;
- visual-regression fixtures for municipality and UF maps.

### R08.2 — geographic analysis

- projection-aware distance column;
- origin-destination table contract;
- flow arrows, origin totals, destination totals and sector charts;
- focused legacy torture cases for missing/unknown geocodes.

## P4 — production robustness

### R09.0 — large files and workers

- move DBC decompression/DBF decoding to a cancellable Web Worker;
- progress events and cancellation across acquisition, decode and tabulation;
- chunked/stream-friendly record processing where dependencies allow it;
- national-file memory benchmarks on desktop and Android;
- explicit file/memory limits and recoverable out-of-memory messaging.

### R09.1 — PWA, mobile and accessibility

- installable PWA and offline shell;
- cached/recent files management;
- responsive dialogs/tables/maps on small screens;
- keyboard-only workflows, focus management and screen-reader labels;
- contrast/reduced-motion checks;
- Playwright interaction tests and screenshot regression at desktop/tablet/mobile.

### R09.2 — release engineering

- CI runs full `npm run check`, G001 and production build;
- lint/format, dependency license and security reporting;
- performance budgets and bundle-size gate;
- proxy health monitoring and rollback instructions;
- privacy, source provenance and compatibility-scope documentation.

## P5 — differential compatibility corpus

Begin after the ordinary functional matrix is substantially closed.

### Corpus shape

- deterministic goldens first;
- seeded, pairwise-selected cases second;
- each human TabWin case targets 2–5 minutes;
- batches of five with exact click instructions;
- every failure seed becomes an immutable regression case;
- reference capture includes XLS/CSV/TAB where available, screenshot, notes and
  hashes.

### Initial batches

1. G002–G006: row×column, sum, raw/CNV selection, zeros, non-classified;
2. G007–G011: subtotals, overlap, grouped frequency, multiple files, top-N;
3. G012–G016: table arithmetic, totals, rename/move/delete, row aggregation;
4. G017–G021: save/reopen `.TAB`, selected DBF, statistics;
5. G022–G026: choropleth classes, map selection, distance and OD flow.

The comparator classifies structural, ordering, label, cell, total,
classification and export-normalization differences. Tolerance remains zero
unless a documented numerical operation requires and justifies another value.

## Practical release cuts

### Public beta

Requires R05.2, R05.3, R09.0 and R09.1 plus the existing G001. This makes the
current useful product reliable on GitHub Pages, Mac and Android.

### Compatibility beta

Requires R06, read-only R07.0 and at least the first three oracle batches.

### Full catalog closure

Requires every matrix row to be **Web**, **Compat**, **Replaced with documented
reason**, or **Deferred with explicit demand/evidence requirement**. A named
legacy topic is never silently omitted, but low-demand historical importers do
not block the useful public beta.

## Immediate execution order

1. R05.2 hardened proxy + Cloudflare deployment;
2. R05.3 acquisition/cache coverage;
3. R09.0 worker/cancellation before adding heavier workflows;
4. R06.0 multi-file tabulation;
5. R06.1 remaining DEF/CNV semantics;
6. R07.0 `.TAB` read-only archaeology;
7. R08 map/chart closure;
8. R09.1 browser/mobile/a11y tests;
9. short differential corpus;
10. remaining authoring and demand-driven legacy adapters.
