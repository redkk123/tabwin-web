# TabWin Web

> **Status:** R03.2 — functional browser workbench; first real golden capture pending.
>
> Independent, non-official modernization/reimplementation effort. It is not affiliated with or endorsed by DATASUS or the Brazilian Ministry of Health.

The project aims to reproduce the analytically important behavior of TabWin 4.15 in a modern, auditable, local-first web application while preserving legacy workflows that matter to SUS users: DBC/DBF ingestion, DEF/CNV semantics, reproducible tabulations, saved analyses, maps, exports and eventually compatibility with legacy `.TAB` workflows.

## Start here

The canonical external memory is [`CHECKPOINT_MASTER.md`](./CHECKPOINT_MASTER.md). Future work should update it instead of leaving project state only in chat.

Immutable/working snapshots currently include:

- `CHECKPOINT_MASTER_R00.md` — initial architecture baseline;
- `CHECKPOINT_MASTER.md` — current R01.1-dev state.

## What already runs

The current browser application and TypeScript packages provide:

- legacy fixed-column `.CNV` parser;
- documented `.DEF` parser for A/S/L/C/Q/D/T/I/G/R;
- DEF start-position slicing for rows and selections;
- DEF grouped-frequency (`G`) semantics;
- DEF-to-QueryPlan bridge for CNV-backed options;
- machine-readable golden comparator;
- source-order-sensitive conversion matching;
- exact codes and ranges;
- numeric `F/FAIXAS` ranges;
- row subtotals;
- QueryPlan validation;
- frequency/count and numeric sum tabulation;
- rows, columns and filters;
- zero-row suppression;
- deterministic analysis recipes and run-manifest models.
- real browser DBC/DBF ingestion;
- official DATASUS catalog/acquisition adapter (server-verified; static-host CORS proxy pending);
- CSV/XML, chart PNG/SVG and map PNG export;
- eight chart families;
- legacy `.MAP` parsing and interactive thematic maps;
- descriptive statistics, Pearson correlation, simple regression and histograms.

Run:

```bash
npm test
```

Current checkpoint: **44 passing tests**, browser typecheck and production build.

## Repository layout

```text
apps/web/              production browser workbench
apps/datasus-proxy/    allowlisted optional proxy for static public hosting
packages/acquisition/  official source discovery/request contracts
packages/analysis/     modern statistical calculations
packages/core/         tabulation semantics, QueryPlan, executor, recipes
packages/formats/      legacy format adapters (.CNV, .DEF and .MAP)
packages/export/       deterministic exports
packages/visualization/ chart/map presentation models
tests/                 semantic compatibility tests
docs/architecture/     ADRs
docs/testing/          golden-equivalence methodology
docs/product/          roadmap/product behavior
docs/security/         local-first security model
docs/government/       institutional/federal UI research
docs/legacy/           TabWin 4.15 feature archaeology
docs/research/         fixtures and external investigations
prototype/             early dependency-free interface prototype
.github/workflows/     CI
```

## Golden rule

Every capability should be classified as:

1. **COMPAT** — needed to reproduce an existing TabWin workflow/result;
2. **UX** — modernizes how an existing workflow is performed;
3. **INNOVATION** — adds capability without changing compatibility semantics.

No generic “TabWin compatible” claim should be made until the corresponding real golden cases pass.

## Handoff / current plan

For the complete current project memory and roadmap, read `CHECKPOINT_MASTER.md`
first. The compatibility claim still depends on G001 and subsequent exact
Windows TabWin 4.15 golden captures.
