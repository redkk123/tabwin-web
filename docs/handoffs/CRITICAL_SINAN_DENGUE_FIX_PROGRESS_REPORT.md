# Critical SINAN / Dengue correction progress

**Date:** 2026-08-28  
**Status:** PARTIAL — CATALOG FIXED; LARGE-FILE EXECUTION STILL BLOCKED

## STATUS

Partial. Two user-reported defects are corrected in the working tree. Opening
the 2025 national Dengue DBC remains blocked by the current materialized-memory
architecture and requires the planned chunked execution milestone.

## EVIDENCE

The official DATASUS Transferência de Arquivos page was inspected directly on
2026-08-28. Selecting `SINAN`, modality `Dados`, exposed 58 type codes. The app
previously contained only ten representative entries.

The reported `DENGBR25.dbc` declares 535,688,091 bytes of decompressed record
content, approximately 511 MiB. The published dependency rejects output above
500 MiB. The audited local worker intentionally caps fully materialized DBFs at
256 MiB because the compressed input, decoded bytes and JavaScript records
currently coexist in memory.

## WHAT CHANGED

- Replaced the ten-item SINAN subset with the 58 codes observed in the official
  selector, including Chagas, the HIV/AIDS families, occupational diseases,
  the three syphilis families, toxoplasmosis, varicella and the existing high-
  use families.
- Added a regression that pins the observation date, count, uniqueness,
  national coverage and representative codes.
- Added a shared decoded-size preflight guard.
- Large official files now produce a capacity explanation with the expected and
  safe sizes, explicitly state that the DBC was not classified as corrupt, and
  preserve the previous dataset.
- The current working tree already awaits `loadFile` directly from official
  acquisition and admits provenance only after successful decoding. This fixes
  the older deployed build's false “aberto” state after `loadFiles` swallowed a
  decode failure.
- Added an isolated PKWARE DCL decoder that emits bounded copies of its 4 KiB
  sliding window instead of allocating an output-sized byte array.
- The streaming decoder has an explicit policy for the optional final DBF EOF
  byte; all other declared-size mismatches remain errors.

## VALIDATION

- `npm run check`: 112/112 tests passed.
- Semantic TypeScript build passed.
- Web typecheck passed.
- Vite production build passed.
- G001 and all golden artifacts remain unchanged.
- On the real `RDAC2401.dbc`, the reference materialized decoder and the new
  streaming decoder produced the identical DBF SHA-256
  `26f1b1140659f0fad5aa4c1a135094cb639eaf2f8b6bee42ff21a21e3a87881d`.
  The streaming path emitted 3,029,130 bytes in 740 chunks, with a maximum
  chunk size of 4,096 bytes.

## KNOWN LIMITATIONS

- `DENGBR25.dbc` still cannot be analyzed in the browser.
- Raising the cap is not an acceptable mobile fix: roughly 511 MiB of decoded
  bytes plus the compressed input and materialized JavaScript records can exceed
  a mobile tab's practical memory budget.
- The installed DBC library has no newer release than 2.0.2 and its advertised
  record iterator still materializes the full DBF internally.
- The 58-type list is an evidence-dated catalog snapshot. Future official
  additions require a new observed snapshot or a safe dynamic registry update.
- SINAN DEF/CNV and TabNet-like derived dimensions remain separate catalog work;
  expanding disease types does not invent analytical metadata.
- The public GitHub Pages release still points to the older committed build;
  no deploy was performed during this correction.

## CLASSIFICATION

### KEEP

- complete observed SINAN type snapshot;
- truthful large-file capacity diagnostic;
- source admission only after successful decoding;
- strict memory guard on the materialized path.

### FIX BEFORE CLAIMING DENGUE SUPPORT

- bounded record-chunk persistence;
- worker-side aggregation or a columnar engine that does not return every
  record object to the main thread;
- cancellation, progress and cleanup for partial large-file workspaces.

### DEFER

- automatic SINAN concept and DEF/CNV mappings until authoritative evidence is
  captured per family;
- automatic interpretation of historical Dengue splits not represented by the
  current Transferência de Arquivos code list.

## NEXT

Build the next layer that consumes complete DBF records across arbitrary chunk
boundaries and writes bounded record batches to a local workspace. It must not
accumulate every record object in the worker or return the full dataset to the
main thread. Only then should the streaming path be connected to large DBCs.
