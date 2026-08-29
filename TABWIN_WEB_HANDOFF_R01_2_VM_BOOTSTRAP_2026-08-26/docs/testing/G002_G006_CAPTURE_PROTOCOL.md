# G002–G006 — first batch of the differential compatibility corpus

Status: **READY FOR REFERENCE CAPTURE**
Follows the same discipline as `G001_CAPTURE_PROTOCOL.md`. Read that document
first — this one does not repeat the shared rules (pass criteria, failure
classification, hashing, normalized format).

## 1. Scope of this batch

Per `docs/product/REMAINING_IMPLEMENTATION_PLAN.md`, P5, batch 1:

> G002–G006: row×column, sum, raw/CNV selection, zeros, non-classified.

Five cases, five semantics, one each. All five reuse the exact assets already
verified for G001 — **no new file to fetch** for G002–G005:

| Asset | SHA-256 |
| --- | --- |
| `RDAC2401.dbc` | `41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429` |
| `RD2008.DEF` | `15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652` |
| `COMPLEX2.CNV` | `680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F` |

G006 is the exception — explained in its own section, because a genuine
non-classified case cannot be manufactured without evidence that one exists.

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
- Column: **Caráter de atendimento**, but select it **raw**, i.e. the plain
  `CAR_INT` field without applying `CNV\CARATEND.CNV`. If TabWin's column
  picker forces a CNV-backed option for this field and offers no raw
  alternative, stop and tell me — don't substitute a different field on your
  own, since the whole point is testing an unclassified column.
- Increment: Frequência (count).
- Selections: none.
- Zero suppression: **off** — all four Complexidade categories should appear,
  including the two with zero occurrences.

**Predicted (current engine):**

```text
Atenção Básica       01=0     02=0
Média complexidade   01=1968  02=2185
Alta complexidade    01=124   02=38
Não se aplica        01=0     02=0
```

(`01`/`02` here are the raw `CAR_INT` values, since the column is
unclassified — the header TabWin shows for each column is exactly what you
should record, whatever label it uses for a raw column.)

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

## G004 — raw selection (filter)

**Semantic covered:** a selection (`S` in the DEF) applied against a **raw**
field value, filtering records before aggregation — contrasted with G001's
row dimension, which is CNV-backed throughout. Together, G001 and G004 cover
both selection mechanisms this batch's title names.

**Setup:**

- Row: Complexidade do Procedimento, same as G001.
- Column: none.
- Increment: Frequência.
- Selection: **Caráter de atendimento = `01`** only, chosen as a raw value
  (not through a CNV category list) — the DEF exposes `CAR_INT` directly for
  this purpose.
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

## G006 — non-classified

**Semantic covered:** a raw value that exists in the DBF but is **not**
covered by any category rule in the applied CNV. `COMPLEX2.CNV` cannot be
used for this case — its declared fallback (`04  Não se aplica  00-99`)
covers every possible two-digit value, so nothing is ever left unclassified
under it.

This case genuinely needs a CNV that does **not** have full coverage, and I
do not have one materialized locally to confirm which field/CNV pair actually
produces a gap in this specific DBC.

**What to do:**

1. Open **Sexo** as the row dimension. Its DEF entry is an `X` directive
   pointing at `CNV\SEXO.CNV`; if that file is not already in your local CNV
   folder, TabWin 4.15 should offer to fetch it from the official DATASUS
   auxiliary bundle itself — let it.
2. Increment: Frequência. No column, no selection, zero suppression off.
3. Look at what TabWin actually shows. The raw values present in this file
   are known to be `1` (1,761 records) and `3` (2,554 records); there is no
   record with raw value `2` in this fixture.
4. **Report back exactly what you see** — every row label, every count,
   whether a "não classificados" row (or equivalent) appears at all.

If every record classifies cleanly, Sexo does not produce a genuine G006 for
this DBC, and I will pick a different field once you tell me what you
observed — I'd rather wait for real evidence than invent a gap that might not
exist.

---

## 4. What to send back

For each case that completes, save into
`C:\projetos\tabwin-private\oracle\g00X-capture\reference-tabwin415\`
(matching the existing `g001-capture` layout), where `X` is `2`, `3`, `4`,
`5` or `6`:

- `result.xls` (or whatever lossless export TabWin produces — same format
  G001 used is preferred, for one comparator to handle all six);
- `recipe.txt` — plain text noting exactly what you selected: row, column,
  increment, selections, zero-suppression state;
- `capture-notes.md` — anything that surprised you, any dialog TabWin showed,
  any rounding you noticed;
- `screenshot.png` — optional, useful when a table result is short.

You do not need to normalize anything into JSON — that part is mine. Tell me
when files are in place and I'll build `fixtures/golden/G002`–`G006`, run the
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
