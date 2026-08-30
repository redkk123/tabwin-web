# TabWin Web

Reimplementação moderna, local e auditável dos fluxos analíticos do DATASUS
TabWin. A aplicação roda no navegador: Windows, macOS e Android usam a mesma
interface, e os microdados permanecem no aparelho.

**Aplicação:** <https://redkk123.github.io/tabwin-web/>

> Esforço independente e não oficial de modernização. Não é afiliado ao DATASUS
> nem ao Ministério da Saúde, e não é endossado por eles.

## O que já funciona

**Leitura e tabulação**

- DBC e DBF lidos localmente, sem servidor;
- CSV/TSV com inferência numérica conservadora;
- `.DEF` completo (A/S/L/C/Q/D/T/I/G/R), com posição inicial e frequência
  agrupada;
- `.CNV` clássico e o formato novo `N`, incluindo subtotais e faixas numéricas;
- frequência, soma, medidas múltiplas, linhas, colunas, filtros combinados e
  supressão de zeros;
- receitas reproduzíveis `.twrecipe` e tabelas portáteis `.twtable`.

**Apresentação**

- oito famílias de gráfico, com eixos, limites manuais, séries por coluna,
  legenda, cores, zoom e impressão;
- mapas temáticos com quebras manuais, camadas de referência, sedes, legendas
  discretas e seleção espacial que vira filtro;
- estatística descritiva, correlação de Pearson, regressão simples e histograma;
- fluxos origem–destino com diagnóstico de descarte e distância sob modelo
  explícito.

**Dados oficiais**

- catálogo do DATASUS dentro do aplicativo, sem R e sem FTP manual;
- cache local visível, removível e reabrível offline;
- URL de origem, hora da coleta e hash do ZIP registrados na auditoria;
- exportação Microdatasus: CSV com exatamente o subconjunto da tabulação ativa.

## Compatibilidade com o TabWin 4.15

O projeto **não** declara equivalência completa. Cada afirmação de
compatibilidade vale só até onde um caso golden capturado no programa de
referência sustenta.

Hoje são **15 goldens**, todos passando com **tolerância zero**, nenhum
bloqueado e nenhum classificado como divergência deliberada. Um golden nunca é
ajustado para um teste passar; quando o motor discorda do TabWin, quem muda é o
motor.

A metodologia está em [`docs/testing/`](./docs/testing/), e cada caso resolvido
tem relatório em [`docs/handoffs/`](./docs/handoffs/).

## Rodar

```bash
npm ci
npm run check
```

`check` roda os testes, o typecheck do navegador e o build de produção. Para os
testes de ponta a ponta:

```bash
npx playwright install chromium && npm run e2e
```

## Estrutura

```text
apps/web/               aplicação do navegador
apps/datasus-proxy/     proxy opcional, restrito às rotas oficiais
packages/core/          semântica de tabulação, QueryPlan, executor, receitas
packages/formats/       formatos legados (.CNV, .DEF, .MAP, .TAB)
packages/acquisition/   descoberta e requisição das fontes oficiais
packages/analysis/      estatística, qualidade de dados, fluxos espaciais
packages/export/        exportações determinísticas
packages/visualization/ modelos de gráfico e mapa
tests/                  testes de compatibilidade semântica
e2e/                    Playwright
fixtures/golden/        casos golden capturados no TabWin 4.15
scripts/                aquisição, verificação e medição
docs/                   arquitetura, metodologia, roadmap e engenharia reversa
```

## Regra de ouro

Toda capacidade é classificada como:

1. **COMPAT** — necessária para reproduzir um resultado ou fluxo do TabWin;
2. **UX** — moderniza como um fluxo existente é feito;
3. **INOVAÇÃO** — acrescenta capacidade sem mexer na semântica de
   compatibilidade.

Controles modernos de apresentação são inovação, e nenhum deles altera a
tabulação, o total ou o que é exportado como tabela.

## Estado e continuidade

A memória viva do projeto está em [`PROJECT_STATE.json`](./PROJECT_STATE.json) e
em [`CHECKPOINT_MASTER.md`](./CHECKPOINT_MASTER.md); o roadmap por complexidade
está em
[`docs/product/ROADMAP_POR_COMPLEXIDADE.md`](./docs/product/ROADMAP_POR_COMPLEXIDADE.md).
