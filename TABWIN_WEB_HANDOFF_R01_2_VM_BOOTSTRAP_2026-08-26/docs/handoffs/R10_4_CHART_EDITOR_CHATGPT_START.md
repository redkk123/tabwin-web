# R10.4 — Início da Faixa 4.2: editor de gráficos (ChatGPT → Claude)

**Data:** 2026-08-29  
**Estado:** **PARCIAL / PRONTO PARA HANDOFF**  
**Base:** cópia modificada do snapshot `5879760` após a auditoria ChatGPT anterior.  
**Objetivo deste corte:** começar a Faixa 4.2 sem tentar fechá-la inteira, deixando uma fronteira clara para o Claude continuar.

## 1. O que eu implementei

### 1.1 Painel de edição no browser

Em `apps/web/index.html` foi criado um editor de apresentação abaixo do seletor de família do gráfico, com:

- título visível;
- subtítulo;
- família de fonte (`system`, `serif`, `monospace`);
- casas decimais de 0 a 6;
- cor principal;
- cor de destaque;
- cor de fundo;
- liga/desliga de rótulos de valor;
- liga/desliga de legenda;
- binding explícito de eixo X;
- binding explícito de eixo Y.

Os bindings X/Y ficam desabilitados fora das famílias `points` e `bubbles`.

### 1.2 Renderer SVG deixou de ser hardcoded

`apps/web/src/chart-renderer.ts` agora aceita `ChartRenderOptions` e usa essas opções na mesma árvore SVG que alimenta a tela e as exportações SVG/PNG.

Foram parametrizados neste corte:

- título e subtítulo visíveis;
- fonte;
- cor principal;
- cor de destaque;
- fundo;
- visibilidade de legenda;
- visibilidade de rótulos;
- casas decimais.

A paleta secundária de setores continua existente para categorias adicionais. A primeira fatia usa a cor principal escolhida.

### 1.3 Dispersão/bolhas com X/Y explícitos

Em `packages/visualization/src/chart-model.ts` foi adicionada a função pura:

`scatterDataFromResult(result, xColumnKey, yColumnKey, limit)`

Ela:

- localiza os dois campos pelo `column.key` do `TabulationResult`;
- deriva `x` e `y` sem alterar a tabela;
- preserva o total da linha em `value`;
- retorna `[]` se qualquer binding não existir.

No renderer, `points` e `bubbles` passam para modo XY **somente quando X e Y foram explicitamente selecionados**. Sem os dois bindings, o comportamento anterior baseado na ordem das linhas continua sendo usado.

Nas bolhas, neste corte o raio ainda usa o total da linha; não foi criado binding separado de tamanho.

### 1.4 Persistência em `.twrecipe`

`packages/core/src/recipe.ts` recebeu campos opcionais de apresentação:

- `chartTitle`;
- `chartSubtitle`;
- `chartFontFamily`;
- `chartPrimaryColor`;
- `chartAccentColor`;
- `chartBackgroundColor`;
- `chartShowLegend`;
- `chartShowValueLabels`;
- `chartDecimalPlaces`;
- `chartXColumnKey`;
- `chartYColumnKey`.

O parser valida:

- enum de fonte;
- cores hexadecimais `#RRGGBB`;
- limites de título/subtítulo;
- booleanos;
- casas decimais 0–6;
- bindings não vazios.

`apps/web/src/main.ts` salva e restaura todos esses campos. Os bindings são restaurados somente depois de o resultado existir e de os `select`s terem sido preenchidos com as colunas reais.

### 1.5 Wiring da UI

`apps/web/src/main.ts` agora:

- preenche X/Y a partir das colunas do resultado;
- preserva seleções válidas durante rerender;
- desabilita bindings quando a família não é pontos/bolhas;
- rerenderiza o SVG imediatamente ao editar texto, cores, fonte, casas, legenda, rótulos ou bindings;
- mantém o título acessível (`<title>` / `aria-label`) separado do título visual.

### 1.6 CSS responsivo

`apps/web/src/styles.css` recebeu o grid do editor, controles de cor/toggle e quebra para duas colunas em telas pequenas.

## 2. Testes que eu acrescentei

`tests/chart.test.mjs`:

- teste de `scatterDataFromResult` com X=2024 e Y=2025;
- comprova X/Y, total da linha e binding inexistente retornando vazio.

`tests/core.test.mjs`:

- rejeita fonte de gráfico inválida;
- rejeita cor não hexadecimal;
- rejeita casas decimais fora do limite.

