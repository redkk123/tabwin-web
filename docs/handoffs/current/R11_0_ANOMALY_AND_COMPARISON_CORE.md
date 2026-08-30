# R11.0 — Núcleo de auditoria estatística e comparação de tabelas

**Data:** 2026-08-30
**Estado:** núcleo integrado e testado. Orquestrador, pipeline de
transformação, fórmulas e UI de auditoria **não existem ainda** — isso é
trabalho de várias faixas futuras (R11.1–R11.6), não desta.
**Fonte:** `docs/product/TABWIN_WEB_MASTER_PRE_UI_R11_2.md`, spec de 3.656
linhas do ChatGPT com dois módulos pré-implementados anexados.

## Por que só o núcleo

O spec cobre seis frentes — transformação/limpeza, fórmulas estilo Excel,
comparação de tabelas, auditoria estatística automática, e uma faxina do
repositório — e o próprio autor as ordena em sete cortes (R11.0 a R11.6) mais
uma passada de UI. Isso é semanas de trabalho especificado com cuidado. Fazer
tudo de uma vez, rápido, produziria exatamente o que o spec pede para evitar:
heurística virando regra clínica, UI mascarando semântica incompleta.

Esta rodada entrega o que dá para fazer com qualidade agora: os dois módulos
que o ChatGPT já tinha escrito e testado, revisados, integrados ao repositório
real, e uma peça nova que o dono do projeto pediu à parte — a gaussiana.

## O que veio do ChatGPT, e como passou pela revisão

### `packages/analysis/src/statistical-anomaly.ts`

Aplicado sem alteração de lógica, com uma correção pontual (abaixo). Contém:

- **Sumário robusto** — quartis, IQR, MAD;
- **Outlier numérico** — z-modificado por MAD (`0,67448975 * (x-mediana)/MAD`),
  com fallback para `IQR/1,349` quando MAD é zero, e sem produzir score
  nenhum quando os dois são zero;
- **Scanner temporal Hampel** — janela local, `log1p` por padrão para séries
  de contagem;
- **Comparação de distribuições** — Jensen-Shannon, variação total, maior
  diferença de share, log2-lift por categoria;
- **Perfil de concentração** — HHI, entropia normalizada;
- **Duas proporções** — IC de Wilson, diferença de risco, RR, OR, p de
  triagem (aproximação de Abramowitz-Stegun para a normal padrão);
- **Benjamini-Hochberg**.

Cada assinatura devolve evidência de efeito — `score` é textualmente
documentado como "força de evidência, NÃO probabilidade de erro" no próprio
tipo, e `automaticAction: 'none'` está fixado no tipo `StatisticalSignal`.
Nada aqui decide, sozinho, que um registro está errado.

### `packages/analysis/src/table-comparison.ts`

Também aplicado sem alteração. `inner`/`left`/`right`/`full`, casamento por
chave exata (padrão obrigatório), rótulo normalizado ou mapa explícito entre
linhas, chave duplicada lançando erro em vez de agregar em silêncio,
diagnóstico de cobertura antes de qualquer métrica, e denominador zero
resultando em `null` — nunca um zero inventado.

## O defeito que a revisão achou

`wilsonInterval95(0, 100)` devolvia `3,469446951953614e-18` em vez de `0`
exato — resíduo de ponto flutuante de `center - half` quando os dois quase se
cancelam no limite da distribuição binomial. Um número desses num relatório
lido por um pesquisador lê como matemática quebrada, não como zero.

A correção usa o mesmo padrão que `resolveAxis` já usa em `chart-model.ts`
para o mesmo tipo de problema (limpar `0.30000000000000004` de um eixo):
arredondar para um número fixo de casas em vez de dígitos significativos —
`toPrecision` não resolve aqui porque um resíduo já pequeno continua "correto"
em dígitos significativos, só não em casas decimais. `Math.round(valor *
1e12) / 1e12` resolve.

Teste de regressão acrescentado: `events=0` e `events=total` devem devolver
`0` e `1` exatos, não um valor "próximo".

## O que foi pedido à parte: gaussiana sobre os dados

`packages/analysis/src/statistics.ts` ganhou três funções:

- `fitGaussian(valores)` — média e desvio-padrão amostral. Lança
  `'requires at least two finite values'` para menos de dois valores e
  `'undefined for a constant series'` quando todos são iguais — dois erros
  distintos, não um genérico, porque são diagnósticos diferentes para quem lê;
- `gaussianDensity(x, ajuste)` — a densidade normal padrão fechada;
- `gaussianOverlay(bins, ajuste)` — contagem esperada por classe do
  histograma, aproximando a integral pela densidade no ponto médio vezes a
  largura da classe.

**É uma curva de referência descritiva, não um teste de normalidade.** Nada
aqui classifica a distribuição como normal ou não — é exatamente o princípio
que o resto da faixa 4.13 exige para os detectores de anomalia, aplicado aqui
também.

### Ligação com a UI

Um checkbox "Sobrepor gaussiana" aparece só quando a operação é Histograma.
Quando marcado, desenha um traço vertical roxo em cada barra na posição da
contagem esperada sob a curva ajustada, com o valor no `title` do elemento.
Quando o ajuste é indefinido (poucos ou nenhum valor distinto), a sobreposição
não desenha nada e o painel escreve por quê — nunca falha em silêncio.

Verificado visualmente no navegador: com dados `[1,2,3,2,1]` a sobreposição
desenha cinco marcas, uma por classe, com a marca mais alta na classe que
contém a média ajustada.

## Verificação

- `npm run check`: **304/304** (eram 291).
- 8 testes do ChatGPT sobre os dois módulos: PASS, sem alteração de lógica.
- 1 teste novo sobre a borda do Wilson: PASS.
- 4 testes novos sobre a gaussiana (ajuste, densidade, sobreposição, bordas
  de erro): PASS.
- `npm run e2e`: **12/12**, com um caso novo cobrindo o checkbox ligado e
  desligado, e o caminho de "não pôde ser ajustada" quando há um único valor.

## O que continua fora, e por quê

Tudo que o spec descreve nas seções 4 a 26 e não está listado acima:
orquestrador de detecção, UI de auditoria (tela de escopo, fila de sinais,
drill-down), pipeline de transformação inteiro (`select`/`filter`/`mutate`/
`recode`/`missing`/`dedupe`/`bind`/`join`/`group by`), registro de funções
estilo Excel, e a UI de comparação de tabelas. O documento completo está em
`docs/product/TABWIN_WEB_MASTER_PRE_UI_R11_2.md` para quem for atacar a
próxima faixa.
