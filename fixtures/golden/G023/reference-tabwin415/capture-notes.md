# G023 TabWin 4.15 reference capture

Semantic under test: **`.TAB` save format**.

The user saved `g002.tab` from the same TabWin 4.15 session that produced the
G002 capture, following `docs/testing/G006_G023_CAPTURE_PROTOCOL.md` §6 — the
table was generated, then saved a second time in `.TAB` format alongside the
usual `result.xls`. Nothing was edited afterwards.

## What this artifact settles

**The format is plain text, not a binary container.** That is the finding, and
it corrects a working assumption rather than confirming one. `legacy-tab.ts`
was written as bounded binary reconnaissance precisely because no real file
existed to check against; it never claimed to replay a panel, and it listed
`plain-text` among the container hints it could report. This capture resolves
the question for this save path:

- 788 bytes, SHA-256 `D2456989E60A2A9E114A9AA40463646D5F053CB8EC6A3208B9799917DDAFCAF5`;
- Windows-1252, CRLF, **no BOM**;
- opens on the literal line `NEW`;
- `Titulo2=` in a preamble before any section;
- `[Opções]` carrying `DEF`, `PATH`, `Linha`, `Coluna`, `Incremento`,
  `Suprime_Linhas_Zeradas`, `Suprime_Colunas_Zeradas`, `Não_Classificados`;
- `[Arquivos]` mixing bare file names (`RDAC2401.dbc`) with
  `Registros_Processados=` and `Tempo_Decorrido=`;
- then a `;`-separated, `"`-quoted result matrix carrying TabWin's own Total
  row and Total column.

## Why this case is the right one to decode against

The `.TAB` was saved from the G002 run, whose result is already known cell by
cell from an independent export path (the BIFF `result.xls`). So the parser is
not being validated against its own reading of an unknown file — it is checked
against a table this project already holds a separate, earlier golden for.

The two agree exactly: 4 rows × 6 columns, cells
`[[0,0,0,0,0,0],[1968,2185,0,0,0,0],[124,38,0,0,0,0],[0,0,0,0,0,0]]`, and
TabWin's own column totals `[2092,2223,0,0,0,0]` — the same totals recorded in
G002's capture notes. Grand total 4315, matching `Registros_Processados`.

## What remains unknown, and is not guessed

- **`NEW`** is recorded verbatim as an opening marker. One sample cannot
  distinguish a version token from a fixed literal, so it is not decoded.
- **`Não_Classificados=0`** is a code. Its mapping onto this engine's
  unclassified policies is not evidenced by one file, so the parser surfaces
  the raw value and translates nothing.
- **`Titulo2`** implies a `Titulo1` that this capture does not contain. The
  parser reads the preamble generically instead of hardcoding either key.
- **Decimal formatting** is unexercised — every cell here is an integer. The
  reader accepts a pt-BR comma but refuses to strip dots without one, so a
  future `1.5` cannot be silently read as `15`.
- **Writing `.TAB`** stays out of scope. Per the project rule, only fields
  proven stable across several real artifacts may ever be written back, and
  one artifact is not several.

## Comparison result

Parsed with `parseTabFile` and compared against G002's committed golden table
with absolute tolerance 0:
**PASS** — row labels true, column labels true, shape true, 0 differing cell(s),
0 parser warnings.
