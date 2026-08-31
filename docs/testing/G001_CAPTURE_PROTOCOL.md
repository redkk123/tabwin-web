# G001 — first real TabWin 4.15 golden capture protocol

Status: **READY FOR ASSET ACQUISITION / REFERENCE CAPTURE**  
Revision: **R01.1-dev**

## 1. Objective

G001 is the first test allowed to justify a real compatibility statement. It must run the same public DATASUS data, DEF/CNV artifacts and analysis choices in:

1. original TabWin 4.15; and
2. TabWin Web reference engine.

Success requires equality of category labels/order and every table cell. A screenshot alone is not sufficient evidence.

## 2. Candidate source data

Primary fixture:

```text
RDAC2401.dbc
SIH/SUS — AIH Reduzida
UF: Acre
Competence: 2024-01
```

Upstream decoder fixture evidence records:

```text
DBC record count: 4315
DBF record length: 702 bytes
```

The file exists in the public `@precisa-saude/datasus-dbc` test corpus and was originally obtained from the official DATASUS FTP.

## 3. Required golden bundle

Do not start calling G001 complete until the following directory can be populated:

```text
fixtures/golden/G001/
├── README.md
├── manifest.json
├── source/
│   └── RDAC2401.dbc
├── def/
│   └── RD2008.DEF
├── cnv/
│   └── <only CNVs required by the selected analysis>
├── reference-tabwin415/
│   ├── result.csv          # or lossless equivalent export
│   ├── log.txt             # exact TabWin log if available
│   ├── recipe.txt          # human-readable settings
│   └── screenshot.png      # optional visual evidence
└── expected/
    └── golden-table.json   # normalized machine-readable oracle
```

Every file included in `manifest.json` must have SHA-256 and byte size.

## 4. First analysis choice

R01.2-A inspection of the real `RD2008.DEF` found that `Sexo` is exposed only
through the unresolved `X` directive (`XSexo,SEXO,1,CNV\\SEXO.CNV`). It is
therefore not safe to assign a row role to `Sexo` by assumption.

Selected G001 target:

```text
Row:       Complexidade do Procedimento
DEF:       LComplexidade do Procedimento,COMPLEX,1,CNV\COMPLEX2.CNV
Column:    Não ativa
Increment: Frequência
Selections: none
Files:     RDAC2401.dbc only
Zero rows: DO NOT suppress for the first capture if TabWin permits it
```

Why this is preferred:

- small output;
- validates DBC decode;
- validates DEF discovery;
- validates CNV conversion;
- validates category ordering;
- validates ordinary frequency;
- minimizes unrelated semantics.

This is the simplest low-cardinality ordinary `L` option confirmed in both the
real DEF and DBC schema without requiring `X`, related DBF lookup or new-format
`N` semantics. Full acquisition evidence and hashes are recorded in
o relatório de aquisição de 27/08/2026 (no histórico do git).

## 5. Reference capture discipline

On the Windows machine running original TabWin 4.15:

1. isolate a clean project directory;
2. copy the exact TabWin 4.15 binary distribution being used;
3. copy G001 data and auxiliary files;
4. record SHA-256 of `TabWin415.exe`/actual executable and all fixture artifacts;
5. open the exact `RD2008.DEF`;
6. select only the G001 source file;
7. configure row/column/increment/selections exactly as this protocol states;
8. record the state of zero suppression and non-classified handling;
9. execute;
10. preserve the TabWin log;
11. export the table losslessly;
12. optionally save the `.TAB` state as additional archaeology material;
13. do not manually reorder or edit rows in Excel before normalization.

## 6. Normalized oracle format

`expected/golden-table.json` follows `GoldenTableV1`:

```json
{
  "schema": "tabwin-web.golden-table",
  "version": 1,
  "id": "G001",
  "source": {
    "referenceEngine": "TabWin 4.15"
  },
  "rows": [
    { "label": "..." }
  ],
  "columns": [
    { "label": "Valor" }
  ],
  "cells": [
    [0]
  ]
}
```

The normalized oracle is derivative test data. The original export/log remains alongside it so normalization can be audited.

## 7. Pass criteria

Default G001 comparison tolerance is **zero**.

PASS requires:

- same number of rows;
- same row labels;
- same row order;
- same number of columns;
- same column labels/order;
- exact cell equality;
- no unexplained records skipped by the Web ingestion path.

If numeric increment tests later require decimal tolerance, they become separate golden cases rather than weakening G001.

## 8. Failure classification

Every failure must be classified before code is changed:

- `INGEST`: DBC/DBF decoding or deleted-record behavior;
- `DEF`: wrong field/start position/option semantics;
- `CNV`: classification/order/overlap/subtotal semantics;
- `FILTER`: selection behavior;
- `MEASURE`: frequency/sum/G weighting;
- `ORDER`: materialization/sorting;
- `NONCLASSIFIED`: uncategorized-value policy;
- `EXPORT/NORMALIZATION`: oracle conversion error;
- `UNKNOWN`: requires archaeology before patching.

Do not 'fix' a golden mismatch by changing multiple semantic layers at once.

## 9. Asset acquisition

Known official SIH paths:

```text
ftp://ftp.datasus.gov.br/dissemin/publicos/SIHSUS/200801_/Dados/
ftp://ftp.datasus.gov.br/dissemin/publicos/SIHSUS/200801_/Auxiliar/
```

Current runtime cannot directly fetch FTP/GitHub binary assets. That is an environment constraint, not a project architecture blocker.

## 10. G001 definition of done

- [ ] DBC materialized
- [ ] RD2008.DEF materialized
- [ ] required CNVs materialized
- [ ] all artifact hashes recorded
- [ ] Web parser accepts real DEF
- [ ] Web parser accepts required CNVs
- [ ] original TabWin 4.15 reference captured
- [ ] normalized golden JSON reviewed
- [ ] Web DBC ingestion implemented
- [ ] comparison executes in CI
- [ ] zero unexplained diff
- [ ] compatibility matrix updated from `synthetic` to `golden` for covered semantics
