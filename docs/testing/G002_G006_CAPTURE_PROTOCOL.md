# G002–G006 — first batch of the differential compatibility corpus

Status: **CAPTURED AND PASSING — 2026-08-29.** G002, G003, G004 and G005 were
captured by the user against the real TabWin 4.15 and all four now pass with
tolerance zero. Fixtures live in `fixtures/golden/G002`–`G005`; full results,
including the two real divergences G003 found, are in
the R10.0 golden results report (in git history). G006 remains deferred for
the reason documented in its section below.

Two predictions in this document were confirmed and one open question was
answered by the capture:

- **G002's open question is settled:** TabWin **shows** all six
  `CARATENDc.CNV` categories, including the four with no data. It does not
  hide empty columns.
- **G003 diverged twice** — the sum column header is the DEF increment label
  (`Valor Total`), not a generic word; and a 4,153-record float sum lands 1 ULP
  away from ours, with our value closer to exact. Both investigated to root
  cause; see the results report.
- G004's accepted-record count (2,092) independently matches the `Eletivo`
  column total TabWin reports in G002.

The capture instructions below are kept verbatim as the historical record of
what was asked for.

---

Original status: **READY FOR REFERENCE CAPTURE — updated 2026-08-29 with real CNVs**
Follows the same discipline as `G001_CAPTURE_PROTOCOL.md`. Read that document
first — this one does not repeat the shared rules (pass criteria, failure
classification, hashing, normalized format).

