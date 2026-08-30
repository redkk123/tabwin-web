# R10.7 — G009 destravado e um defeito real corrigido

**Data:** 2026-08-29
**Status:** capturado, defeito corrigido, golden passa com tolerância zero.
**Corpus completo: 15 goldens, nenhum bloqueado.**

## O bloqueio anterior não era do motor

O G009 estava registrado como "erro de protocolo de captura": o roteiro
mandava usar `AIH_MA.DEF` com `RDAC2401.dbc`, mas o TabWin nunca listava o
arquivo. A causa é o `A` do DEF, que declara `D:\MA\MA\MA*.DBC`.

Esse padrão é só um **filtro de listagem** — o TabWin resolve campos por
**nome**, e todos os campos que a opção "Permanência" usa existem no arquivo
RD. Então bastou capturar com `MAAC2401.dbc`, cópia byte a byte do
`RDAC2401.dbc` (mesmo SHA-256) renomeada só para casar com o padrão. Nada do
que é tabulado mudou.

Segunda pegadinha: o `AIH_MA.DEF` referencia as CNVs **sem** o prefixo
`CNV\` que o `RD2008.DEF` usa, então o `PERM.CNV` precisava estar ao lado do
DEF, não na subpasta.

## O defeito que o caso revelou

O DEF declara **posição inicial 2** para `DIAS_PERM`. O executor honrava isso
para qualquer posição diferente de 1, fatiando o valor como texto. Só que
`String(2).slice(1)` é `""`, e `Number("")` é `0`:

| | Nosso motor (antes) | TabWin 4.15 |
| --- | ---: | ---: |
| 0 dias | **3.932** | **212** |
| 1 dia | 70 | 955 |
| 2 dias | 57 | 998 |
| 8-14 dias | 43 | 425 |
| linhas | 10 | 12 |
| Total | 4.315 | 4.315 |

O total batia — todo registro era contado uma vez — mas **91% deles caíam na
faixa errada**. Uma distribuição de permanência hospitalar com 3.932 de 4.315
internações em "0 dias" é obviamente falsa; a do TabWin é plausível.

## A regra

Uma CNV de faixa numérica classifica **o valor**, nunca um pedaço do texto
dele. A posição inicial do DEF simplesmente não se aplica a esse modo.

O código já sabia disso pela metade: havia uma condição que devolvia o valor
cru quando a posição era 1, com um comentário explicando que fatiar texto
corromperia a semântica decimal. O raciocínio estava certo, a condição é que
estava estreita demais — bastava a posição ser diferente de 1 para cair no
caminho errado. Removida a condição de posição em
`packages/core/src/execute.ts`; a correção vale também para filtros, que
passam pela mesma `extractSourceValue`.

## Verificação

Reprodução célula a célula das 12 faixas do export real, na mesma ordem,
com total 4.315. Teste unitário sintético cobre o caso mínimo (valor `2` com
posição declarada 2 tem que classificar como 2, não como 0).

- `npm run check`: **244/244** (eram 243).
- `verify-second-goldens-local.mjs`: **10/10** casos, G009 incluído com
  checagem de total.
- G001 inalterado.

## Nota sobre a validade deste golden

Usar um DEF fora da família de arquivos para a qual foi escrito é um
pareamento sintético, e isso está registrado no `capture-notes.md` do
fixture. O que o caso testa continua real: os campos existem, a semântica de
faixa numérica é a mesma, e os dois motores leram exatamente o mesmo DBC com
o mesmo DEF e a mesma CNV. Para um teste diferencial é isso que importa.

O print do primeiro erro (`Tabela de conversão nao encontrada`) foi
preservado como `first-attempt-file-pattern-blocker.png`, com nota no
manifest: é o registro de por que a captura precisou da cópia renomeada.

## Estado do corpus

15 goldens capturados, **15 passando com tolerância zero**, nenhum bloqueado
e nenhum classificado como divergência deliberada. Os três casos que mais
deram trabalho — G003, G012 e G009 — foram justamente os que acharam defeito
real ou semântica não documentada.
