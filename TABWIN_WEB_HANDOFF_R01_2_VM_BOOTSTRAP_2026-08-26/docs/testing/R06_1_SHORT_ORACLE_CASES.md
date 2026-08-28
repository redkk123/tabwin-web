# R06.1 short TabWin 4.15 oracle cases

**Status:** READY FOR HUMAN CAPTURE — NOT YET GOLDEN  
**Target duration:** 2–5 minutes per case

These cases close only the two R06.1 semantics that cannot safely be inferred
from documentation. They use the already verified G001 source set:

- `RD2008.DEF`;
- `RDAC2401.dbc`;
- the exact CNV files referenced by that DEF.

Do not rename a capture as a golden until its settings, output and hashes are
recorded. Do not edit a reference export to make the web candidate pass.

## Case R06.1-O1 — five largest municipality categories

1. Open `RD2008.DEF` in TabWin 4.15.
2. Select only `RDAC2401.dbc`.
3. Select row **Município de Residência**.
4. Select no column.
5. Select the ordinary frequency increment.
6. Leave selections empty.
7. Record the initial row-zero, column-zero and unclassified settings in a
   screenshot; do not assume their defaults from this document.
8. Activate **N maiores categorias** with `N = 5` using the exact control exposed
   by the installed TabWin.
9. Run the tabulation.
10. Save/export the result as XLS and capture the complete result window.

Record in `notes.md`:

- the exact label and location of the N-largest control;
- whether Total is present and whether it covers all categories or only the five;
- row labels, keys and order;
- behavior if the fifth place is tied;
- whether zero suppression occurs before or after ranking;
- every setting that was checked by default.

If the dataset has no tie at fifth place, do not invent a tie rule. Mark it as a
separate fixture requirement.

## Case R06.1-O2 — two simultaneous increments

1. Reset/reopen `RD2008.DEF` and select only `RDAC2401.dbc`.
2. Select row **Complexidade do Procedimento**.
3. Select no column and no selection filter.
4. In the increment control, select exactly **Valor Total** (`VAL_TOT`) and
   **Permanência** (`DIAS_PERM`) simultaneously. Record how multi-selection is
   performed. If the UI does not permit it, stop and record that fact.
5. Record zero-suppression and unclassified settings.
6. Run the tabulation.
7. Save/export the result as XLS and capture the settings and complete result.

Record in `notes.md`:

- whether frequency is also emitted automatically;
- exact column labels and order;
- numeric formatting/decimal policy;
- Total-row behavior for both increments;
- whether the increments become columns, separate tables or another structure.

## Capture layout

Place the untouched files under:

```text
fixtures/oracle-pending/R06_1_O1/reference-tabwin415/
fixtures/oracle-pending/R06_1_O2/reference-tabwin415/
```

Each directory should contain:

```text
result.xls
settings.png
result.png
notes.md
```

An optional original `.TAB` is useful but must remain an opaque reference until
R07.0 documents its structure.

## Acceptance after capture

The candidate comparator must report exact row labels/order, column labels/order,
cells and totals. Tolerance is zero unless an original numerical representation
proves that a documented conversion tolerance is necessary.
