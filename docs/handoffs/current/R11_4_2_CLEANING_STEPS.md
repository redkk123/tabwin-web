# R11.4.2 — Tipos, datas e normalização de texto/código

**Data:** 2026-08-30
**Estado:** concluída. Gate **363/363**, E2E **20/20**.

## O que faltava

O primeiro corte do pipeline (R11.4) entregou cinco tipos de etapa e deixou
registrado quais ficaram de fora e por quê. Depois o R11.5b ligou o
`mutate()` por fórmula. Esta faixa fecha mais três da lista da seção 5.3 do
spec — **Tipos**, **Datas** e **Texto e códigos** — que são exatamente as
operações que aparecem no exemplo de limpeza que o ChatGPT desenhou na
conversa de 2026-08-30 (padronizar `municipio_ibge` para 6 dígitos, extrair
`ano_notif` de `dt_notificacao`, tratar sentinela como ausente, filtrar
confirmados).

## `cast-type` — converter sem adivinhar

`number`, `text` ou `date`, com política explícita para o que não converter:
`keep` (mantém o valor original, não se perde nada) ou `missing` (marca como
ausente, decisão do autor). Nunca há um terceiro caminho silencioso, e valor
já vazio/nulo é contado separadamente (`jaAusentes`) de uma falha real de
conversão (`falhas`) — porque não são a mesma coisa.

As formas de data aceitas são as que o DATASUS realmente entrega:
`AAAAMMDD` (o formato de `DTOBITO`/`DT_NOTIFIC`), `AAAA-MM-DD`,
`DD/MM/AAAA` e o `Date` que o leitor de DBF devolve para campo tipo `D`.
Qualquer outra coisa não é chutada. Uma data impossível como `20240231` é
**recusada** em vez de rolar para 2 de março em silêncio, que é o que
`new Date()` faria sozinho. Tudo em UTC, para uma data nunca mudar de dia
por causa do fuso de quem está lendo.

## `date-part` — incluindo semana epidemiológica

`year`, `month`, `day`, `quarter`, `epidemiological-week` e
`epidemiological-year`.

A semana epidemiológica segue a regra MMWR/MS, escrita no código e repetida
na interface para poder ser conferida por quem é da área:

- a semana vai de **domingo a sábado**;
- a **SE 1** é a que termina no primeiro sábado de janeiro que cai no dia 4
  ou depois — ou seja, a primeira semana com pelo menos quatro dias no ano
  novo.

Por isso o **ano epidemiológico é uma coluna à parte**, não o ano do
calendário: 31/12/2023 pertence à SE 1 de **2024**, e 01/01/2021 pertence à
**última** semana de 2020. Ancorado em teste nos dois casos.

Uma data que não se deixa ler vira `null` na coluna derivada — ausência é o
que de fato existe ali; um zero seria um valor que o registro não tem.

## `text-normalize` — e a ferramenta de código IBGE

Operações encadeadas em ordem: `trim`, `upper`, `lower`, `pad-start`,
`substring` e `ibge-municipality`.

A última é a que o ChatGPT pediu por nome ("ferramenta própria para
reconhecer 6/7 dígitos e padronizar sem destruir zero inicial"):

- **7 dígitos** → derruba o dígito verificador (`5300108` → `530010`), que é
  a forma em que toda tabela de município do DATASUS é chaveada;
- **6 dígitos** → fica como está;
- **5 ou menos** → recebe o zero à esquerda de volta (`11001` → `011001`),
  exatamente o que uma planilha comeu;
- **qualquer outra coisa** → fica **intacta** e é contada em
  `naoReconhecidos`, nunca apagada.

## Verificação

- `npm run check`: **363/363** (9 testes novos: conversão numérica e de
  data com as quatro formas aceitas mais a data impossível, as partes de
  data, âncoras da semana epidemiológica em 2024 e 2021, normalização de
  texto em ordem, os quatro casos do código IBGE, validação de forma de cada
  etapa nova, e o pipeline de limpeza inteiro que o spec esboça rodando de
  ponta a ponta).
- `npm run e2e`: **20/20**, com um caso novo que carrega um CSV com um código
  de 7 dígitos, um de 5 e uma notificação de 31/12/2023, monta as três etapas
  pela interface, e confere na tabela: `5300108` virou `530010` e juntou-se ao
  `530010` que já existia (2 registros), `11001` virou `011001`, o ano
  epidemiológico de todos os quatro é 2024 (nenhum 2023), e as semanas são
  exatamente 1, 2, 3 e 27.
- Verificação manual no navegador com o mesmo conjunto antes do E2E existir.

## O que continua fora

`join` de microdados e `bind_rows` (o "Combinar DBC/DBF" já existente cobre o
caso comum de empilhar arquivos do mesmo esquema), `group_by()+summarise()`
(a tabulação comum já cobre count/sum/mean/min/max agrupado), "ver código
equivalente" em R/Python, reexecução com detecção de schema drift, e, na UI,
renomear/reordenar coluna e as operações `pad-start`/`substring` — que
existem no motor e nos testes, mas ainda não têm campo na tela, porque
precisariam de parâmetros numéricos por operação e a lista atual é uma
seleção múltipla simples.
