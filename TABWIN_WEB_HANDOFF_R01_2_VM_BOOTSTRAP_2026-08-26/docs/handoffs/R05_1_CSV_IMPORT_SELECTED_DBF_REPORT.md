# R05.1 — CSV import and selected-record DBF

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — WEB WORKFLOW, TABWIN DIALOG DEFAULTS GOLDEN-PENDING

## 1. Outcome

The workbench now opens CSV or TSV as a record source and can save the exact
record set accepted by the current compiled analysis as a standard DBF. Both
operations run locally and preserve the architectural pipeline.

## 2. Delimited-source parser

The parser supports:

- comma, semicolon and tab delimiters;
- UTF-8 BOM and browser-side Windows-1252 fallback;
- quoted delimiters, escaped quotes and embedded line breaks;
- CRLF, LF and CR line endings;
- decimal comma for semicolon input;
- explicit safety limits for rows, columns and cell size;
- strict errors for duplicate headers, inconsistent rows, ambiguous delimiter,
  unclosed quotes or characters after a closing quote.

Numeric inference is conservative. A column becomes numeric only when every
non-empty value is unambiguously numeric. Identifiers with leading zeros remain
text. CSV sources compile with compatibility profile `modern`; they are not
misrepresented as TabWin 4.15 DBC behavior.

## 3. Shared record acceptance

`resolvePlanRecord` is now the single acceptance boundary for both tabulation
and record-level export. It applies:

- every raw, CNV-backed or numeric-range filter;
- include/exclude policy;
- start-position slicing;
- row and column dimension classification;
- explicit unclassified omission/discrimination.

The DBF export independently counts resolved records and requires equality with
the current result's `recordsAccepted`. Any divergence stops the download.

## 4. DBF writer

The local writer emits standard xBase headers, descriptors, active record
markers and EOF marker. Supported field types are character, numeric, float,
date, logical and 32-bit little-endian integer. Text is encoded as Windows-1252
with deterministic replacement for unmappable characters.

Long or non-xBase field names are converted to unique uppercase ten-character
descriptors. Width overflow, invalid numeric/date/integer values, invalid field
descriptors and format size limits fail explicitly rather than truncating data.

## 5. Verification

`npm run check` passed:

- 77 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

The round-trip suite writes DBF bytes and rereads them through
`@precisa-saude/datasus-dbc`. A combined test imports CSV, compiles two filters,
selects the record through `resolvePlanRecord`, writes DBF and decodes the same
record back.

Browser evidence:

| Step | Observed |
| --- | --- |
| Source | semicolon CSV, 3 records |
| Automatic row | `UF` |
| Profile | `modern` in Audit |
| Selection | `UF = AC` |
| Accepted/table value | 2 / 2 |
| Output | `*-selecionados.dbf`, 2 records |

## 6. Compatibility boundary

The useful save-selected-records outcome is implemented, but field-name
normalization, memo fields, deleted-record inclusion, code-page defaults and
dialog choices from TabWin 4.15 still need a focused DBF oracle case. No legacy
expected artifact was created or modified in this milestone.
