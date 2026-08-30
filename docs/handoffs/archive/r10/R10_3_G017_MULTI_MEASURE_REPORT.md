# R10.3 — G017: múltiplas medidas simultâneas

**Data:** 2026-08-29
**Status:** implementado, testado, verificado contra o G017 real e em
navegador. Retomando exatamente o próximo degrau que o handoff do GPT
(`R10_2_SECOND_GOLDEN_BATCH_AUDIT_2026-08-29.md`) indicou.

## O QUE O G017 PROVA

O TabWin 4.15 real permite marcar mais de um incremento na mesma tabulação
(`Frequência + Valor Total + Óbitos`), e cada um vira sua própria coluna, na
ordem escolhida, sobre o mesmo eixo de linha (`Hospital AC (CNES)`). Nosso
executor era estritamente de uma medida por tabulação até este item.

## DESENHO, DE PROPÓSITO ADITIVO

`TabulationSpec.measure: MeasureSpec` continua obrigatório e sem mudança de
comportamento — é o que garante que nada que já funcionava para de
funcionar. `measures?: MeasureSpec[]` é o campo novo: só ativa o caminho
multi-coluna quando tem **2 ou mais** entradas; um array de um elemento (ou
ausente) segue o caminho de sempre.

`compileQueryPlan` valida:
- `measures` com menos de 2 entradas é erro explícito (junta o array com o
  campo `measure` singular por engano);
- `measures` **não pode coexistir com uma dimensão de coluna** — não existe
  oráculo para essa combinação ainda, e inventar o comportamento seria
  contra o princípio do projeto. Erro claro em vez de resultado adivinhado.
- cada entrada de `measures` passa pelas mesmas checagens que `measure`
  singular já tinha (soma exige campo, `weightField` só vale para contagem).

No executor (`packages/core/src/execute.ts`), a chave de coluna sintética
`__single__` vira `__measure_0__`, `__measure_1__`... quando `measures` está
ativo, e o acumulador grava um valor por medida por registro em vez de um
valor só. `axisFromDimension`/`propagateRowSubtotals`/exportações operam
sobre `columns`/`cells` genericamente — nenhuma dessas partes precisou saber
que existe multi-medida, porque o array de colunas já era a abstração certa.

`fieldsUsedByPlan` (projeção de campo para leitura em bloco) passou a
enumerar campo e `weightField` de toda medida em `measures`, não só da
primeira — sem isso, tabular pelo caminho de streaming perderia dados de uma
medida que não fosse a principal.

## INTERFACE

Seção nova "Medidas adicionais lado a lado" abaixo do seletor de medida
principal: escolher um campo, "+ Adicionar medida", lista removível. Cada
medida adicionada usa o rótulo do incremento do DEF quando existe (mesma
regra que o G003 estabeleceu para a medida principal) — nunca o nome cru do
campo quando há um DEF carregado dizendo o nome certo.

Guard de UI: escolher uma dimensão de coluna desabilita "adicionar medida"
(em vez de deixar a pessoa montar uma combinação que o `compileQueryPlan`
vai recusar de qualquer jeito). Se a pessoa já tinha medidas adicionadas e
escolhe uma coluna depois, a lista **não é apagada silenciosamente** — a
análise falha com o toast exato do `QueryPlanError`, e voltar a limpar a
coluna restaura o resultado (confirmado em navegador, inclusive batendo no
cache L3 por ser exatamente o mesmo plano de antes).

Receita: `measures` já passava pela validação de recipe/portable-table sem
mudança nenhuma nesses arquivos, porque os dois só repassam `spec` inteiro
para `compileQueryPlan` — não há allowlist de campos que precisasse ser
atualizada. `openRecipe` foi ajustado para restaurar a lista de "medidas
adicionais" a partir de `measures.slice(1)` (a primeira posição já é a
medida principal, restaurada como sempre).

## VERIFICADO

**Contra o dado real, fora do navegador:** reproduzi o G017 com os assets
reais (`RD2008.DEF`, `TCNESAC.DBF`, `RDAC2401.dbc`) e bati célula a célula
com o golden do GPT antes mesmo de rodar qualquer teste formal — total
`[4315, 4308072.760000005, 126]`, idêntico ao TabWin.

**Suíte formal:** `tests/multi-measure.test.mjs`, 9 testes cobrindo ordem
das colunas, rejeição de array com 1 elemento, rejeição de coluna+medidas
junto, validação de campo obrigatório em soma, propagação de subtotal por
todas as colunas (não só a primeira), enumeração de campos para projeção, e
paridade de avisos/aceitação com o caminho de medida única.

**`scripts/verify-second-goldens-local.mjs`:** G017 promovido de
"captured-not-yet-executable" para caso executável de verdade, comparado a
2 casas decimais pelo mesmo motivo do G003 (`VAL_TOT` declara essa precisão
no cabeçalho do DBF — não é tolerância afrouxada, é o campo falando).
`fixtures/golden/G017/manifest.json` atualizado para
`verified-zero-tolerance`, `cellDiffCount: 0`.

**Em navegador real:** abri `RDAC2401.dbc` + `RD2008.DEF` + `TCNESAC.DBF`,
selecionei linha "Hospital AC (CNES)" via `TCNESAC.DBF`, medida principal
Soma de `VAL_TOT`, adicionei `MORTE` como medida extra — tabela renderizou
duas colunas com os mesmos valores exatos do golden, linha a linha
(`9.537,73 / 0`, `82.809,16 / 1`, etc.). Testado também o guard: escolher
coluna com medida extra ativa produz o toast de erro exato, sem travar;
limpar a coluna recupera o resultado (do cache L3, mesmo plano). Console
sem erro em toda a sessão.

## GATE

`npm run check`: **236/236** (eram 227). Verificação local contra os assets
reais confirma G017. G001 inalterado.

## LIMITE DELIBERADO

Multi-medida e dimensão de coluna explícita permanecem mutuamente
exclusivas até aparecer um caso real do TabWin combinando as duas — não é
esforço, é ausência de oráculo, e o erro é explícito em vez de um resultado
adivinhado.

## PRÓXIMO PASSO

Conforme o handoff do GPT: G012 (formato `N`) só depois de uma explicação
com evidência para a categoria duplicada observada. Sem isso, permanece
somente leitura. Fora da bateria de goldens, a visão estratégica de mais
longo prazo trazida pelo usuário (ver conversa) está registrada para
discussão — não decidida nem iniciada nesta sessão.
