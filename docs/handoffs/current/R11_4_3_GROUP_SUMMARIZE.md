# R11.4.3 — Agrupar e resumir (group_by + summarise)

**Data:** 2026-08-30
**Estado:** concluída. Gate **370/370**, E2E **21/21**.

## O que faltava

A seção 5.4 do spec fecha o exemplo de limpeza com "Agrupar por Região + Ano
→ Resumir: N e proporção". As etapas anteriores do pipeline (R11.4, R11.4.2,
R11.5b) preparavam o dado; faltava a operação que colapsa os registros em uma
linha por grupo — o `group_by() + summarise()` do dplyr, o único verbo que
muda a **forma** do dataset inteiro.

## O que a etapa faz

`group-summarize` recebe campos de agrupamento e uma lista de resumos, e
devolve uma linha por combinação distinta das chaves. Sete agregações:
`count` (N do grupo), `sum`, `mean`, `median`, `min`, `max` e `distinct`
(quantos valores distintos não vazios). Cada resumo nomeia sua coluna de
saída (`as`).

Depois de agrupar, **só as chaves e os resumos continuam existindo** — a forma
muda por completo, então qualquer coisa que uma etapa posterior precise tem
que ser uma delas. Isso é o esperado do verbo, e o rastreamento de campo já
existente cuida disso: uma etapa `filter-rows` depois de um `group-summarize`
que não manteve o campo falha com a mensagem clara de sempre.

## Duas decisões que valem nota

- **Grupo sem valor resume como ausente, nunca zero.** Um grupo cuja coluna
  não tem nenhum valor numérico finito (só texto, só nulos) resume `sum`/
  `mean`/etc. como `null` — "—" na tabela — em vez de um zero fabricado. O
  `count` do mesmo grupo continua honesto: os registros existem, só não têm
  número naquele campo. É o mesmo princípio de "não inventar zero" que a
  comparação de tabelas e o executor já seguem.
- **Chave que é campo derivado não ganha origem inventada.** Um campo de
  agrupamento pode ser ele mesmo uma coluna criada por um `derive-column`
  antes. A linhagem (`originalName`) é carregada do campo real, não assumida
  como o nome da chave — um campo derivado usado como chave continua sem
  origem, e o Worker sintetiza a coluna numérica para ele, em vez de fingir
  um campo de origem que não existe. Ancorado em teste nos dois casos.

## O que não entrou

`proportion` como agregação. A palavra aparece no exemplo do spec, mas
proporção **de quê** é uma decisão de denominador que a etapa sozinha não
tem como tomar sem inventar — a razão de um grupo sobre o total, ou de uma
categoria dentro do grupo, são coisas diferentes. Com N por grupo já
disponível, a proporção certa se escreve como uma coluna de fórmula
(`derive-column`) sobre o resultado agrupado, onde o autor diz explicitamente
qual é o denominador. Fica registrado aqui para não parecer esquecimento.

## Verificação

- `npm run check`: **370/370** (7 testes novos: as três agregações básicas
  colapsando por chave composta, mediana/min/max/distinct, o grupo sem valor
  virando null, a mudança de forma cortando um campo anterior, a chave
  derivada sem origem inventada, a validação de forma da etapa, e o exemplo
  região-por-ano do spec de ponta a ponta).
- `npm run e2e`: **21/21**, com um caso novo que filtra confirmados, agrupa
  por UF com N e soma de VALOR, e confere pela tabela real que o dataset
  colapsou para uma linha por UF (SP soma 50 dos dois registros confirmados,
  não os 90 que incluiriam o registro CLASSI=2 filtrado antes).
- Verificação manual no navegador antes do E2E, conferindo N e soma por UF
  contra os valores esperados.