## 3. Verificações executadas aqui

Passaram:

- `tests/chart.test.mjs`: **3/3**;
- `tests/core.test.mjs`: **25/25**;
- typecheck focado de `chart-renderer.ts`, `chart-model.ts` e `core/model.ts`: **PASS**;
- typecheck focado de `recipe.ts`, `plan.ts` e `model.ts`: **PASS**;
- transpile/syntax check de `apps/web/src/main.ts`: **PASS**;
- `scripts/verify-e2e-contract.mjs`: **24 anchors, PASS**;
- verificação de IDs do editor: nenhum ID duplicado e nenhum ID esperado ausente.

O `tsc -p tsconfig.json` e o `tsc -p web.tsconfig.json` completos não puderam ser validados neste ambiente porque o snapshot não traz `node_modules` e faltam `@precisa-saude/datasus-dbc`, `fflate` e `vite/client`. O build chegou a emitir o código dos módulos locais; os testes focados acima rodaram sobre esse emit. `dist/` foi removido depois e não faz parte do snapshot entregue.

## 4. O que eu deliberadamente NÃO implementei — Claude deve continuar daqui

Esta Faixa 4.2 **não está fechada**. Próxima ordem sugerida:

1. **Eixos avançados:** mínimo/máximo manual, ticks, grade, rótulo dos eixos e validação `max > min`.
2. **Zoom/reset:** preferencialmente manipulando viewBox/viewport do gráfico, não CSS scale; incluir teclado, wheel/touchpad e touch.
3. **Impressão por família:** o `@media print` atual força `#table-view`; criar modo de impressão do gráfico atual sem quebrar a impressão integral da tabela virtualizada.
4. **Legenda multissérie real:** hoje a legenda fora de pizza é uma chave de série única; o renderer ainda reduz cada linha para total na maioria das famílias.
5. **Binding de tamanho para bolhas:** hoje X/Y são explícitos, mas o tamanho usa `row total`.
6. **Fonte avançada:** tamanho/peso por título, rótulo e ticks se isso continuar no escopo.
7. **Empty chart/composition workflow** catalogado no inventário legado.
8. **Snapshots visuais determinísticos / goldens de apresentação** depois de estabilizar opções.
9. **Oracle TabWin 4.15** somente para comportamentos que afetem compatibilidade de artefato; estes novos controles são modernos até prova em contrário.

## 5. Pontos que Claude deve revisar antes de expandir

- O checkbox de rótulos nasce ligado para preservar a informação numérica que já aparecia em barras horizontais/setas; isso também adiciona rótulos às outras famílias. Decidir se o default deve virar específico por família antes de congelar UX.
- Com título/subtítulo, barras horizontais exibem 14 itens em vez de 16 e setas 12 em vez de 14 para não ultrapassar o `viewBox` de 1000×500. Se Claude introduzir layout/zoom melhor, pode remover essa compensação.
- Texto usa cores de tinta fixas; fundo escuro ainda não calcula contraste automaticamente.
- Pontos/bolhas em modo XY incluem zero no domínio por padrão; eixos manuais devem substituir essa política de forma explícita.
- Não mover opções de apresentação para `QueryPlan`: elas pertencem à camada de visualização/recipe e não devem alterar o motor de tabulação.

## 6. Arquivos alterados neste corte

- `apps/web/index.html`
- `apps/web/src/chart-renderer.ts`
- `apps/web/src/main.ts`
- `apps/web/src/styles.css`
- `packages/visualization/src/chart-model.ts`
- `packages/core/src/recipe.ts`
- `tests/chart.test.mjs`
- `tests/core.test.mjs`
- `docs/product/ROADMAP_POR_COMPLEXIDADE.md`
- `docs/handoffs/R10_4_CHART_EDITOR_CHATGPT_START.md` (este arquivo)

## 7. Critério de handoff

Claude pode considerar este corte aceito se, no ambiente dele com dependências instaladas:

```text
npm run check
```

passar e uma inspeção manual confirmar:

- editar título/cor/fonte atualiza o gráfico sem rerodar a tabulação;
- salvar e reabrir `.twrecipe` restaura estilo;
- pontos/bolhas com dois bindings usam valores das colunas escolhidas;
- limpar um dos bindings retorna ao modo por ordem das linhas;
- SVG e PNG refletem as mesmas opções visuais da tela.

**Não marcar 4.2 como concluído após este corte.**
