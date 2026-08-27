# R04.6 — Local XLSX export

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — MODERN EXPORT, LEGACY EXPORT FORMATS PENDING

## 1. Outcome

TabWin Web can now download the current analytical result as a real `.xlsx`
workbook without uploading data or calling a conversion service. The exporter
is a small deterministic OOXML adapter in `packages/export`; it does not alter
`AnalysisSpec`, `QueryPlan`, executor behavior or `TabulationResult`.

## 2. Workbook structure

The generated workbook contains:

- `Tabela`: the row label followed by every numeric result column and every
  materialized result row;
- `Auditoria`: source name, generation timestamp, records seen and accepted,
  row/column counts and executor warnings.

Result values are stored as numeric cells rather than locale-formatted text.
Text and provenance are XML-escaped. The table header uses bold styling, the
first row remains frozen during scrolling and worksheet auto-filters are set.

## 3. Determinism and safety

For the same result and explicit export context, generation is byte-identical.
The ZIP uses a fixed valid DOS timestamp, and file order is stable. Any
non-finite numeric value fails explicitly instead of emitting a corrupt or
ambiguous spreadsheet. The implementation reuses pinned `fflate` 0.8.2 and
adds no office-suite or server dependency.

## 4. Verification

`npm run check` passed:

- 66 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

The new test generates the workbook twice, requires byte equality, unzips it
and verifies both worksheet payloads, workbook relationships, numeric cell
encoding and escaped audit metadata. The local browser UI exposes an `XLSX`
button beside CSV and XML; it is enabled only when a result exists.

## 5. Compatibility boundary

XLSX is a modern interoperable export, not a claim about TabWin 4.15's legacy
BIFF/XLS, DBF or `.TAB` serialization. Those formats remain separate adapters
and must be validated against original artifacts. Spreadsheet formulas are not
emitted: calculated columns are exported as their audited result values so the
workbook is stable and portable.
