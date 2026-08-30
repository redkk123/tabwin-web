# R11.2 — UI de comparação de tabelas

**Data:** 2026-08-30
**Estado:** concluída. Gate **304/304**, E2E **15/15**.

## O que existia e por que não bastava

`include-table` (4.1, faixa antiga) já resolve um caso: mesclar uma coluna de
outra tabela **quando as chaves de linha já batem exatamente**. Não é
comparação geral — é desenhado para incluir, não para comparar tabelas de
fontes, períodos ou filtros diferentes, com granularidade ou cobertura
divergentes. `tabulation-diff.ts` (R09.6) também não é isso: compara a
**mesma** tabulação antes/depois de um ajuste de filtro, sempre por chave
idêntica.

`table-comparison.ts` (R11.0) já resolvia o núcleo — `inner`/`left`/`right`/
`full`, casamento por chave exata ou rótulo normalizado, diagnóstico de
cobertura, denominador zero explícito — mas só existia para seus próprios
testes. Esta faixa é a UI sobre esse núcleo.

## Decisão de design: A e B nunca se misturam

A é sempre o resultado ativo da sessão. B é aberto de um `.twtable`
**separadamente**, do mesmo jeito que "Incluir tabela" já lê um — `parsePortableTable`
+ `replayTableOperations` — mas **sem mesclar em A**. O ponto inteiro da faixa
é comparar duas tabelas, não combiná-las numa terceira.

## Pareamento de colunas: sugestão, nunca adivinhação silenciosa

Ao abrir B, o app tenta parear automaticamente:

1. toda coluna de A cuja **chave** também existe em B vira um par;
2. se nada parear assim e as duas tabelas têm exatamente uma coluna cada,
   parear essa única coluna dos dois lados.

Fora esses dois casos, a lista de pares nasce vazia e o usuário monta com
"+ Par de colunas" — duas tabelas de formato diferente não ganham um
pareamento chutado. Cada par é editável e removível a qualquer momento antes
de rodar a comparação.

## O que a tela mostra, nessa ordem

1. **Diagnóstico** — linhas em A, linhas em B, correspondentes, só-A, só-B,
   cobertura de cada lado, rótulos divergentes. Isso vem **antes** de
   qualquer número de comparação, como o núcleo exige.
2. **Avisos** — texto de `comparison.warnings` (linhas sem par de um lado,
   rótulos divergentes, política de casamento não-padrão).
3. **Resumo por par** (quando há linhas numéricas casadas) — EMA, REQM, EPAM,
   Pearson, com a nota de que correlação alta não é concordância.
4. **Tabela linha a linha** — rótulo, status (`ambas`/`só A`/`só B`), e por
   par: A, B, Δ, Δ%, razão B/A. Uma linha `só A` ou `só B` mostra "—" nos
   valores do lado ausente — nunca um zero.

Export CSV reproduz a mesma tabela, com BOM e `;`, mesma convenção do export
Microdatasus.

## O que não entrou, e está dito na própria interface

A nota de compatibilidade do painel diz: *"Este plano ainda não entra na
receita."* É verdade e é intencional — persistir o plano de comparação
(`TableComparisonPlan`) na `.twrecipe` é trabalho novo de contrato, não uma
extensão trivial desta UI, e ficou fora do escopo desta rodada.

## Verificação

- `npm run check`: **304/304**, inalterado — nenhuma mudança em
  `table-comparison.ts` em si.
- `npm run e2e`: **15/15**, com um caso novo que tabula duas fontes CSV
  diferentes, salva uma como `.twtable`, reabre como B, roda a comparação com
  junção `full`, e confirma: 1 linha correspondente (AC), 1 só em A (AM), 1 só
  em B (SP), diferença numérica correta na linha correspondente, e "—" nas
  células do lado ausente das linhas não pareadas. O CSV exportado também é
  conferido.
