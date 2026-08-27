# TabWin `.DEF` — R01 compatibility specification

Status: **implemented subset, evidence-tagged**  
Revision: **R01.1-dev**  
Purpose: record exactly what the current parser believes, what it executes, and what remains unresolved.

## 1. Why DEF is central

A `.DEF` file is not merely metadata. It defines the analysis panel that TabWin exposes for a data family: eligible input file patterns, line/column/selection variables, increments, grouped-frequency behavior and the conversion/lookup resources attached to each variable.

For TabWin Web, the DEF parser is therefore part of the compatibility boundary. UI must be generated from normalized DEF semantics rather than hard-coded per SUS system.

## 2. Evidence hierarchy used in R01

1. `defcnv.htm` distributed inside the supplied TabWin 4.15 package.
2. Historical TabWin manual mirrored by Secretaria de Estado da Saúde do Paraná:
   `https://www.saude.pr.gov.br/sites/default/arquivos_restritos/files/documento/2022-04/manualtabwin.pdf`
3. DATASUS historical TabWin 3.x documentation:
   `https://siab.datasus.gov.br/DATASUS/tabwin/doctabwin.htm`
4. Real DEF corpus — **pending acquisition**, especially `RD2008.DEF` and current SIH auxiliary tables.
5. Golden behavior from TabWin 4.15 — **pending G001 capture**.

No undocumented behavior should be promoted to COMPAT solely because it seems plausible.

## 3. Implemented directives

| Directive | Historical meaning | R01 parser | R01 executor/bridge |
|---|---|---:|---:|
| `A` | input file pattern | yes | source discovery later |
| `A...,query.sql` | input pattern + SQL refresh query | yes | execution no |
| `S` | selection | yes | yes for CNV-backed option |
| `L` | line | yes | yes for CNV-backed option |
| `C` | column | yes | yes for CNV-backed option |
| `Q` | quadro/TABDOS | yes | retained, no Web UI behavior |
| `D` | line + quadro | yes | row role available |
| `T` | line + column + quadro | yes | row/column roles available |
| `I` | increment/summable field | yes | sum measure bridge |
| `G` | grouped records; frequency comes from a field | yes | weighted-frequency execution |
| `R` | TABDOS report output | yes | retained only |

## 4. S/L/C/Q/D/T field layout

The documented form after the directive is four comma-separated fields:

```text
<label>,<DBF field>,<start position>,<CNV file>
```

or, for a related DBF lookup:

```text
<label>,<source key>,<description field>,<lookup.DBf>
```

The parser distinguishes these using the third field:

- positive integer => CNV-backed option;
- non-numeric => related-DBF lookup.

### 4.1 Start position is semantically active

The third field in a CNV-backed option is a **1-based character start position inside the DBF field**. R01 now carries this value into `DimensionSpec` / `FilterSpec` and slices before CNV classification.

This matters for composite fields such as dates. A definition can select month from characters 3–4 of a longer field while using a two-character month CNV.

This was a hidden correctness gap in R01.0 and is fixed in R01.1.

## 5. G — grouped frequency

Historical behavior: when the DEF declares a `G<field>` directive, one physical record represents multiple occurrences. Frequency must add the numeric value in that field instead of adding one.

R01 implementation:

```text
count without G => +1 per accepted record
count with G    => +record[G field]
```

Non-numeric grouped frequency values are treated as zero and generate a warning in the current reference executor.

This must receive a real golden test before receiving a compatibility badge.

## 6. Related-DBF lookups

The parser recognizes related DBF definitions and preserves:

- source key field;
- description field in related DBF;
- related DBF filename;
- roles/directive/source line.

Execution is deliberately **unsupported in R01**. No attempt is made to pretend a related DBF is a CNV.

Planned implementation:

1. ingest related DBF locally;
2. build deterministic key -> label index;
3. verify fallback rule when the source-key-named field does not exist in related DBF (historical docs say first field is used);
4. golden-test ordering, missing keys, duplicate keys and selection behavior.

## 7. `X` directive — unresolved

The `defcnv.htm` supplied with TabWin 4.15 explicitly refers to DEF record types `S, L, C, D, T ou X` when discussing the starting position used for CNV comparison.

The supplied 4.15 documentation does **not** define the meaning of `X`, and the older manual's directive list does not include it.

R01 policy:

- detect `X`;
- preserve the complete source line;
- emit a warning;
- do not activate it as a row/column/filter role;
- resolve from a real modern DEF corpus or stronger documentation.

This is a good example of the project's rule: **unknown semantics are a visible gap, not an invitation to guess.**

## 8. Unknown first-position characters

The historical manual states that lines with blank first position or an undefined function are treated as comments. R01 therefore does not make unknown directive-like lines fatal by default; they are retained in `unknownLines` for archaeology/audit.

Recognized directives remain strictly validated in compatibility mode.

## 9. Ordering

DEF option source order is preserved in the normalized `options` list. The panel UI should use source order unless a future golden test proves a different TabWin ordering rule.

CNV source-order precedence is a separate issue and is already represented by the CNV model.

## 10. R01.1 evidence status

### Parser-level evidence

- historical manual examples parse;
- A + optional SQL query parses;
- D/T role expansion is tested;
- related DBF lookups parse;
- G and R parse;
- X is detected without guessed semantics.

### Executor-level evidence

- DEF start position is honored in line classification;
- DEF start position is honored in selection/filter classification;
- G weighted frequency executes in the reference engine;
- DEF CNV options bridge to QueryPlan dimensions and filters;
- I increments bridge to sum measures.

### Missing evidence before COMPAT claim

- parse a contemporary `RD2008.DEF` byte-for-byte;
- parse every CNV referenced by one G001 workflow;
- execute G001 against a real DBC;
- compare exact labels/order/cells with TabWin 4.15;
- test related-DBF lookup if G001/next fixtures require it;
- determine `X` semantics from real corpus/documentation.
