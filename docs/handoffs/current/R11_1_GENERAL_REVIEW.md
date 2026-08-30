# R11.1 — Revisão geral: o que ficou meia boca

**Data:** 2026-08-30
**Pedido:** "faz uma revisão geral pra ver oq ficou meia boca" sobre as
últimas ~15 sessões (4.2 até R11.0).
**Método:** agente de exploração dedicado, leitura de código, sem acesso ao
histórico de decisão — só o que o código e as mensagens de commit realmente
dizem.

## O achado real: zoom vazava para exportação e impressão

**Severidade alta, confiança alta.** O próprio código documentava a garantia
e a quebrava.

`printChart` e o texto do próprio painel dizem: *"O zoom é só de
visualização e não entra na exportação nem na receita."* Mas
`serializedChartSvg` — usada tanto por `exportChartSvg` quanto por
`exportChartPng` — fazia `chart.querySelector('svg')` e serializava
**exatamente o que estava na tela**, incluindo o `viewBox` alterado pelo
zoom. `printChart` nunca tocava no `viewBox` de jeito nenhum.

Resultado prático: dar zoom para ler uma barra e depois exportar ou imprimir
entregava o recorte, não o gráfico inteiro — o oposto do que a interface
promete.

**Por que passou pelo gate anterior:** o teste E2E que acompanhou o próprio
recurso de zoom (`b8d3ac3`) só verificava que o zoom move o `viewBox` e que
"Reenquadrar" devolve o original. Nunca exercitou exportar ou imprimir
**enquanto** com zoom. `npm run e2e 7/7` na época era verdade e insuficiente
ao mesmo tempo.

### Correção

- `serializedChartSvg` agora clona o SVG e reseta o `viewBox` do clone para o
  quadro cheio antes de serializar — a tela e o zoom do usuário nunca são
  tocados.
- `printChart` não tem clone para substituir (imprime o DOM ao vivo), então
  salva o `viewBox` atual, força o quadro cheio para o diálogo, e devolve o
  valor salvo depois — no mesmo `afterprint`/`setTimeout` de segurança que já
  existia para o marcador de impressão.
- Dois testes E2E novos: um exporta SVG com zoom ativo e confere que o
  arquivo baixado tem `viewBox="0 0 1000 500"` **e** que o zoom na tela
  continua exatamente como estava; outro faz o mesmo para impressão,
  emulando `window.print()` para não bloquear o teste com o diálogo real.

## Consolidado: a regra de limites de eixo estava escrita à mão três vezes

**Severidade média, confiança média** — não era bug hoje, mas os quatro
lugares (`resolveAxis`, `axisBounds`, `savedAxisBounds` e a validação de
`parseRecipe`) concordavam por acidente, não por design compartilhado.

`packages/core/src/axis-bounds.ts` agora tem `validateAxisBounds`, usada por
`main.ts` (as duas funções da UI) e por `recipe.ts` (validação ao carregar).

**Uma exceção documentada, não um recuo:** `resolveAxis` em
`chart-model.ts` **não** usa a função compartilhada. Tentei, e quebrou
`tests/chart-renderer.test.mjs`. A causa raiz, confirmada por teste direto:
esse arquivo é carregado de duas formas — compilado via `dist/` (onde um
import real entre pacotes resolve normalmente) e direto do código-fonte pelo
teste do renderer (via `apps/web/src/chart-renderer.ts`, que nunca passa por
`tsc`). No segundo caminho, um `import` de **valor** de outro pacote não tem
arquivo `.js` literal fora do `dist/` para resolver, e lança
`ERR_MODULE_NOT_FOUND`. O `import type` que o mesmo arquivo já tinha
sobrevive só porque tipo é apagado inteiramente antes do Node tentar
resolver — uma função de verdade não recebe esse desconto. Revertido, com o
motivo escrito em comentário no próprio arquivo para ninguém tentar essa
mesma consolidação sem saber por quê.

## O que a revisão apontou e não é bug

- **`statistical-anomaly.ts`, `table-comparison.ts`, `duckdb-plan.ts`,
  `columnar-cache.ts`, `legacy-tab.ts`** não têm chamador nenhum no
  aplicativo — só nos próprios testes. **Verdade, e declarado nos próprios
  commits** (`06cec96`, `0dafa2a`, `51636d3`): são núcleo provado, não
  recurso integrado. Registrado na seção 4.13 do roadmap e nos handoffs
  correspondentes.
- `#flow-panel` tem um id que o `main.ts` nunca consulta — inofensivo, o
  painel é sempre visível; é só um gancho de seletor sem uso, não um defeito.

## Verificação

- `npm run check`: **304/304**, inalterado pela consolidação.
- `npm run e2e`: **14/14** (12 antes, 2 novos para o zoom).
- CI verde nos dois workflows após o push.
