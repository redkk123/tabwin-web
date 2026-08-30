# R04.3 — Advanced filters and explicit unclassified handling

**Date:** 2026-08-27  
**Status:** IMPLEMENTED — EXPLICIT POLICIES, LEGACY DEFAULT GOLDENS PENDING

## 1. Outcome

The browser selection builder now covers inclusion, exclusion, numeric
intervals and unmatched CNV values. A row dimension can also materialize an
explicit `Não classificados` row instead of silently discarding unmatched or
empty source values.

These choices are analytical inputs. They compile into `AnalysisSpec` and
`QueryPlan`, execute before tabulation, persist in `.twrecipe` and appear in
Audit. No DOM-only filtering is used to change analytical totals.

## 2. Filter contract

Category filters are backward compatible with existing recipes and now add:

- `mode: include | exclude`;
- raw or CNV sequence categories;
- optional unmatched-CNV membership.

Numeric-range filters add:

- optional minimum and maximum;
- independently inclusive or exclusive boundaries;
- include or exclude mode;
- explicit rejection of ranges without bounds, inverted bounds, non-finite
  values or a simultaneous CNV conversion.

Multiple filters continue to intersect deterministically. Exclusion simply
inverts its own predicate before that intersection.

## 3. Unclassified dimension policy

`DimensionSpec.unclassifiedPolicy` is either `omit` or `discriminate`.
Undefined remains equivalent to `omit`, so existing analyses and G001 are not
changed. `discriminate` maps missing raw values and unmatched CNV values to a
dedicated stable key labelled `Não classificados`.

For a CNV-backed axis, the row is materialized even at zero, just like declared
CNV categories. Existing zero-row suppression may remove it afterward. The
label/default is an explicit modern policy until a focused 4.15 golden captures
the exact presentation.

## 4. Browser workflow

The filter builder now exposes:

- Incluir correspondentes / Excluir correspondentes;
- Valores/categorias / Intervalo numérico;
- minimum, maximum and boundary checkboxes;
- Selecionar tudo and Limpar;
- a `Não classificados (sem correspondência CNV)` category when a conversion
  backs the selection;
- active cards that state inclusion/exclusion and interval bounds.

The analysis form adds `Discriminar não classificados` for the row axis.

## 5. Verification

`npm run check` passed:

- 57 tests, all passing;
- TypeScript kernel build;
- browser typecheck;
- Vite production build.

Three new tests cover raw exclusion, inclusive/exclusive numeric boundaries,
unmatched CNV filtering and axis discrimination. One initial test correctly
failed because the fixture's `00–99` CNV range classified an empty value as
`Ignorado`; the fixture was corrected to the genuinely unmatched code `AA`.
No implementation or expected golden was weakened.

Browser verification loaded the real G001 DBC, DEF and CNV:

| Workflow | Accepted/result |
| --- | ---: |
| Exclude raw `SEXO=3` | 1,761 records |
| Include raw `IDADE=20–39` | 1,663 records |
| Discriminate unmatched `COMPLEX2.CNV` | `Não classificados = 0` |

Audit contained the exact filter kind, mode, bounds and row policy for each
case.

## 6. Remaining compatibility work

Focused oracle cases must establish the original TabWin 4.15 defaults for
boundary inclusion, unmatched labels, interaction with subtotal categories and
whether a zero unclassified row materializes before suppression. Until then,
the browser accurately labels these as explicit policies rather than golden
compatibility claims.
