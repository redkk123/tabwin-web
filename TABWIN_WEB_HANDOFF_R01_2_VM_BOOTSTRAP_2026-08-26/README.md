# TabWin Web — working title

> **Status:** R01.1-dev — DEF-aware semantic compatibility kernel; first real golden capture pending.
>
> Independent, non-official modernization/reimplementation effort. It is not affiliated with or endorsed by DATASUS or the Brazilian Ministry of Health.

The project aims to reproduce the analytically important behavior of TabWin 4.15 in a modern, auditable, local-first web application while preserving legacy workflows that matter to SUS users: DBC/DBF ingestion, DEF/CNV semantics, reproducible tabulations, saved analyses, maps, exports and eventually compatibility with legacy `.TAB` workflows.

## Start here

The canonical external memory is [`CHECKPOINT_MASTER.md`](./CHECKPOINT_MASTER.md). Future work should update it instead of leaving project state only in chat.

Immutable/working snapshots currently include:

- `CHECKPOINT_MASTER_R00.md` — initial architecture baseline;
- `CHECKPOINT_MASTER.md` — current R01.1-dev state.

## What already runs

R01 contains a dependency-light TypeScript semantic kernel with automated tests:

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

Run:

```bash
npm test
```

Current checkpoint: **22 passing tests**.

## Repository layout

```text
apps/web/              production web app shell (next phases)
packages/core/         tabulation semantics, QueryPlan, executor, recipes
packages/formats/      legacy format adapters (.CNV + DEF; DBC/TAB next)
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

For the complete current project memory and roadmap, read `CHECKPOINT_MASTER.md` first. Cloud-credit and AI-worker policy is documented in `docs/infrastructure/CLOUD_CREDITS_STRATEGY.md`.
