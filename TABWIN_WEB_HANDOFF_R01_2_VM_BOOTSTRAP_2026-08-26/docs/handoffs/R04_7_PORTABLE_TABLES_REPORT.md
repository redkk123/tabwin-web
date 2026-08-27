# R04.7 — Portable result tables

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — MODERN `.twtable`, LEGACY `.TAB` PENDING

## 1. Outcome

Users can save the current table as `.twtable`, send it to another device and
open it without the original DBC, DEF or CNV files. The reopened result remains
usable for table editing, Undo/Restore, charts, maps loaded afterward,
statistics and CSV/XML/XLSX/image exports.

This complements rather than replaces `.twrecipe`:

- `.twrecipe` stores instructions and fingerprints, then re-executes against a
  compatible source dataset;
- `.twtable` stores the base result plus the ordered operations needed to
  reconstruct the visible table without record-level data.

## 2. File contract

Version 1 stores:

- schema marker and version;
- title, row label and explicit creation time;
- optional source name, size and SHA-256 fingerprint;
- compiled QueryPlan for provenance;
- base `TabulationResult`;
- ordered immutable `TableOperation` list;
- sort, decimals and key-visibility presentation settings.

Serialization uses the existing recursively sorted `stableJson` contract.
Meaningful array order, including rows, columns and operations, is preserved.

## 3. Validation boundary

Opening a file validates before rendering:

- schema/version, timestamp and required labels;
- compilable QueryPlan;
- unique row and column keys;
- exact matrix dimensions;
- finite numeric cells only;
- non-negative and internally consistent record counts;
- known, well-formed table operations;
- bounded presentation policies.

The parser never executes document text. Operations are replayed only through
the same typed table-operation layer used by the live workbench.

## 4. Browser behavior

Opening a `.twtable` enters an explicit result-only state. Source tabulation
controls and recipe saving are disabled because record-level data is absent;
result exports, calculations and table saving remain enabled. The Audit view
retains the source fingerprint, QueryPlan, operation history and result shape.

Browser verification used a two-row table with descending frequency order. It
restored `Categoria de teste`, displayed values `12` and `8`, then applied a
factor operation named `Dobro`, producing `24` from `12` without any DBC.

## 5. Verification

`npm run check` passed:

- 69 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

Three new tests cover deterministic round-trip serialization, invalid matrix
shape, non-finite cells, invalid plans, invalid operations and out-of-range
presentation settings.

## 6. Compatibility boundary

`.twtable` is a documented modern format. It is not named `.TAB` and does not
pretend to serialize undocumented TabWin 4.15 internal state. Legacy `.TAB`
archaeology remains a separate compatibility adapter and requires original
save/reopen oracle artifacts before implementation claims.
