# R11.4.6 — Juntar bases por chave (join) — fecha o pipeline

**Data:** 2026-08-30
**Estado:** concluída. Gate **392/392**, E2E **24/24**. **Com esta faixa, o
módulo de transformação está completo** para os verbos da seção 5 do spec.

## O que é

`join` traz as colunas de uma segunda base para os registros atuais, casando
por uma chave explícita. É o caso `SIH × SIM` / `casos × população` que o
ChatGPT descreveu ("hoje você teve que exportar, normalizar chave, alinhar,
juntar tabela… o TabWin Web pode transformar isso em 'Comparar/Juntar'").
Diferente da comparação de tabelas agregadas (R11.2), que compara duas
tabelas *já tabuladas*; o join do pipeline opera sobre **microdados**, antes
da tabulação.

## Semântica

- **`inner`/`left`/`right`/`full`.** left mantém todo registro atual (sem
  correspondência → colunas trazidas ficam `null`); right mantém todo registro
  da segunda base; full mantém os dois lados; inner só os correspondentes.
- **Chave explícita, nomes podem diferir.** `keyPairs` mapeia um campo atual
  para um campo da fonte (`MUNIC_RES ↔ CODMUNRES`). A chave da fonte não é
  trazida como coluna nova — já está na linha pela chave atual.
- **N:N bloqueado por padrão.** Uma chave duplicada nos dois lados multiplica
  linhas, o que quase sempre é engano; interrompe com o número de ocorrências
  de cada lado, e só roda com `allowManyToMany` explícito.
- **Prefixo opcional** nas colunas trazidas, para não colidir com uma coluna
  atual de mesmo nome — colisão sem prefixo é recusada no validate, não
  resolvida em silêncio.
- **Sem valor inventado.** Uma linha sem correspondência recebe `null` nas
  colunas do outro lado, nunca um zero.
- **Diagnóstico** por execução: correspondentes, sem correspondência,
  só-da-fonte, colunas trazidas.

O join usa índice por chave (não varredura), então casar N registros contra M
da fonte é O(N+M), não O(N×M).

## UI

Reaproveita o carregador de segunda base do bind-rows (CSV/TSV, parseado na
thread principal). O primeiro corte oferece **um par de chave** (o caso
comum); o motor aceita vários, mas a tela ainda não. Tipo de junção, prefixo
e as duas chaves (atual e da fonte, esta populada do arquivo carregado).

## Verificação

- `npm run check`: **392/392** (8 testes novos: inner/left/right/full, chaves
  com nomes diferentes, N:N bloqueado e liberado, prefixo contra colisão,
  coluna trazida referenciável por um passo posterior, e validação de forma).
- `npm run e2e`: **24/24**, com um caso novo que junta casos × população por
  UF (left), confere o diagnóstico, e prova pela tabela que a coluna trazida
  vira medida e que uma UF sem correspondência tem população nula — sem linha
  de zero fabricado.
- Verificação manual no navegador antes do E2E.

## O módulo de transformação, completo

Onze verbos: `select`, `filter`, `mutate` (recode + missing + derive por
fórmula), `cast`, extração de data (com semana epidemiológica MMWR/MS),
normalização de texto/código (com IBGE), `dedupe`, `group_by+summarise`,
`bind_rows` e `join` — mais "ver código equivalente" (dplyr/pandas). Cada
etapa valida contra o esquema do seu ponto no pipeline, é tudo-ou-nada, e
reporta antes/depois. Aplicar é idempotente (recomeça do arquivo original).

## O que continua fora

DBC/DBF como segunda fonte de bind/join (precisa do Worker; CSV/TSV cobre o
primeiro corte). Múltiplos pares de chave na UI (o motor já aceita).
Reexecução do pipeline em dados novos com detecção de schema drift (seção 5.7
do spec) — persistir o pipeline na `.twrecipe` é o pré-requisito, e é trabalho
de contrato à parte. Nada disso é regressão; são recortes explícitos.
