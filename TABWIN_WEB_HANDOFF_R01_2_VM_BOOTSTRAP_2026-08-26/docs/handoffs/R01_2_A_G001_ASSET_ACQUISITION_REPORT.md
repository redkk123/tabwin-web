# R01.2-A — G001 asset acquisition and inspection report

**Date:** 2026-08-27  
**Status:** COMPLETE FOR ACQUISITION/INSPECTION; G001 REFERENCE CAPTURE STILL PENDING  
**Compatibility impact:** none claimed; this milestone supplies corpus evidence only

## 1. Scope

R01.2-A was limited to acquiring and inspecting the real inputs needed to move toward the first TabWin 4.15 golden comparison:

- `RDAC2401.dbc`;
- current official `RD2008.DEF`;
- the CNV needed by the selected low-cardinality row dimension;
- source, size, SHA-256, encoding and parser/decoder observations.

The raw assets were kept in an external inspection workspace and were **not** committed. This preserves the project's clean-room/licensing posture while implementation proceeds against exact hashes.

## 2. Baseline before acquisition

The portable handoff initially contained no `docs/handoffs/R01_2_A_G001_ASSET_ACQUISITION_REPORT.md`, no real DBC, no real DEF and no real CNV. It also contained no installed dependencies or Git history.

After installing only the versions pinned in `package.json`:

```text
npm test
22 tests
22 passed
0 failed
TypeScript build passed
```

The Git baseline was imported as commit `8fd41de` and published to the private `origin/main` before compatibility code was changed.

## 3. Sources

### 3.1 DBC fixture

Source repository:

`https://github.com/Precisa-Saude/datasus-dbc`

Source path:

`packages/dbc/test/fixtures/RDAC2401.dbc`

Inspected upstream commit:

`42fef70c61592b5cf15c66d987d04e3d1c83fabe`

The upstream repository includes an Apache-2.0 `LICENSE`. Its e2e test identifies the fixture as real SIH-RD data for Acre, competence 2024-01, obtained from the official DATASUS FTP.

### 3.2 Official SIH auxiliary bundle

Official directory:

`ftp://ftp.datasus.gov.br/dissemin/publicos/SIHSUS/200801_/Auxiliar/`

Directory listing observed:

```text
TAB_SIH.zip
TAB_SIH_199201-199712.zip
TAB_SIH_199801-200307.zip
TAB_SIH_200308-200712.zip
```

The current `TAB_SIH.zip` was selected because G001 uses competence 2024-01.

Bundle inspection:

| Property | Value |
|---|---:|
| ZIP bytes | 6,005,360 |
| ZIP SHA-256 | `714ED980D483C038DC8245BE5C40C39062EBFA55A7F6288AB4A87587EF199874` |
| File entries | 885 |
| Uncompressed bytes | 41,043,904 |
| Entry timestamp for selected DEF/CNV | 2026-08-17 22:07:02 -03:00 |

The bundle did not expose a dedicated license file in the inspected inventory. Therefore official auxiliary assets remain outside Git until redistribution policy is explicitly decided.

## 4. Materialized assets and hashes

| Asset | Bytes | SHA-256 | Source |
|---|---:|---|---|
| `RDAC2401.dbc` | 313,213 | `41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429` | upstream decoder fixture |
| `RD2008.DEF` | 33,581 | `15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652` | official `TAB_SIH.zip` |
| `SEXO.CNV` | 198 | `003E1B250D26B987867B9D0C1D155C42E340C4A62BFFDCD4DB85C7C41E60691E` | official `TAB_SIH.zip` |
| `COMPLEX2.CNV` | 265 | `680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F` | official `TAB_SIH.zip` |
| `CARATEND.CNV` | 389 | `E57C08CD045E6EAB1403013D96C7782C963D17BDDF4864840A964B99155D27F8` | official `TAB_SIH.zip` |
| `TP_FINAN.CNV` | 12,146 | `F6986095B663C4A22B69E027C582B7094C56C40ABAF26A8183206531D9336683` | official `TAB_SIH.zip` |

`RD2008.DEF` is Windows-1252 text. Windows-1252 yields correct Portuguese text (`Variáveis`, `Óbitos`, `Região`, `Município`); CP850 yields visibly corrupted text. The file contains 533 lines.

## 5. DBC decoder inspection

Using the pinned `@precisa-saude/datasus-dbc@2.0.2` public API:

```text
headerSize:            3649
declared recordCount:  4315
recordSize:            702
decoded active records:4315
field count:           113
```

Required candidate fields are present: `SEXO`, `COMPLEX` and `CAR_INT`.

Observed raw distributions:

