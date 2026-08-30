# NEXT-4 — Research Mode progress

**Date:** 2026-08-28  
**Status:** PARTIAL — VERSIONED REQUEST AND DETERMINISTIC PLAN FOUNDATION

## STATUS

Partial. The first manifest-first planning slice is implemented and validated.

## WHAT CHANGED

- Added versioned `ResearchRequestV1` and `ResearchPlanV1` models.
- A request can explicitly combine multiple known DATASUS system/file-type
  families, periods, months, UFs, desired field names and user-authored concept
  terms.
- Planning expands each selection through the same official catalog-query
  rules used by ordinary acquisition.
- Dataset duplicates, unknown catalog pairs and geography/coverage mismatches
  are rejected.
- Plans are deterministic and capped at 10,000 official queries.
- Query count is exact. File count and bytes remain `null` until the catalog is
  actually observed; the planner does not fabricate estimates.
- Concept terms such as `B57` are preserved as user input only. No diagnosis,
  field, CNV or filter meaning is inferred at this layer.

## VALIDATION

- `npm run check`: 107/107 tests passed.
- Semantic TypeScript build passed.
- Web typecheck passed.
- Vite production build passed.
- A two-system fixture expands SIH-RD monthly/UF queries plus SIM-DO annual/BR
  queries in stable order.
- Negative tests cover incompatible geography, duplicate datasets and unknown
  catalogs.
- G001 and all golden artifacts remain unchanged.

## KNOWN LIMITATIONS

- No Research Mode form is exposed in the browser yet.
- Plans do not execute catalog requests yet.
- File and byte estimates require observed official results.
- No retry/resume workspace exists yet.
- Desired fields and concept terms have no automatic semantic resolver.
- Schema drift remains enforced only when actual sources are opened/combined.

## CLASSIFICATION

### KEEP

- versioned request and deterministic plan;
- explicit catalog and geography validation;
- bounded query expansion;
- unknown estimates represented as unknown;
- concept terms retained without silent epidemiological interpretation.

### FIX BEFORE INTEGRATION

- none currently known in this isolated planning slice.

### DEFER

- authoritative concept registry;
- persistent longitudinal workspace;
- bulk retry/resume scheduler;
- columnar cache and scale work;
- automatic desired-field resolution across schema families.

## NEXT

Resolve every planned query through the official catalog into one observed,
versioned manifest per dataset family. Preserve missing tuples and deduplicate
physical files without losing query-level provenance. Only after observation
may the workspace report actual file counts; byte estimates remain unavailable
unless supported by source evidence.
