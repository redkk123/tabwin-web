# R11.3 — Orquestrador de auditoria estatística + aba "Investigar"

**Data:** 2026-08-30
**Estado:** concluída. Gate **311/311**, E2E **16/16**.

## O que existia e por que não bastava

`packages/analysis/src/statistical-anomaly.ts` (R11.0) já tinha os
detectores — cercas de Tukey/MAD, JSD/TVD entre distribuições, perfil de
concentração, IC de Wilson — mas como primitivas isoladas, cada uma
esperando que alguém já tivesse separado "grupo" de "referência" e chamado a
função certa pelo campo certo. Não havia nada que rodasse os detectores
certos para cada campo, decidisse o que vale a pena reportar, e devolvesse
algo pronto para uma tela. E não havia tela nenhuma.

## Decisão de design: o grupo é o que a sessão já tem, não algo novo

"Grupo investigado" não é um conceito novo que o usuário aprende — é
`configuredFilters` + `configuredCrossFieldRules`, exatamente como já
existem para tabulação e limpeza. "Referência" é sempre "o resto do
conjunto aberto que passa nas mesmas regras de exclusão" — o comparador mais
simples que o próprio spec do ChatGPT chama de default útil (seção 9.1).
Isso significou que `matchesFilters()` precisou existir em
[`packages/core/src/execute.ts`](../../../packages/core/src/execute.ts) —
a mesma pergunta de aceitação que `resolvePlanRecord` já resolve, mas sem
também exigir que linhas/colunas do plano resolvam, porque o grupo de uma
auditoria é um filtro sozinho, independente do que está sendo tabulado.

## `anomaly-orchestrator.ts`: um passe de streaming, cinco formatos de sinal

[`packages/analysis/src/anomaly-orchestrator.ts`](../../../packages/analysis/src/anomaly-orchestrator.ts)
acumula grupo e referência num único passe (`push(records)` chamado por
lote, como todo consumidor do Worker), e no `finish()` roda, por campo:

- **numérico** — outlier na própria distribuição do grupo (cerca robusta) e,
  se há referência, divergência de mediana/IQR entre grupo e referência;
- **categórico** — mudança de distribuição (Jensen-Shannon/variação total) e
  concentração incomum (share da maior categoria do grupo bem acima da
  referência, com menos categorias distintas) — reportada como
  `geographic-concentration` se o campo estiver em `geographyFields`,
  `subgroup-divergence` caso contrário;
- **ausência** — diferença de taxa de ausência com IC de Wilson, só quando o
  grupo tem tamanho mínimo (20) para a diferença de risco significar algo
  além de ruído, nunca só porque N torna qualquer diferença "significativa".

Um campo que precisaria reter mais que `maxRetainedNumericValues` valores
numéricos é **pulado com aviso nomeado**, nunca amostrado em silêncio —
mesmo padrão que `data-quality.ts` já usa. Cardinalidade categórica acima de
`maxCategoricalCardinality` (2.000 por padrão) dobra o excedente num bucket
`OTHER_CATEGORIES_KEY` em vez de deixar a contagem de categorias explodir.

### Defeito real encontrado e corrigido: o sentinel do bucket de transbordo

`OTHER_CATEGORIES_KEY` deveria ser um texto com prefixo intencional
impossível de colidir com um valor real de campo. Na escrita original, o
prefixo virou um **byte NUL cru** em vez do texto pretendido — invisível em
qualquer editor, e sem nada que o traduzisse para um rótulo legível antes de
ele poder, em tese, cair dentro de uma explicação mostrada ao usuário (o
sinal de concentração interpola `topKey` diretamente na frase). Corrigido
com `categoryDisplayLabel()`, exportado e testado isoladamente.

A prova, ao tentar montar um teste ponta a ponta para esse caminho, mostrou
algo mais interessante: **é estruturalmente impossível** o sinal de
concentração disparar com o bucket de transbordo como categoria líder do
grupo, porque grupo e referência compartilham o mesmo teto de
cardinalidade — uma vez que o grupo transborda, seu `distinct` pós-corte é
exatamente `cap + 1`, e o da referência nunca pode superar esse mesmo teto,
então a condição `distinct(grupo) < distinct(referência)` nunca se sustenta
nesse cenário. O teste de unidade cobre a tradução isoladamente por esse
motivo, documentado no próprio código-fonte para não ser "corrigido" de
volta por engano depois.

## A tela: "Investigar", não "Auditoria"

"Auditoria" já existe e é outra coisa — o log de tabulação/trilha
reproduzível. A nova aba pergunta: campos numéricos, categóricos e
geográficos (subconjunto dos categóricos) por seleção múltipla. Rodar exige
ao menos um filtro ativo — sem grupo definido não há o que comparar, e a
interface recusa com uma mensagem (`investigate-gate-message`) em vez de
rodar contra o conjunto inteiro sozinho.

Cada `StatisticalSignal` vira um cartão com:

- selo de severidade (`info`/`review`/`strong`, cores herdadas da paleta já
  usada em `flag`/`exclude`);
- placar `N/100` com a legenda fixa **"força da evidência, não
  probabilidade de erro"** — nunca escondida atrás de um tooltip;
- explicação e evidência numérica, ambas do próprio sinal;
- **"Focar campo"** — em vez de a auditoria inventar limites de filtro por
  conta própria a partir só dos números de evidência (um risco real: um
  outlier isolado não diz onde ficaria uma cerca honesta), o botão abre a
  ferramenta que **já existe e já é testada**: Qualidade (com o perfil real
  do campo, incluindo sugestão de IQR) para numérico, Filtro (com as
  categorias reais do dado) para categórico — e abre o `<details>`
  recolhido em que cada uma vive, senão o salto seria invisível;
- **"Marcar como esperado"** — dispensa local à sessão (um `Set` de ids em
  memória, nunca persistido), sobrevive a uma nova rodada de varredura no
  mesmo campo/grupo, e some ao trocar de conjunto de dados.

## Verificação

- `npm run check`: **311/311** (310 do núcleo + 1 nova, a tradução do
  sentinel).
- `npm run e2e`: **16/16**, com um caso novo
  ([`e2e/app.spec.ts`](../../../e2e/app.spec.ts), fixture
  [`e2e/fixtures/investigate-e2e.csv`](../../../e2e/fixtures/investigate-e2e.csv))
  que planta 40 registros de referência difusos e 20 registros de grupo
  concentrados (18/20 num único município, mais um outlier numérico
  isolado), e confere: o portal recusa rodar sem grupo e sem campos com a
  mensagem certa em cada caso; o sinal de concentração aparece com o **nome
  real** da categoria (nunca o sentinel); o outlier numérico aparece; "Focar
  campo" preenche o filtro certo; "Marcar como esperado" esconde o cartão,
  oferece "Restaurar", e o cartão continua escondido numa nova rodada até
  ser restaurado.
- Verificação visual manual no navegador com um dataset sintético separado
  reproduziu o mesmo comportamento antes de o teste automatizado existir —
  incluindo o achado de um segundo defeito, mais simples: o `<details>` que
  contém o filtro de Qualidade não abria sozinho ao clicar "Focar campo",
  então o campo era selecionado sem que o usuário visse nada mudar. Corrigido
  junto (`revealControl()`).

## O que não entrou, e por quê

`geographyFields` continua sendo o usuário quem declara quais campos
categóricos são "geografia" — não há heurística de nome de coluna
adivinhando isso. Um segundo grupo de referência explícito (comparar grupo A
contra grupo B, em vez de grupo contra "o resto") não existe: o spec já
chama isso de extensão natural, não do corte inicial. Nenhum dos dois foi
pedido nesta rodada.
