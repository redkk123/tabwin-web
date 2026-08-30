# R10.12 — Faixa 4.6: o compilador DuckDB, agora provado contra um DuckDB real

**Data:** 2026-08-30
**Estado:** compilador e portão de paridade **provados**. Embarque no navegador
é decisão do usuário, não pendência técnica. Gate **283/283**.

## O que o ChatGPT entregou

`packages/core/src/duckdb-plan.ts`, e a parte mais importante dele é o que
**recusa**:

- dimensão com CNV, lookup DBF, `startPosition` ou unclassified discriminado;
- filtro com CNV ou `startPosition`;
- `sum`, peso ou faixa numérica sobre campo não declarado numérico;
- regras cross-field;
- múltiplas medidas;
- qualquer campo ausente do schema declarado.

Cada recusa é um **blocker nomeado**, não uma tradução aproximada. Essa é a
decisão certa: o `QueryPlan` continua sendo a especificação semântica, e um
segundo motor não pode reinventá-la por analogia.

Filtros usam parâmetros posicionais. Nenhuma categoria entra no texto do SQL.

## O que faltava, e é o ponto

O corte tinha três testes, todos sobre **o compilador**: quais planos ele recusa
e que texto SQL ele emite. Necessário, e insuficiente. SQL que parece certo pode
contar diferente — é exatamente assim que um segundo motor deriva do primeiro.

`tests/duckdb-parity.test.mjs` executa os dois motores sobre os mesmos registros
e compara:

| Caso | Por que existe |
| --- | --- |
| contagem 1D | linha de UF vazia tem que sair nos dois |
| contagem 2D | registro com SEXO vazio sai inteiro, não vira célula |
| soma decimal | ponto flutuante é onde dois motores divergem primeiro |
| frequência ponderada | `SUM(COALESCE(peso,0))` contra o acumulador |
| filtros incluir/excluir | `NOT (...)` tem que casar com o predicado invertido |
| faixa com limite exclusivo | caso próprio, porque é onde um off-by-one aparece |
| categoria com aspas e `DROP TABLE` | prova que o valor é parâmetro, não texto |
| **portão falhando** | portão que nunca falhou não é evidência de nada |

Os sete passam. O último injeta um agregado errado de propósito e exige que o
`compareDuckDbAggregationToReference` acuse `changedGroups` e nomeie os grupos
faltantes.

## Um detalhe que só a execução mostraria

`executeInMemory` recebe `(records, plan)`, não `(plan, records)`. Escrito na
ordem errada, o erro que sai é `Cannot read properties of undefined (reading
'crossFieldRules')` — vindo de dentro do executor, a três chamadas de distância
da causa. Nenhum typecheck pegaria isso num teste `.mjs`.

## O DuckDB é dependência de desenvolvimento

`@duckdb/node-api`, só em `devDependencies`. Nada disso vai para o navegador.

**Decisão que fica com o usuário:** `@duckdb/duckdb-wasm` desempacota em
**149 MB**. Ligar o adapter a ele daria SQL no navegador, mas muda o caráter de
um aplicativo que hoje entrega 234 KB de bundle e se define como local-first
leve. Não é escolha de implementação; é escolha de produto.

O que a faixa precisava provar — **o SQL que geramos concorda com o executor de
referência** — já está provado, e a prova não depende de onde o DuckDB roda. Se
o WASM entrar depois, o adapter e o portão de paridade já estão prontos, e a
regra continua: nenhum plano é promovido para o caminho SQL sem passar pelo
portão.

## Verificação

- `npm run check`: **283/283** (eram 273).
- 3 testes do ChatGPT sobre o compilador: PASS, sem alteração.
- 7 testes novos de paridade contra DuckDB real: PASS.