**Revision note:** the first version of this document assumed `Caráter de
atendimento` could be picked as a raw, CNV-free column. It can't — TabWin's
real DEF binds that field's column role to `CNV\CARATENDc.CNV` unconditionally
(confirmed live: attempting it produced *"CNV\CARATENDC.CNV: Tabela de
conversão nao encontrada"*). The missing file has been fetched from the
official DATASUS auxiliary bundle and placed in
`C:\projetos\tabwin-private\oracle\tabwin415\app\G001\CNV\`, alongside
`CARATEND.CNV` and `SEXO.CNV`. G002, G004 and G006 below are corrected against
the real file contents — no more raw-column assumption.

## 1. Scope of this batch

Per the former implementation plan, P5, batch 1:

> G002–G006: row×column, sum, raw/CNV selection, zeros, non-classified.

Five cases, five semantics, one each — four ready to capture now, G006
deferred with a documented reason (§ below). All reuse assets already verified
for G001 — **nothing left to fetch**, everything below is already sitting in
the CNV folder next to `RD2008.DEF`:

| Asset | SHA-256 |
| --- | --- |
| `RDAC2401.dbc` | `41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429` |
| `RD2008.DEF` | `15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652` |
| `COMPLEX2.CNV` | `680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F` |
| `CARATENDc.CNV` | `03773387349528331EEDB6E2158BFEE02AEC245A770826A28F45733BA3679537` |
| `CARATEND.CNV` | `E57C08CD045E6EAB1403013D96C7782C963D17BDDF4864840A964B99155D27F8` |
| `SEXO.CNV` | `003E1B250D26B987867B9D0C1D155C42E340C4A62BFFDCD4DB85C7C41E60691E` |

`CARATEND.CNV` and `SEXO.CNV` match, byte for byte, the hashes already
recorded on 2026-08-27 in the acquisition report (in git history) — same
official file, re-fetched two days later, unchanged.

## 2. Why these five recipes, specifically

Each reuses the row dimension already proven in G001 — **Complexidade do
Procedimento**, `COMPLEX` field, `CNV\COMPLEX2.CNV` — and changes exactly one
thing per case, so a mismatch points at one semantic layer, not several at
once. This is the same discipline the failure classification in
`G001_CAPTURE_PROTOCOL.md` §8 exists for.

## 3. Predicted numbers

The numbers below are what the current TabWin Web engine computes today over
the same real DBC. They are **not** the golden — TabWin 4.15's real output is.
They exist so you can sanity-check your capture on the spot, and so a
disagreement is visible immediately instead of after normalization.

---

## G002 — row × column

**Semantic covered:** two-dimensional tabulation (row and column dimensions
simultaneously), never exercised by G001.

**Setup in TabWin 4.15:**

- File: `RDAC2401.dbc` only.
- DEF: `RD2008.DEF`.
- Row: **Complexidade do Procedimento** (`COMPLEX`, `CNV\COMPLEX2.CNV`) — same
  as G001.
- Column: **Caráter atendimento** (`CAR_INT`, `CNV\CARATENDc.CNV` — this file
  is now present, so the dialog that blocked this earlier will not appear).
- Increment: Frequência (count).
- Selections: none.
- Zero suppression: **both boxes unchecked** — "Suprimir linhas zeradas" *and*
  "Suprimir colunas zeradas". Your panel showed the column box already
  checked from a previous session; uncheck it for this case so all six
  columns appear, not just the two with data.

**Predicted (current engine, real CNV):**

```text
                       Eletivo  Urgência  Acid local trab  Acid trajeto  Outros ac trab  Outras caus ext
Atenção Básica              0         0                0             0               0                0
Média complexidade       1968      2185                0             0               0                0
Alta complexidade         124        38                0             0               0                0
Não se aplica                0         0                0             0               0                0
```

Six columns, not two — `CARATENDc.CNV` declares six categories
(Eletivo/Urgência/Acid local trab/Acid trajeto/Outros ac trab/Outras caus
ext), even though only the first two actually have data in this fixture. If
TabWin hides the four empty columns instead of showing zero, that itself is
useful evidence — record what it actually does.

## G003 — sum measure

**Semantic covered:** `Soma` instead of frequency — an increment field is
actually summed, not just counted.

**Setup:**

- Row: Complexidade do Procedimento, same as G001.
- Column: none.
- Increment: **Valor Total** (`VAL_TOT`) — sum, not frequency.
- Selections: none.
- Zero suppression: off.

**Predicted:**

```text
Atenção Básica       0
Média complexidade   3016736.92
Alta complexidade    1291335.84
Não se aplica         0
```

Record the exact decimal TabWin shows, including how many places it rounds
to — that rounding behavior is itself part of what this case needs to prove.

## G004 — CNV-backed selection (filter)

**Semantic covered:** a selection (`S` in the DEF) filtering records before
aggregation. Like the column in G002, `Caráter atendimento`'s selection role
is also bound to a CNV (`CNV\CARATEND.CNV` — note: without the trailing `c`,
a *different* file from G002's column CNV, both now present). There is no raw
selection path for this field either; the title's "raw/CNV selection" is
covered by contrasting this against G001's already-CNV-backed row, not by a
literal unclassified filter box.

**Setup:**

- Row: Complexidade do Procedimento, same as G001.
- Column: none.
- Increment: Frequência.
- Selection: **Caráter atendimento** — tick only **"01 Eletivo"** in the
  category list.
- Zero suppression: off.

**Predicted:**

```text
Atenção Básica       0
Média complexidade   1968
Alta complexidade    124
Não se aplica         0
```

Total accepted records should be **2,092** — record whatever record count
TabWin's own log or status bar reports, so this becomes part of the
comparison.

## G005 — zero suppression

**Semantic covered:** `suprimir zeros` policy, toggled against the exact same
tabulation G001 already captured.

**Setup:** identical to G001 (Complexidade do Procedimento, no column, no
selection, frequência) with **one change**: turn zero-row suppression **on**.

**Predicted:**

```text
Média complexidade   4153
Alta complexidade     162
```

The two zero rows from G001 (`Atenção Básica`, `Não se aplica`) should
disappear entirely — not show as zero, not show blank, simply absent from the
row list. If TabWin does something else (shows them collapsed into a single
"outros" row, for instance), that is exactly the kind of divergence this
golden exists to catch — capture what actually happens, not what this
document predicts.

---

## G006 — non-classified: deferred, with a documented negative result

**Semantic covered:** a raw value that exists in the DBF but is **not**
covered by any category rule in the applied CNV.

Two candidates were checked directly against the real, now-materialized CNV
contents before asking you to click anything, and **neither produces a
genuine case on this DBC**:

- `COMPLEX2.CNV` (already used by every case above): its fallback
  (`04  Não se aplica  00-99`) covers every possible two-digit value. Nothing
  is ever left unclassified under it.
- `SEXO.CNV`: declares `3  Ignorado  0-9` as a fallback, but `1  Masculino  1`
  and `2  Feminino  2,3` override it for codes 1, 2 *and* 3. The real DBC only
  contains raw codes `1` and `3` — both land on named categories
  (Masculino/Feminino), **zero** on Ignorado. Confirmed by running the actual
  parser against the real file: the resolved categories are
  `Masculino, Feminino, Ignorado`, and only the first two would ever show a
  nonzero count here.
- `CARATEND.CNV`/`CARATENDc.CNV` (G002/G004): declare exactly six codes
  (`01`–`06`) with **no broad fallback** — a real gap-producing CNV in
  principle — but the real DBC's `CAR_INT` field only ever contains `01` and
  `02` in this fixture (confirmed: `1968+2185+124+38 = 4315`, the whole file).
  No room for a seventh code to appear.

**Don't run this case yet.** Every field this batch has real assets for turns
out fully covered by its CNV in this particular small AC/2024-01 file. A
genuine non-classified case needs either a different, larger DBC (more months
or a bigger UF, more likely to contain a rare or malformed code) or a
different field/CNV pair entirely. This becomes a G007+ item once a suitable
file is identified, tracked in `docs/testing/GOLDEN_CORPUS_QUEUE.md` — it is
not lost, just not part of this batch.

---

## 4. What to send back

Four cases to capture now — **G006 is deferred**, see above. For each of
G002/G003/G004/G005, save into
`C:\projetos\tabwin-private\oracle\g00X-capture\reference-tabwin415\`
(matching the existing `g001-capture` layout), where `X` is `2`, `3`, `4` or
`5`:

- `result.xls` (or whatever lossless export TabWin produces — same format
  G001 used is preferred, for one comparator to handle all of them);
- `recipe.txt` — plain text noting exactly what you selected: row, column,
  increment, selections, zero-suppression state;
- `capture-notes.md` — anything that surprised you, any dialog TabWin showed,
  any rounding you noticed;
- `screenshot.png` — optional, useful when a table result is short.

You do not need to normalize anything into JSON — that part is mine. Tell me
when files are in place and I'll build `fixtures/golden/G002`–`G005`, run the
comparison, and classify anything that does not match using the same
`INGEST`/`DEF`/`CNV`/`FILTER`/`MEASURE`/`ORDER`/`NONCLASSIFIED` scheme G001
uses.

## 5. What NOT to do

- Don't reorder or edit rows before exporting.
- Don't substitute a different field if something in this document turns out
  to be wrong about the real DEF/CNV/UI — stop and tell me instead of
  improvising a fix, so the mismatch is evidence rather than noise.
- Don't skip a case because it seems redundant with G001 — G002–G005 each
  isolate exactly one semantic G001 does not cover.
