# R05.0 — DBC-to-DBF expansion

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — EXPANSION ONLY, DBC ENCODING PENDING

## 1. Outcome

After opening a `.dbc` or `.dbf`, the browser offers **Extrair DBF do arquivo
aberto**. For DBC sources it performs the DATASUS PKWARE DCL expansion and
downloads the complete standard DBF. For DBF sources it validates the header
and downloads an isolated copy.

The operation is local. It does not upload the source, contact a conversion
service, filter records or pass the data through analytical aggregation.

## 2. Adapter contract

`packages/export/src/dbf-source.ts` accepts only `.dbc` and `.dbf` sources and
returns:

- complete DBF bytes;
- a path-free `.dbf` filename;
- the reparsed xBase header;
- whether DCL decompression occurred.

The header is parsed after expansion, so malformed output fails before a file
is offered. Existing DBF inputs are copied to prevent the caller from mutating
the loaded source buffer.

## 3. Memory policy

The application retains the browser `File`, not another permanent copy of its
bytes. Expansion rereads and decompresses on demand. This avoids keeping both
the compressed DBC and full DBF alongside all decoded records during ordinary
analysis, at the cost of repeating decompression only when the user requests
the DBF.

## 4. Verification

`npm run check` passed:

- 71 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

Pure tests build a minimal valid dBase III file, verify record/field metadata,
copy isolation, filename normalization and rejection of unrelated extensions.

The browser test used the real G001 source:

| Item | Observed |
| --- | --- |
| Input | `RDAC2401.dbc` |
| Compressed size | 313,213 bytes |
| Header fields | 113 |
| Declared records | 4,315 |
| Download name | `RDAC2401.dbf` |

## 5. Compatibility boundary

This covers TabWin's DBC expansion outcome using a clean-room decoder already
pinned by the project. It does not claim equivalence for TabWin's CRC dialog,
deleted-record behavior or character-conversion utilities.

The reverse operation, DBF-to-DBC compression, needs a reviewed PKWARE DCL
Implode encoder. The current dependency intentionally provides decompression
only, so no substitute archive format will be mislabeled as DBC.
