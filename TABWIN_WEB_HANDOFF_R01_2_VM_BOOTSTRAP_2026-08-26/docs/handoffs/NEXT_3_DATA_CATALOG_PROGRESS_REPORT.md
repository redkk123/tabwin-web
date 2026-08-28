# NEXT-3 — Data Catalog / TabNet-like UX progress

**Date:** 2026-08-28  
**Status:** PARTIAL — NAVIGABLE CATALOG AND PORTABLE SOURCE MANIFEST

## 1. Outcome

Municipality tabulations no longer need to present known IBGE/TabWin geographic
keys as bare numbers. When the row field is municipality-like, the application
loads the bundled official-compatible TabWin municipality map and builds a
local code-to-name index from its 5,570 objects.

The table displays labels such as `Ariquemes (110002)`. The original analytical
row key and label remain unchanged in `TabulationResult`, recipes, audit data
and semantic exports. This keeps map association and future golden comparison
independent from the presentation aid.

The acquisition catalog now also exposes a typed capability model for every
system/file-type pair. It states annual versus monthly periodicity, national
versus UF coverage, multi-period/multi-UF support, and whether auxiliary
resolution is backed by a verified automatic rule or requires explicit manual
selection. It deliberately marks file availability as verified only at query
time.

The catalog dialog renders those capabilities and continuously reports how
many year/month/UF combinations the current multi-selection will query.

After the official batch returns, the application now builds an evidence-only
availability manifest before deduplicating files. Every requested tuple is
classified as `available` or `missing`, so overlapping results cannot erase the
fact that a particular period/UF was queried. The dialog reports the found
ratio and lists missing combinations (bounded in the visible summary).

That observed result can now be downloaded as a versioned `.twmanifest`. It
contains the catalog identity, timestamp, requested tuples and official source
addresses, but never embeds DBC/DBF records. Serialization is deterministic;
loading validation recalculates summary counts rather than trusting them.

The browser can also load a previous manifest and compare it with the current
official response. It reports added, removed and unchanged files plus tuples
that changed between available and missing. The comparison is bounded to a
5 MB local input and remains diagnostic: it never downloads, deletes or merges
anything automatically and never guesses why the official response changed.

After review, newly observed files are displayed as explicit checkboxes. The
user may download only the checked files. This starts a new dataset; subsequent
files pass through the existing exact schema compatibility gate. A mismatch
stops the batch and preserves the compatible partial result instead of silently
coercing or mixing schemas.

## 2. Safety boundaries

- Name enrichment runs only when the compiled row field contains `MUNIC`.
- A name is substituted only when the original row label is empty or equal to
  its raw key.
- Unknown keys, including `0`, remain untouched; the application does not
  invent “unknown”, “missing” or other legacy meaning without DEF/CNV evidence.
- Municipality names become searchable in the table's modern Localizar field.
- Portable municipality tables also load the local name index when opened.
- No network lookup or third-party geocoding service is required.
- A year shown by the UI is a query candidate, not a claim that the file exists.
- Request-count feedback is derived from the same stable expansion used by the
  actual acquisition request.
- “Missing” means absent from that official response; the UI explicitly avoids
  claiming that the source never existed.
- Manifest parsing accepts only known system/type pairs, consistent entry
  status and exact `ftp.datasus.gov.br` source addresses.

## 3. Verification

The committed `br_municip.MAP` parses to exactly 5,570 objects. A regression
test verifies two code/name pairs, including accented text:

- `110002` → `Ariquemes`;
- `500020` → `Água Clara`.

The analytical result itself is not rewritten. G001 and all golden artifacts
remain untouched.

The typed catalog regression verifies SIH-RD monthly/UF behavior, SIM-DO
annual national-or-UF behavior, automatic versus manual auxiliary policy and
explicit rejection of unknown system/type pairs.

Another regression verifies a two-period official-query result with one
available and one missing tuple, including preserved filenames/addresses and
aggregate counts.

Three additional regressions cover deterministic manifest round trips, summary
recalculation after tampering and rejection of a non-official FTP address.
The third verifies file and query-availability deltas and rejects comparison
across different catalog families. The complete gate passes with 105/105
tests, web typecheck and production build.

## 4. Classification

### KEEP

- presentation-only municipality code/name bridge;
- automatic local loading for municipality row dimensions;
- search over the enriched display name;
- regression against the bundled real MAP file.
- typed, query-time-verified catalog capabilities;
- visible multi-period/multi-UF request-count feedback.
- evidence-only availability manifest with explicit missing tuples.
- portable, versioned source-query manifest without microdata.
- bounded, evidence-only comparison against an earlier manifest.
- reviewed incremental acquisition with schema-gated combination.

### FIX BEFORE INTEGRATION

- enrichment was explicitly scoped to municipality fields so an unrelated
  six-digit analytical category cannot be mistaken for a municipality merely
  because a map was previously opened.

### DEFER

- persistent longitudinal workspace and resumable research-scale acquisition;
- richer descriptor registry for dimensions, measures and filters;
- state, region, health-region and establishment label registries;
- catalog-driven automatic DEF/CNV resolution outside verified SIH-RD;
- interpretation of raw sentinel codes such as `0` without source metadata.

## 5. Next safe step

Begin NEXT-4 with a versioned `ResearchRequest` and deterministic
`ResearchPlan`. Planning may enumerate official catalog queries, but must not
infer epidemiological meaning or invent byte/file estimates before observation.