| Field | Raw value | Count |
|---|---:|---:|
| `SEXO` | `1` | 1,761 |
| `SEXO` | `3` | 2,554 |
| `COMPLEX` | `02` | 4,153 |
| `COMPLEX` | `03` | 162 |
| `CAR_INT` | `01` | 2,092 |
| `CAR_INT` | `02` | 2,223 |

No record-count mismatch or deleted-record discrepancy was observed in this fixture.

## 6. Real CNV parser inspection

The existing strict legacy CNV parser accepts all three low-cardinality candidates without warnings:

| CNV | Categories | Width | Mode | Result |
|---|---:|---:|---|---|
| `SEXO.CNV` | 3 | 1 | short / last-match-wins | parsed, 0 warnings |
| `COMPLEX2.CNV` | 4 | 2 | short / last-match-wins | parsed, 0 warnings |
| `CARATEND.CNV` | 6 | 2 | short / last-match-wins | parsed, 0 warnings |

`COMPLEX2.CNV` places a broad `00-99` fallback before the specific `01`, `02`, `03` rules. The implemented short-code later-rule precedence correctly preserves the intended specific categories.

`TP_FINAN.CNV` begins with `N 101 6 L`. The parser correctly detects this as the unresolved widened `N` layout and does not guess offsets.

## 7. Real DEF corpus findings

Raw first-character inventory:

| Directive | Count |
|---|---:|
| `A` | 1 |
| `C` | 46 |
| `I` | 15 |
| `L` | 194 |
| `S` | 178 |
| `X` | 47 |
| `?` | 1 |

### 7.1 `Sexo` is an `X` record

The real file contains:

```text
line 187: XSexo,SEXO,1,CNV\SEXO.CNV
```

No `LSexo`, `CSexo` or `SSexo` entry exists. Because `X` roles remain undocumented, `Sexo` is not activated by the current parser and must not be used as G001's row by assumption.

### 7.2 Textual third field with `.CNV`

Strict `parseDef` reaches a corpus-driven grammar failure at line 271:

```text
LSubTp FAEC,FAEC_TP,DS_TPFIN,CNV\TP_FINAN.CNV
```

Lines 272-273 repeat the same shape for `C` and `S`. Lines 281-283 also use a textual third field with `CNV\PROCOBS2b.CNV`.

The existing model assumes:

- numeric third field => fixed-position CNV conversion;
- textual third field => related DBF lookup whose resource must end in `.DBF`.

The official corpus proves that this binary distinction is incomplete. The safe implementation response is to preserve a generic unsupported external-lookup node, including the resource path/extension, rather than reinterpret it as an ordinary fixed-position CNV.

### 7.3 Other retained unknown record

Line 4 contains `?\TAB\RD.HLP`, a legacy help reference. It is correctly treated as an unknown/comment-like record rather than executable semantics.

## 8. G001 row decision

The capture protocol permits selecting the simplest CNV-backed dimension actually exposed by the real DEF when `Sexo` is unsuitable.

Selected G001 row:

```text
Label:       Complexidade do Procedimento
Directive:   L
Field:       COMPLEX
Start:       1
Conversion:  CNV\COMPLEX2.CNV
Column:      inactive
Increment:   Frequência
Filters:     none
Zero rows:   not suppressed, if TabWin permits
```

Why this is safer:

- uses the documented `L` role;
- uses an ordinary numeric start position;
- uses a legacy CNV parsed with zero warnings;
- contains only four ordered categories;
- the DBC field is present and fully decoded;
- avoids `X`, related DBF lookup and new-format `N` semantics.

The current Web candidate matrix, **not a golden oracle**, is:

| Row label | Candidate count |
|---|---:|
| Atenção Básica | 0 |
| Média complexidade | 4,153 |
| Alta complexidade | 162 |
| Não se aplica | 0 |

These values must not be copied into `expected/golden-table.json` until the same recipe is captured losslessly in original Windows TabWin 4.15.

## 9. R01.2-A completion statement

R01.2-A is complete because the real DBC, DEF and candidate CNVs were materialized, hashed, decoded/parsed where supported, and every discovered corpus blocker relevant to the next implementation step was recorded.

R01.2-A does **not** mean G001 has passed. Remaining work:

1. preserve non-standard external lookups without guessed execution semantics;
2. add a small DBC ingestion adapter behind the formats boundary;
3. compile and execute the selected real `Complexidade do Procedimento` recipe;
4. serialize a deterministic Web candidate result and provenance;
5. capture the exact reference in Windows TabWin 4.15;
6. compare labels, order, shape and cells with zero tolerance;
7. only then update compatibility status from synthetic to golden.

