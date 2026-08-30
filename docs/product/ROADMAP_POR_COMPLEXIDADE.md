# Roadmap do que falta, ordenado por complexidade

## Decisão estrutural de 2026-08-30 — três trilhas, não uma fila

**Status: DECIDIDO.** Análise em
`docs/product/DECISAO_DUCKDB_NAVEGADOR.md`, revisada pelo ChatGPT e aprovada
pelo dono do projeto.

O projeto deixa de ser uma fila única de faixas e passa a ter **três trilhas
permanentes**, com dependências explícitas entre elas:

```text
                      TABWIN WEB
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
 TABULAÇÃO COMPATÍVEL                EXPLORAÇÃO AVANÇADA
     COM TABWIN                        DE MICRODADO
        │                                   │
 executor próprio                     DuckDB WASM
 DEF / CNV / lookup / startPosition    SQL / joins / window
 goldens, .TAB, .MAP                   sob demanda
        │                                   │
        └─────────────────┬─────────────────┘
                          │
                     EPIDEMIOLOGIA
            denominadores, taxas, IC, padronização
```

### Trilha 1 — Compatibilidade TabWin

Autoridade única sobre `DEF`, `CNV`, lookup DBF, `startPosition`,
unclassified e goldens. **Não depende do DuckDB e nunca vai depender.**
Continua sendo o motor que responde por qualquer alegação de equivalência.

### Trilha 2 — Exploração de microdado

DuckDB WASM, **carregado sob demanda**. É deliberadamente *outro produto
dentro do produto*, não um segundo executor da trilha 1.

- **Nome na interface: "Explorar microdados"**, não "SQL" nem "DuckDB". O
  usuário comum não precisa saber o nome do motor.
- O carregamento é anunciado antes de acontecer: *"O módulo é carregado no
  dispositivo quando aberto pela primeira vez."*
- **Fronteira de produto, não limitação escondida.** Todo resultado carrega
  a procedência do motor, e ela **entra na receita**:

```text
  Exploração:                    Tabulação oficial:
    Motor: DuckDB                  Motor: Compatibilidade TabWin
    Fonte: microdado bruto         DEF: RD2008.DEF
    DEF/CNV: não aplicados         Conversões CNV: aplicadas
```

Isso não é aviso legal: é **propriedade científica**. Fica impossível
confundir microdado bruto analisado com resultado segundo a semântica do
TabWin.

### Trilha 3 — Epidemiologia

Consome a saída das duas outras. **Não depende da decisão do DuckDB** e pode
começar antes dela.

---

## 4.11 Exploração de microdado (trilha 2)

**Motivação registrada do dono do projeto:**

> "sobre a ideia do microdatasus, era pra ter mais filtros pro usuário, saca?
> a nível do que tu consegue fazer com o R"

A exportação Microdatasus (4.9) entregou a **saída**: o CSV é exatamente o
subconjunto da tabulação. O que falta é a **entrada** — poder chegar num
subconjunto que os dois filtros atuais (categorias e faixa numérica) não
alcançam.

Ordem, do mais para o menos justificado:

1. **campos derivados** — `CASE WHEN`, aritmética, diferença de datas;
2. **expressão derivada como filtro** — `VAL_TOT / DIAS_PERM > x`;
3. **padrão textual** — `PROC_REA LIKE '04%'`, CID malformado;
4. **funções de data** — `YEAR()`, `MONTH()`, intervalos, diferença temporal;
5. **`group_by` arbitrário** — mais de duas dimensões;
6. **filtro pós-agregação (`HAVING`)** — "municípios com mais de 100";
7. **janela / percentil** — "os 10% mais caros";
8. **deduplicação** por chave escolhida;
9. **`JOIN`** com tabela auxiliar trazida pelo usuário.

**Tirado da lista por revisão:** "sexo feminino **e** procedimento em lista"
não é capacidade nova — é composição booleana que os filtros de categoria já
fazem por interseção. Vale como melhoria de UX, não como argumento a favor do
DuckDB.

---

## 4.12 Bancada epidemiológica (trilha 3)

**Motivação registrada do dono do projeto:**

> "e eu não vi uma ideia minha aí: estatística avançada"

Hoje existem quatro operações: descritiva, correlação de Pearson, regressão
linear simples e histograma. O salto que interessa não é virar um SPSS. É
sair de

> "o DF teve 12.000 internações"

para

> "o DF teve X por 100 mil habitantes, IC95%, padronizado por idade,
> comparável ao resto do Brasil."

Ordem acordada, por valor epidemiológico real e **não** por sofisticação:

| # | Item | Nota |
| --- | --- | --- |
| 1 | **Denominadores populacionais do IBGE** | tratado como capacidade própria, não como detalhe |
| 2 | **Taxas com IC** | por 100 mil, com intervalo |
| 3 | **Padronização direta por idade** | o item de maior valor da lista |
| 4 | Proporções com IC | |
| 5 | RR / OR com IC | |
| 6 | Qui-quadrado e Fisher | tabela de contingência |
| 7 | Série temporal e tendência | |
| 8 | Padronização indireta / SMR | |
| 9 | Regressão logística múltipla | |
| 10 | Regressão linear múltipla | |

### População padrão: default declarado, nunca invisível

O princípio acordado é literal: **default pode existir; default invisível
não.**

```text
População padrão
  ● Brasil [versão / fonte]
  ○ OMS 2000–2025
  ○ Personalizada
```

E o resultado sempre carrega, sem opção de esconder:

> Padronização direta por idade · População padrão: Brasil — [fonte, versão]

Isso entra na receita. **Antes de congelar qual padrão brasileiro**, é
preciso uma rodada própria de evidência e documentação: isso vira parte da
metodologia científica da ferramenta, não uma constante no código.

## 4.13 Auditoria estatística, comparação, transformação e fórmulas

**Estado em 2026-08-30: NÚCLEO, ORQUESTRADOR, UI DE INVESTIGAÇÃO, UM PRIMEIRO**
**PIPELINE DE TRANSFORMAÇÃO E AS FÓRMULAS ESTILO EXCEL INTEGRADOS**
**(R11.0–R11.5); FALTA A TRILHA DE EPIDEMIOLOGIA (R11.6).** Especificação
completa em `docs/product/TABWIN_WEB_MASTER_PRE_UI_R11_2.md` (recebida do
ChatGPT como spec de engenharia + pré-implementação de núcleo). Esse
documento tem 3.656 linhas e cobre seis frentes — aquisição, limpeza,
fórmulas, comparação, auditoria estatística e faxina — que, pelo próprio
roteiro dele (R11.0 até R11.6, mais UI final), são semanas de trabalho.
**Isso não foi implementado inteiro nesta passada**, e dizer o contrário
seria falso. O que foi feito:

- `packages/analysis/src/statistical-anomaly.ts` — cercas de Tukey e
  z-modificado por MAD, scanner temporal Hampel, JSD/TVD entre distribuições,
  perfil de concentração (HHI/entropia), IC de Wilson, RR/OR, triagem de duas
  proporções e ajuste Benjamini-Hochberg. Todo detector devolve evidência de
  efeito, nunca uma declaração de erro — `automaticAction: 'none'` está no
  próprio tipo.
- `packages/analysis/src/table-comparison.ts` — `inner`/`left`/`right`/`full`,
  casamento por chave exata (padrão), rótulo normalizado ou mapa explícito,
  chave duplicada como erro, denominador zero como `null` explícito nunca
  como zero inventado, e diagnóstico obrigatório de cobertura antes de
  qualquer métrica.
- Revisão encontrou um defeito real: `wilsonInterval95(0, total)` devolvia
  `3,47e-18` em vez de `0` exato — resíduo de ponto flutuante que apareceria
  como "erro de matemática" num relatório. Corrigido com o mesmo padrão de
  `tidy()` que `resolveAxis` já usa em `chart-model.ts`.
- Ambos compilam limpo em `strict` + `exactOptionalPropertyTypes` +
  `noUncheckedIndexedAccess` e têm 9 testes (8 do ChatGPT + 1 da borda do
  Wilson) passando.
- **Gaussiana sobre histograma**, pedido à parte: `fitGaussian`,
  `gaussianDensity` e `gaussianOverlay` em `statistics.ts`. É referência
  descritiva — "como seria uma normal com esta média e este desvio" — nunca
  um teste de normalidade; não classifica nem sinaliza a distribuição. Um
  ajuste indefinido (menos de dois valores, ou todos iguais) não desenha nada
  e o painel diz por quê, em vez de falhar em silêncio. Ligado à UI de
  Estatística: um checkbox "Sobrepor gaussiana" desenha um traço por classe do
  histograma, com o valor esperado no `title`.
- **R11.2 — UI de comparação de tabelas, sobre o núcleo já testado.** Nova
  aba "Comparar": A é sempre o resultado atual; B é aberto de um `.twtable`
  salvo separadamente, nunca mesclado a A. Junção
  `inner`/`left`/`right`/`full`, casamento por chave exata ou rótulo
  normalizado, pares de coluna com auto-sugestão por chave igual (e reversão
  para o par único quando as duas tabelas têm uma coluna só), diagnóstico de
  cobertura e rótulos divergentes antes de qualquer número, denominador zero
  mostrado como "—" nunca como zero inventado, e export CSV. **O plano de
  comparação ainda não entra na receita** — dito explicitamente na própria
  interface, não escondido.

- **R11.3 — Orquestrador de auditoria estatística + aba "Investigar".**
  `packages/analysis/src/anomaly-orchestrator.ts` roda os detectores do
  núcleo sobre um "grupo" (os filtros e regras cruzadas já ativos na sessão)
  contra a "referência" (o resto do conjunto aberto), num único passe de
  streaming, e devolve `StatisticalSignal[]` prontos para exibição: outlier
  numérico (cerca robusta), divergência de subgrupo (mediana/IQR), mudança de
  distribuição categórica (Jensen-Shannon/variação total), concentração
  geográfica ou de subgrupo (HHI/share da maior categoria), e diferença de
  ausência (IC de Wilson, com piso de N mínimo para uma diferença minúscula
  não "significar" só porque N é gigante). A estatística aponta estranheza;
  ela não decide se é erro — isso fica com quem conhece o dado, e a
  interface diz isso explicitamente, não só no texto de apoio.

  Nova aba **"Investigar"** (distinta de "Auditoria", que é o log de
  tabulação/trilha reproduzível): campos numéricos, categóricos e
  geográficos por seleção múltipla; rodar exige ao menos um filtro ativo —
  sem grupo definido não há o que comparar, e a interface recusa com uma
  mensagem em vez de rodar contra o conjunto inteiro. Cada sinal vira um
  cartão com severidade, placar ("força da evidência, não probabilidade de
  erro", nunca escondido), explicação, evidência numérica, um botão "Focar
  campo" — que abre a ferramenta certa **já testada** (Qualidade, com IC
  real da própria distribuição, para numérico; Filtro, com as categorias
  reais, para categórico) em vez de a auditoria inventar limites por conta
  própria — e "Marcar como esperado" (dispensa local à sessão, nunca ao
  arquivo; sobrevive a uma nova rodada de varredura, mas nunca ao arquivo
  reaberto).

  Revisão encontrou e corrigiu um defeito real antes de qualquer uso: o
  bucket de transbordo de cardinalidade categórica (`OTHER_CATEGORIES_KEY`)
  carregava um byte NUL cru em vez do texto pretendido, sem nada que
  traduzisse esse valor para um rótulo legível antes de ele poder, em tese,
  aparecer dentro de uma explicação mostrada ao usuário. Corrigido com um
  rótulo dedicado e testado; a prova mostrou que o sinal que usa essa chave
  é estruturalmente incapaz de disparar com o bucket como categoria líder
  (grupo e referência compartilham o mesmo teto de cardinalidade), então o
  teste cobre a tradução em isolamento, não uma ponta a ponta forçada.

  `npm run check`: **311/311**. `npm run e2e`: **16/16**, com um caso novo
  que planta uma concentração real (18/20 registros do grupo num único
  município) e confere: o sinal aparece com o nome real da categoria (nunca
  o sentinel interno), "Focar campo" abre e preenche o filtro certo, e
  "Marcar como esperado"/"Restaurar" funcionam mesmo depois de uma nova
  rodada de varredura.

- **R11.4 — Pipeline de transformação, primeiro corte.**
  `packages/core/src/transform-pipeline.ts`, cinco tipos de etapa
  (`select-columns`/`filter-rows`/`recode`/`missing-value-policy`/`dedupe`),
  ao estilo do que o Wanderson ensina em R/dplyr (ver conversa com o ChatGPT
  em 2026-08-30). Cada etapa valida e roda contra o schema **como ele está
  naquele ponto do pipeline** — um `select-columns` antes pode derrubar um
  campo que uma etapa depois dependa, e isso falha com uma mensagem clara
  em vez de operar sobre `undefined`. Aplicação é tudo-ou-nada: a primeira
  etapa inválida cancela o pipeline inteiro, nenhum resultado parcial.
  Aplicar **substitui o conjunto ativo da sessão**, como o "Combinar" já
  faz — mesmo uma fonte binária normalmente decodificada por streaming vira
  residente uma vez transformada, porque uma etapa pode reescrever valores
  de um jeito que nada a jusante desfaz. "Restaurar dados originais" reabre
  os arquivos sem aplicar nada; as etapas continuam na lista. Achado e
  corrigido antes de qualquer teste existir: a primeira versão reaplicava
  sobre o que já estivesse ativo, então um segundo clique em "Aplicar"
  compunha sobre a própria saída anterior — corrigido para sempre recomeçar
  do arquivo original a cada aplicação.
  Fora desta rodada, com o motivo registrado no handoff: `mutate()` por
  fórmula (o mesmo motor de expressões que R11.5 vai construir — não vale
  fazer duas vezes), `join` de microdados, `bind_rows` (o "Combinar"
  existente cobre o caso comum), `group_by()+summarise()` (a tabulação
  comum já cobre isso), "ver código equivalente" em R/Python, e reexecução
  com detecção de schema drift.
  `npm run check`: **326/326**. `npm run e2e`: **17/17**.

- **R11.5 — Fórmulas estilo Excel, sem virar Excel.** O parser de expressões
  que já existia (números, colunas, `+ - * / ^`, parênteses) ganhou dois nós
  no AST — chamada de função e comparação — em vez de ser reescrito, que é
  exatamente o caminho que o ChatGPT apontou. **32 funções** em cinco grupos:
  agregação (`SUM`/`AVERAGE`/`MIN`/`MAX`/`MEDIAN`/`COUNT`), aritmética
  (`ABS`/`SQRT`/`POWER`/`EXP`/`LN`/`LOG`/`LOG10`), arredondamento
  (`ROUND`/`ROUNDUP`/`ROUNDDOWN`/`TRUNC`/`INT`), lógica
  (`IF`/`IFS`/`AND`/`OR`/`NOT`/`IFERROR`/`ISNUMBER`) e **epidemiologia**
  (`RATE`/`PERCENT`/`RATIO`/`CHANGE`/`PCTCHANGE`/`LAG`/`ZSCORE`). Mais
  comparações (`< > <= >= = <>`), `=` inicial opcional, `;` como separador, e
  apelidos em português (`SOMA`, `MÉDIA`, `SE`, `TAXA`, `RAZÃO`…).

  As bordas do Excel que valem estar certas foram implementadas uma a uma, não
  por apelido: as quatro funções de arredondamento discordam entre si em
  negativos (`ROUND(−2,5) = −3` como no Excel, não `−2` como o `Math.round` do
  JavaScript; `INT(−2,7) = −3` mas `TRUNC(−2,7) = −2`), `LOG` tem base 10 por
  padrão, e arredondar casas decimais desloca o expoente decimal em vez de
  multiplicar por potência de dez — `2,345 * 100` é `234,49999999999997` em
  binário, e a versão ingênua responderia `2,34` onde o Excel responde `2,35`.

  `LAG` e `ZSCORE` leem a coluna inteira, então o avaliador passou a receber
  todas as linhas, e esses argumentos são obrigados a ser referência de coluna
  nua (checado no parse). `ZSCORE` reusa o mesmo desvio-padrão amostral do
  painel de Estatística, para os dois nunca discordarem. `LAG` na primeira
  linha **falha** em vez de devolver zero — não existe linha anterior, e
  inventar uma fabricaria um dado; `IFERROR(LAG([X]); 0)` é a saída explícita.
  As funções que dividem respeitam a mesma política `Interromper`/`Usar zero`
  que a operação já expõe.

  Segurança: nada avalia texto como código. Todo nome chamável precisa estar
  no registro, e qualquer outro é recusado **por nome, no parse**
  (`unknown function eval`). O catálogo que alimenta o painel "Funções
  disponíveis" e o autocomplete é tipado como registro **total** sobre os
  nomes reais, então uma função sem documentação não compila e a lista que o
  usuário lê nunca diverge da que o parser aceita.

  **Fora, por decisão:** `COUNTIF`/`CONT.SE` — o contrato dela é intervalo +
  critério, e fingir isso sobre uma linha só daria ao nome um significado que
  um usuário de Excel leria errado. Também fora: `PROCV`/`VLOOKUP`,
  referências `A1:B35`, macros, e editor de fórmula com destaque de sintaxe.
  **R11.5b, na mesma rodada:** com o motor pronto, o `mutate()` que o R11.4
  tinha deixado de fora virou o passo `derive-column` do pipeline — mesma
  linguagem, endereçada aos campos do registro em vez das colunas de uma
  tabulação. O parser deixou de conhecer `TabulationResult` e passou a
  receber uma lista `{ key, label }`, que as duas formas preenchem. Duas
  decisões explícitas caíram junto: `transform-pipeline.ts` mudou de
  `packages/core` para `packages/analysis` (senão seria a única aresta
  `core → analysis` do repositório, invertendo a regra que todo o resto
  segue), e um campo criado pelo pipeline passou a ter `originalName`
  opcional, com o Worker sintetizando uma coluna numérica — em vez de
  fingir uma origem que não existe.
  `npm run check`: **354/354**. `npm run e2e`: **19/19**.

- **R11.4.2 — Tipos, datas e normalização de texto/código.** Mais três
  tipos de etapa da seção 5.3 do spec, que são exatamente as operações do
  exemplo de limpeza que o ChatGPT desenhou em 2026-08-30.
  `cast-type` converte para número/texto/data com política explícita para o
  que não converter (`keep` não perde nada; `missing` marca), e conta valor
  já vazio separado de falha real. As formas de data aceitas são as que o
  DATASUS entrega (`AAAAMMDD`, `AAAA-MM-DD`, `DD/MM/AAAA`, campo `D` do
  DBF); `20240231` é **recusada** em vez de rolar para março em silêncio,
  e tudo é UTC para uma data não mudar de dia pelo fuso do leitor.
  `date-part` extrai ano/mês/dia/trimestre e **semana epidemiológica** pela
  regra MMWR/MS — semana de domingo a sábado, SE 1 é a que tem pelo menos
  quatro dias em janeiro. Por isso o **ano epidemiológico é coluna à
  parte**: 31/12/2023 é SE 1 de 2024, e 01/01/2021 é a última semana de
  2020. Os dois casos estão ancorados em teste.
  `text-normalize` encadeia `trim`/`upper`/`lower`/`pad-start`/`substring` e
  a ferramenta de **código IBGE** que o ChatGPT pediu por nome: 7 dígitos
  perdem o verificador (`5300108` → `530010`), 5 ou menos recuperam o zero
  à esquerda (`11001` → `011001`), e o que não é código fica **intacto** e
  contado — nunca apagado.
  `npm run check`: **363/363**. `npm run e2e`: **20/20**.

- **R11.4.3 — Agrupar e resumir (`group_by() + summarise()`).** A operação
  que fecha o exemplo da seção 5.4 do spec: colapsa os registros em uma
  linha por combinação das chaves, com `count`/`sum`/`mean`/`median`/`min`/
  `max`/`distinct`. Depois de agrupar, só as chaves e os resumos existem —
  o rastreamento de campo já cuida de fazer uma etapa posterior falhar se
  pedir um campo que sumiu. Um grupo sem valor numérico para uma coluna
  resume como "—", **nunca zero inventado**; o `count` do mesmo grupo
  continua honesto. Uma chave que é campo derivado não ganha origem
  inventada. Fora, por decisão: `proportion` como agregação — proporção de
  quê é decisão de denominador, e com N por grupo pronto a proporção certa
  se escreve como fórmula sobre o resultado, com o denominador explícito.
  `npm run check`: **370/370**. `npm run e2e`: **21/21**.

- **R11.4.4 — "Ver código equivalente" (dplyr / pandas).** Recurso
  pedagógico da seção 5.6 do spec, pedido explicitamente na conversa com o
  ChatGPT: o pipeline renderizado como código R ou Python, **só leitura, uma
  via** — derivado do plano, nunca executado, sem parser de volta. Onde a
  semântica do TabWin Web difere do embutido do alvo (semana epidemiológica,
  código IBGE, funções de fórmula como RATE/ZSCORE/LAG), há um comentário
  dizendo, em vez de uma chamada que calcularia outra coisa. O pipe nativo do
  R exigiu cuidado: notas vão em linhas próprias de comentário e o pipe final
  sempre no último verbo habilitado, para nunca deixar um `|>` pendurado.
  `npm run check`: **378/378**. `npm run e2e`: **22/22**.

- **R11.4.5 — Empilhar bases (`bind_rows`).** A primeira operação do pipeline
  que combina duas fontes: o "Juntar bases" que o ChatGPT destacou
  (`den22 + den23 + den24`). Diferente do "Combinar DBC/DBF" (mesmo esquema,
  pelo Worker), `bind-rows` une esquemas **diferentes** — coluna que só um
  lado tem vira ausente ("—") do outro, nunca valor inventado, nunca
  conversão de tipo silenciosa; coluna de origem opcional. A segunda base
  vem embutida no passo (`PipelineSource`), carregada de um CSV/TSV pela UI
  (DBC/DBF como segunda fonte precisa do Worker, fica para depois). Como
  prerequisito, o Worker passou a **inferir o tipo** de um campo criado pelo
  pipeline inspecionando os valores (numérico quando todos parseiam, texto
  caso contrário) em vez de assumir numérico fixo — o que também conserta
  campos derivados de texto.
  `npm run check`: **384/384**. `npm run e2e`: **23/23**.

**Deliberadamente fora desta passada, e por quê:** a trilha de epidemiologia
completa — denominadores IBGE, taxas padronizadas por idade, intervalos de
confiança, padronização direta (R11.6). As fórmulas acima dão as contas
linha a linha; a trilha é sobre trazer o denominador populacional certo para
dentro do produto, o que é aquisição de dado, não sintaxe.

---

## Limpeza de dados: o que entra e o que não entra

A limpeza assistida **já existe** (perfil numérico com IQR, faixa válida
sugerida e manual, regras cross-field com `flag`/`exclude`, perfil de
combinações raras) e é **não destrutiva por construção**: uma regra vira um
`FilterSpec` marcado com `origin: 'data-quality'`, visível na lista e na
receita, com o dado original intocado.

Fica **fora do caminho principal, por decisão**: **imputação**. O risco é
específico e grave:

```text
ausente → algoritmo escolhe valor → o valor entra na frequência,
na taxa e na regressão → o resultado parece dado do DATASUS
```

Se algum dia entrar, entra numa área chamada **"Transformações analíticas"**,
nunca em "Limpeza", com proveniência por registro
(`IDADE_ORIGINAL = NA`, `IDADE_ANALISE = 47`, método declarado) e marca
visível no resultado. Não está no roadmap atual.

O que **entra** na limpeza, por ter retorno alto e não fabricar informação:
deduplicação por chave, consistência de data (internação depois da saída,
óbito antes da entrada), dígito verificador (CNS, CNPJ) e padrão textual
(CID malformado, procedimento fora da SIGTAP). Três dos quatro são triviais
na trilha 2.

---


**Data:** 2026-08-28
**Para que serve:** o `REMAINING_IMPLEMENTATION_PLAN.md` ordena por bloco
funcional (P0–P5). Este documento ordena a **mesma coisa restante** por esforço
crescente, para atacar do mais barato ao mais caro em vez de por tema.

Escalas usadas:

- **Esforço**: horas, dia, dias, semanas.
- **Risco semântico**: chance de errar compatibilidade com o TabWin 4.15.
  Alto significa que precisa de oracle ou golden antes de valer.
- **Bloqueio**: quando o que falta não é esforço, é evidência ou decisão.

---

## Faixa 1 — horas

**Estado em 2026-08-28:** concluída após auditoria Codex. Além dos três itens,
foram corrigidos a preservação/restauração do Worker e um falso truncamento no
coletor de valores distintos. Evidência em
`docs/handoffs/CODEX_AUDIT_CLAUDE_2026-08-28.md`.

Coisas que já estão prontas por baixo e só não aparecem, ou que são de uma
linha. Melhor relação valor/esforço do projeto inteiro.

### 1.1 Trocar o `requestAnimationFrame` de `runAnalysis` por `setTimeout` de zero

**Concluído.**

**Esforço:** minutos · **Risco:** nenhum

`runAnalysis` espera um quadro antes de tabular. Em navegador comum funciona,
mas amarra a análise à composição da página e trava em ambiente headless. O
`await` só existe para ceder a thread; um `setTimeout(0)` faz o mesmo sem
depender de renderização.

### 1.2 Propagar a modalidade preliminar até a auditoria e a receita

**Concluído.**

**Esforço:** horas · **Risco:** baixo · **Valor:** alto para quem analisa ano corrente

O DATASUS resolve preliminar contra final **pelo ano consultado** e devolve
`Dados - Preliminares` ou `Dados - Finais`. O aplicativo já recebe e exibe isso
na lista do catálogo, mas o dado morre ali. Quem tabula 2026 está usando dado
preliminar e a receita não registra.

Falta carregar `modality` até `datasetSources` na auditoria e até a receita.

### 1.3 Export JSON do resultado

**Concluído.**

**Esforço:** horas · **Risco:** nenhum

CSV, XML e XLSX já existem. JSON é o mesmo caminho com outro serializador.
Parquet é outra faixa, não confundir.

---

## Faixa 2 — um dia

Núcleo pronto e testado, falta interface. **É aqui que mora a qualidade de
dados**, e é por isso que ela não deve ir para o fim.

### 2.1 Interface das regras cruzadas de qualidade

**Concluído em 2026-08-28.** Editor de duas condições, comparação por valor ou
faixa numérica, lista ativa, alternância sinalizar/excluir e contagem de
ocorrências no resultado. Receitas restauram as regras. Evidência em
`docs/handoffs/R09_1_CROSS_FIELD_QUALITY_UI_REPORT.md`.

**Esforço:** um dia · **Risco:** baixo · **Valor:** alto

`CrossFieldRuleSpec`, validação, execução, contagem por regra, persistência em
receita e replay: **tudo pronto e coberto por testes**. Não aparece nada na
tela.

Entregue: formulário para montar a regra (campo, condição, campo, condição),
lista das regras ativas, exibição de `dataQuality[].matchedRecords` e botão que
alterna entre apenas sinalizar e excluir.

O caso que motivou — gestante de 80 anos — passa a ser possível para o usuário
comum sem escrever código.

### 2.2 Interface do perfil de combinações raras

**Concluído em 2026-08-28.** Seleção de dois campos, ranking limitado das
combinações menos frequentes e criação de regra em modo de sinalização a partir
de uma linha observada. Evidência em
`docs/handoffs/R09_2_RARE_COMBINATION_PROFILE_UI_REPORT.md`.

**Esforço:** um dia · **Risco:** baixo

`profileFieldCombinations` devolve as combinações mais raras com participação
no total. A interface agora escolhe dois campos, mostra a lista e oferece o
caminho explícito de "combinação rara" para "criar regra a partir dela".

### 2.3 Tabela virtualizada

**Concluído em 2026-08-29.** Janela de linhas com overscan sobre
`currentTableRowIndexes()`, helper puro testável (`computeTableWindow`),
totais e cabeçalho sticky preservados, impressão completa via
`beforeprint`/`afterprint`. Verificado no navegador com o `DENGBR25.dbc` real:
17 linhas reais no DOM para 1.927 municípios, rolagem completa do início ao
fim, impressão renderizando as 1.927 sem corte. Evidência em
`docs/handoffs/R09_3_VIRTUALIZED_TABLE_REPORT.md`.

**Esforço:** um dia · **Risco:** nenhum

Hoje a tabela corta em 500 linhas com aviso. No Dengue isso significa ver 500
de 1.927 municípios. Trocar por renderização em janela resolve; o resultado
completo já existe em memória.

### 2.4 Log da tabulação

**Concluído em 2026-08-29.** Histórico da sessão na aba Auditoria, mais
recente primeiro, cada entrada com dimensões, medida, filtros, regras
cruzadas, registros vistos/aceitos, forma da tabela e avisos. Botões "Copiar"
por entrada e "Copiar tudo", persistente entre trocas de arquivo até
"Limpar". Rótulo explícito de que é log moderno, não `.LST`. Evidência em
`docs/handoffs/R09_4_TABULATION_LOG_REPORT.md`.

**Esforço:** um dia · **Risco:** baixo

O `.LST` do TabWin registra o que foi tabulado. Todo o conteúdo já existe no
plano e na auditoria; falta o formato e o botão. Cuidado: reproduzir o layout
histórico exige artefato original, então entregue como log moderno e explicite
que não é equivalência.

---

## Faixa 3 — dias

**Estado em 2026-08-29: concluída.** Os quatro itens (3.1–3.4) fechados
nesta mesma sessão, um commit cada, gate verde em todos.

### 3.1 Cache de resultado L3

**Concluído em 2026-08-29.** Cache no Worker por chave estável de plano mais
conversões (via `stableJson`, ordem de filtro/regra importa), limitado a 20
entradas com descarte do menos recentemente usado, esvaziado inteiro em todo
`open`/`append`. Verificado em navegador real: reexecutar o mesmo plano sobre
`RDAC2401.dbc` levou **1 ms** de ponta a ponta contra os 13 s de uma passada
completa no Dengue; reabrir o mesmo arquivo invalidou corretamente um plano
idêntico já em cache. Evidência em
`docs/handoffs/R09_5_L3_RESULT_CACHE_REPORT.md`.

**Esforço:** dias · **Risco:** baixo · **Valor:** alto

Hoje cada reanálise repete uma passada inteira: trocar um filtro no Dengue
custa 13 s de novo. Um cache no Worker por chave estável de plano mais
conversões, com invalidação ao abrir ou combinar fonte, transforma isso em
instantâneo.

É a diferença entre **abrir** o arquivo e **trabalhar** com ele.

### 3.2 Editor e inspetor DEF/CNV

**Concluído em 2026-08-29.** Escopo assimétrico de propósito: CNV ganhou
**editor** completo (formato totalmente documentado e reversível); DEF
ganhou **inspetor** somente-leitura (`X` e os campos à direita de DEFs
contemporâneos seguem sem semântica documentada — um editor teria que
adivinhar exatamente o que este projeto se recusa a adivinhar em todo outro
lugar).

**CNV** — `packages/formats/src/windows-1252.ts` (encoder Windows-1252,
contraparte de escrita do `TextDecoder` já usado em todo o projeto;
round-trip verificado contra os 256 valores de byte possíveis, não uma
amostra) + `cnv-serializer.ts` (`serializeCnv`, grava de volta o layout de
colunas fixas exato que `cnv-parser.ts` lê; recusa `new-format` (`N`) e
falha alto — nunca trunca silenciosamente — quando um rótulo ou código
excede a largura fixa ou contém `;`) + `cnv-validate.ts`
(`validateCnvDefinition`, os mesmos diagnósticos do parser reaplicados ao
modelo, para um editor onde linha original deixa de fazer sentido assim que
alguém edita, adiciona ou remove uma categoria).

Interface: diálogo com tabela editável de categorias (sequência, rótulo,
subtotal/#, códigos/faixas), diagnósticos por linha destacando a linha com
erro, prévia de classificação que lê valores distintos do campo escolhido no
conjunto **realmente aberto** e classifica cada um com `classifyCnv` contra
o modelo em edição, e duas ações: aplicar ao conjunto atual (substitui a
entrada em uso, re-tabula na hora se estiver em uso) ou baixar `.CNV` em
Windows-1252.

**Bug real pego na própria verificação, corrigido antes de commitar:** a
primeira versão listava as categorias na ordem de `categories` (que
`cnv-parser.ts` ordena por sequência para exibição), não na ordem real das
regras no arquivo — para CNVs onde o fallback amplo vem **primeiro** no
arquivo (layout real observado: `00-99` antes de `01`/`02`/`03`), isso
invertia silenciosamente a precedência de sobreposição, fazendo o fallback
vencer sobre os códigos específicos. Corrigido lendo a ordem de
`rules[].sourceOrder`, não de `categories`. Verificado com o `COMPLEX2.CNV`
real: antes do fix, os únicos dois valores reais do campo `COMPLEX`
(`02`/`03`) caíam ambos em "Não se aplica"; depois do fix, cada um caiu na
categoria correta, e uma tabulação real com a mudança aplicada reproduziu
exatamente os números já conferidos contra o TabWin 4.15 real
(4.153/162 — os mesmos do G001).

**DEF** — inspetor somente-leitura mostra, por linha: diretiva, rótulo,
campo, papéis, origem (CNV/DBF/recurso externo) e campos à direita não
interpretados; incrementos; avisos; e as linhas não reconhecidas com texto
bruto e número da linha. Verificado com o `RD2008.DEF` real (arquivo
nacional de produção): surfaceou as 48 linhas `X` e os 65 avisos
correspondentes que hoje só apareciam como uma contagem no JSON de
auditoria — agora visíveis linha a linha.

Verificado em navegador real: download do CNV editado inspecionado byte a
byte (`Média complexidade` virou `Média complexidade (editado)`, `ã`
codificado como `0xE3`, quebras de linha CRLF, layout de colunas intacto).
Evidência em `docs/handoffs/R09_8_CNV_EDITOR_DEF_INSPECTOR_REPORT.md`.

**Esforço:** dias · **Risco:** médio · **Valor:** alto

Os modelos já eram parseados e validados; faltava editor sobre o modelo, não
sobre string, com diagnóstico por linha, prévia da classificação contra o
conjunto aberto e gravação determinística em Windows-1252.

### 3.3 Import geográfico GeoJSON

**Concluído em 2026-08-29.** `convertGeoJsonToTabwinMap` em
`packages/formats/src/geojson-map.ts` converte um `FeatureCollection`
(Polygon, MultiPolygon, LineString, Point) para o mesmo
`TabwinMapDefinition` que o parser `.MAP` legado já produz — zero mudança
no renderizador, no zoom/pan, na exportação PNG ou na classificação
coroplética, porque todos já operam sobre esse modelo compartilhado.

Deliberadamente **não adivinha** qual propriedade do GeoJSON é o geocódigo
ou o nome — arquivos DATASUS/IBGE usam nomes de propriedade diferentes
(`CD_MUN`, `GEOCODIGO`, `codarea`...), e adivinhar errado rotula todas as
áreas silenciosamente. A interface lê as propriedades reais da primeira
feature e pede para a pessoa escolher, em um diálogo novo
(`#geojson-import-dialog`) — o mesmo princípio já aplicado em toda escolha
de auxiliar no projeto. Feature sem valor na propriedade escolhida é
descartada com aviso explícito, nunca some sem rastro. Anel interior de
polígono (buraco) converte, mas emite aviso de que o modelo compartilhado
não tem conceito de buraco e vai preencher em vez de recortar — mesma
limitação que o próprio `.MAP` legado já tem para objetos multi-parte.
12 testes dedicados em `tests/geojson-map.test.mjs`.

Verificado em navegador real: GeoJSON de duas áreas (Porto Velho e
Acrelândia, códigos IBGE reais) importado e depois usado como mapa
coroplético sobre uma tabulação de `RDAC2401.dbc` de verdade —
"2 áreas associadas" no legendário, dado batendo, sem erro no console. O
JSON de auditoria confirma a proveniência: `source: "test-areas.geojson
(GeoJSON)"`, `version: 0` (marcador explícito de que não veio de um
`.MAP` legado). Evidência em
`docs/handoffs/R09_7_GEOJSON_IMPORT_REPORT.md`.

**Esforço:** dias · **Risco:** baixo · **Valor:** médio

Abriu a porta para mapas além dos `.MAP` empacotados. SHP e os formatos
históricos ficam para depois, por demanda.

### 3.4 Diff entre execuções

**Concluído em 2026-08-29.** `diffTabulationResults(before, after)` em
`packages/core/src/tabulation-diff.ts` — diff estrutural (linhas/colunas
adicionadas ou removidas) e numérico (delta por célula), identidade por
`key`, nunca por rótulo ou posição, para que uma renomeação ou reordenação
não seja lida como mudança de valor. Só compara células nas chaves comuns
aos dois lados — nunca um produto cartesiano completo. 8 testes dedicados em
`tests/tabulation-diff.test.mjs`.

Cada entrada do log de tabulação agora guarda o `TabulationResult` completo
(o tamanho da tabela renderizada, nunca o dataset de origem) e ganhou um
botão "Comparar" ao lado de "Copiar", que abre um painel mostrando eixos
adicionados/removidos, uma tabela de células alteradas com o delta colorido,
e o delta de registros vistos/aceitos entre a entrada escolhida e a
tabulação atualmente exibida.

Verificado em navegador real sobre `RDAC2401.dbc`: comparação entre uma
tabulação 1D (`MUNIC_RES`, frequência) e uma 2D (`MUNIC_RES × SEXO`)
mostrou corretamente `+2 coluna(s) · -1 coluna(s)` e zero células
comparáveis (nenhuma chave de coluna em comum entre os dois lados),
com o delta de registros vistos/aceitos em `+0` como esperado (mesmo
arquivo, mesmo filtro). Evidência em
`docs/handoffs/R09_6_TABULATION_DIFF_REPORT.md`.

**Esforço:** dias · **Risco:** baixo · **Valor:** médio

Já existia diff de manifesto de fontes. Faltava comparar dois resultados e
mostrar o que mudou, que é o que sustenta "atualizar esta análise".

---

## Faixa 4 — semanas, e com risco semântico

Aqui o custo deixa de ser código e passa a ser **evidência**. Nada nesta faixa
deve ser feito sem captura pareada no TabWin 4.15.

### 4.1 Bateria de goldens G002–G023+

**Primeira bateria fechada em 2026-08-29: G002–G005 capturados e aprovados
com tolerância zero.** A compatibilidade deixou de se apoiar em um caso e
passou a cobrir cinco semânticas independentes: frequência 1D com CNV
(G001), linha × coluna (G002), medida de soma (G003), seleção ancorada em
CNV (G004) e supressão de zeros (G005).

**Segunda bateria integrada e auditada em 2026-08-29.** G006, G008, G010,
G014, G015, G018 e G021 passam contra o BIFF original, célula a célula, com
tolerância zero. G010 revelou que linhas-pai de subtotal não entram novamente
no total final; G015 levou à implementação de rótulos auxiliares vindos de DBF
referenciado pelo DEF. G009 não é um caso executável: o protocolo mandava
combinar `AIH_MA.DEF` com um arquivo `RD`, combinação que a própria definição
não oferece. G012 preserva o resultado observado, mas o formato `N` só é
decodificado para inspeção enquanto a categoria duplicada não for explicada.

**G017 (múltiplas medidas simultâneas) implementado e aprovado em
2026-08-29.** `TabulationSpec.measures?: MeasureSpec[]` — aditivo, nunca
quebra o `measure` único existente. Quando presente com 2+ entradas, cada
medida vira sua própria coluna, na ordem declarada, sobre o mesmo eixo de
linha; incompatível com dimensão de coluna explícita até existir oráculo
para essa combinação (`compileQueryPlan` recusa a mistura com erro claro).
Interface: seção "Medidas adicionais lado a lado" que soma incrementos além
da medida principal, com rótulo do incremento do DEF quando existir
(mesma regra do G003). Verificado contra o `G017` real (Hospital AC × CNES,
Frequência + Valor Total + Óbitos): 27 linhas, zero diferença de célula,
comparado a 2 casas decimais pelo mesmo motivo do G003 (`VAL_TOT` declara
essa precisão no DBF). Verificado também em navegador real com combinação
livre de medidas (Valor Total + Óbitos), incluindo o guard de coluna+medidas
mostrando erro claro em vez de travar. Evidência em
`docs/handoffs/R10_3_G017_MULTI_MEASURE_REPORT.md`.

O G003 achou **duas divergências reais** — foi o que justificou a bateria:

1. Cabeçalho da coluna de soma: o TabWin usa o rótulo do incremento do DEF
   ("Valor Total"), não uma palavra genérica. Corrigido no executor (o
   próprio código já dizia estar esperando exatamente este golden).
2. Soma de 4.153 doubles: TabWin e nosso executor caem a **1 ULP** de
   distância, com o **nosso** valor mais perto do exato. Investigado contra
   seis hipóteses de acumulação; nenhuma ordem reproduz o valor do TabWin.
   Resolvido comparando na precisão que o campo declara no cabeçalho do DBF
   (`VAL_TOT`, 2 decimais) — não uma tolerância afrouxada: contagens seguem
   exatas e um erro de um centavo continua reprovando.

Fila reconciliada de G007 em diante em `docs/testing/GOLDEN_CORPUS_QUEUE.md`.
Evidência da primeira bateria em
`docs/handoffs/R10_0_G002_G005_GOLDEN_RESULTS.md`; auditoria e segunda bateria
em `docs/handoffs/R10_2_SECOND_GOLDEN_BATCH_AUDIT_2026-08-29.md`.

**Esforço:** semanas de captura, pouco código · **Risco:** é o que reduz risco

O documento mestre pede bateria por subsistema: CNV, DEF, motor, quadro,
persistência, geografia. Treze casos executáveis já passam; G012 permanece
como a última semântica de motor que não pode ser inventada sem evidência.

O trabalho é operar o TabWin 4.15 e capturar, não programar. Deve começar cedo
mesmo sendo longo, porque é o que autoriza a palavra "compatível".

### 4.2 Editor de gráficos

**Esforço:** semanas · **Risco:** médio

**Estado em 2026-08-29: CONCLUÍDA.** O corte inicial do ChatGPT trouxe
título/subtítulo, fonte, cores, fundo, casas decimais, legenda, rótulos e
bindings X/Y para pontos/bolhas, com persistência em `.twrecipe`. O
fechamento acrescentou eixos com limites manuais validados, marcações, grade
e rótulos de eixo; séries por coluna com legenda real; binding de tamanho das
bolhas; zoom por viewBox com roda, teclado e reenquadrar; e impressão só do
gráfico. Três regressões do corte inicial foram corrigidas no caminho: as
casas decimais forçadas em contagens inteiras, a legenda da pizza desligada
por omissão e o `styles.css` sobrescrevendo a fonte do SVG só na tela.
Handoffs em `docs/handoffs/R10_4_CHART_EDITOR_CHATGPT_START.md` e
`docs/handoffs/R10_8_CHART_EDITOR_CLOSED.md`.

Títulos, fontes, legenda, cores, rótulos, ligação x/y para dispersão e bolhas,
eixos, limites, zoom, impressão por família.

### 4.3 Mapas: quebras manuais, camadas, legendas, sedes e seleção espacial

**Estado em 2026-08-30: CONCLUÍDA.** Handoff em
`docs/handoffs/R10_10_MAPAS_AVANCADOS.md`.

- **Quebras manuais:** `manual` em `MapClassification`, com quebras interiores
  finitas e estritamente crescentes, persistidas no `.twrecipe` e validadas na
  leitura. Quebras que os dados não sustentam não apagam o mapa: ele é
  desenhado por quantis e uma nota abaixo da barra diz por quê.
- **Legendas:** já eram discretas fora do modo contínuo, então as quebras
  manuais aparecem como classes com seus intervalos, sem código novo.
- **Sedes:** marcador no `labelPoint` dos objetos que a fonte marcou como
  `polygon-with-seat`. Nada é desenhado para os outros tipos — inventar um
  centróide e chamá-lo de sede seria afirmar um fato sobre o território.
- **Camadas:** mapas extras desenhados como contorno sobre o coroplético.
  Sem ligação com dados, de propósito: deixar uma segunda camada se colorir
  do mesmo resultado afirmaria em silêncio que os geocódigos dela significam
  a mesma coisa que os da primeira.
- **Seleção espacial:** clique alterna a área, o contorno grosso mostra a
  seleção, e "Filtrar por seleção" vira um `FilterSpec` comum via
  `spatialSelectionFilter`. O campo do geocódigo **nunca é inferido**: ele
  aparece explícito, com o padrão sendo a dimensão de linha, que é o campo
  contra o qual o mapa casou os valores em primeiro lugar.

**Esforço:** semanas · **Risco:** médio

A seleção espacial ligada de volta aos filtros era a peça de maior valor
analítico do conjunto, e é a que fecha a faixa.

### 4.4 Distâncias e fluxos origem–destino

**Estado em 2026-08-30: CONCLUÍDA.** Handoff em
`docs/handoffs/R10_11_FLUXOS_OD.md`.

- `packages/analysis/src/spatial-flows.ts` agrega origem→destino com peso
  opcional e presta contas de **todo** registro descartado por nome: origem
  ausente, destino ausente, origem fora do mapa, destino fora do mapa e peso
  inválido.
- Distância planar e Haversine são contratos distintos e a UI **exige a
  escolha**: o padrão é "não calcular". Nada adivinha se um `.MAP` está em
  graus ou em unidades projetadas, porque o projeto não tem metadado que
  sustente essa afirmação.
- `createFlowAccumulator` agrega em lotes, então o Worker faz o arquivo
  nacional de 63 MiB passar sem nunca segurar os registros.
- Arcos desenhados sobre o mapa, com curvatura perpendicular à corda para que
  ida e volta entre o mesmo par não virem uma linha só.

**Esforço:** semanas · **Risco:** médio

Dependia de projeção e de contrato de tabela de fluxo. A projeção continua
sendo escolha explícita do usuário — é a resposta certa, não uma pendência.

### 4.5 `.TAB` archaeology e replay

**Estado em 2026-08-30: FORMATO DECIFRADO.** As dez capturas chegaram e o
formato está descrito em `docs/reverse-engineering/RE_001_TAB.md`: assinatura
`NEW`, cabeçalho estilo INI com seções `[Mapa]`, `[Opções]`,
`[Seleções_Ativas]` e `[Arquivos]`, depois a tabela delimitada por `;` com
rótulos entre aspas. **Windows-1252 provado por bytes crus.** O mapa é
**referência por caminho, nunca embutido**. Casas decimais são presentação
gravada no próprio valor, o que torna o `.TAB` um formato **com perda**.

Falta escrever o leitor, e cinco capturas a mais fecham os cantos que sobraram
(quantis no mapa, vários arquivos, aspas na descrição de linha, duas seleções,
não classificados discriminados).
- `packages/formats/src/legacy-tab.ts` é um inspector read-only: identifica
  OLE CFB, ZIP, texto ou binário desconhecido; extrai strings Windows-1252 e
  UTF-16LE com offset; detecta referências a DEF/CNV/DBF/DBC/MAP/TAB; dá
  janela hexadecimal; e compara duas inspeções para isolar o que mudou entre
  duas capturas controladas.
- `docs/reverse-engineering/RE_000_METHOD_MAP.md` recuperou os 469 métodos
  publicados do binário Delphi com endereço, incluindo
  `TTabula.Salvar1Click = 0x00564D94`, e estabeleceu com três evidências
  independentes que **o `.TAB` é textual, do mesmo caminho de código do
  `.PRN`** — classificado como FORTEMENTE INDICADO, não como provado.
- `docs/testing/TAB_CAPTURE_PROTOCOL.md` tem as dez capturas necessárias, uma
  propriedade por vez, para o diff isolar cada campo.

Formato de container desconhecido. Comece por leitura apenas, com artefatos
mínimos de salvar e reabrir capturados no 4.15. Escrita só para campos provados
estáveis e necessários.

### 4.6 SQL local via DuckDB

**Estado em 2026-08-30: COMPILADOR PROVADO; EMBARQUE NO NAVEGADOR EM ABERTO.**
Handoff em `docs/handoffs/R10_12_DUCKDB_PARIDADE.md`.

- `packages/core/src/duckdb-plan.ts` aceita só o subconjunto raw cujo
  significado em SQL pode ser afirmado sem reimplementar CNV, lookup DBF,
  `startPosition`, unclassified discriminado, cross-field ou múltiplas
  medidas. Tudo o mais vira **blocker nomeado**, nunca tradução aproximada.
- Filtros usam parâmetros posicionais; nenhuma categoria entra no texto do
  SQL.
- **`tests/duckdb-parity.test.mjs` roda o SQL gerado num DuckDB de verdade** e
  exige os mesmos números do executor de referência: contagem 1D e 2D, soma
  decimal, frequência ponderada, filtros de categoria e de faixa numérica com
  limites inclusivos e exclusivos, e uma categoria com aspas e `DROP TABLE`
  dentro. Um caso a mais prova que o portão **falha** quando os números
  divergem — portão que nunca falhou não é evidência de nada.
- O DuckDB é dependência **só de desenvolvimento**. Nada disso vai para o
  navegador.

**Decisão tomada em 2026-08-30: carregamento sob demanda (opção B).** Ver a
seção de trilhas no topo deste documento. O número que circulou antes — 149 MB —
era o pacote npm inteiro desempacotado; o que um navegador carrega é o
`duckdb-eh.wasm`, **34 MB brutos, ~7 MB comprimidos**, uma vez, com cache
depois. Isso é a mesma ordem de grandeza dos mapas do Brasil que já embarcamos.

O DuckDB **não vira o executor do TabWin**. Ele é a trilha 2, com nome de
produto próprio e procedência de motor visível no resultado e na receita.

### 4.7 Armazenamento colunar e cache L2

**Estado em 2026-08-30: ARMAZENAMENTO E CACHE CONCLUÍDOS E MEDIDOS.**
Handoff em `docs/handoffs/R10_13_COLUNAR_L2.md`.

- `packages/core/src/columnar-cache.ts` codifica por dicionário em lotes,
  com índice `Uint16` até 65.536 distintos e `Uint32` acima, preservando
  `null`, `undefined`, string, número, booleano e `Date` como valores
  distintos — não como o texto deles.
- Cache L2 LRU por fonte + conjunto de campos, servindo um pedido mais
  estreito a partir do menor superset já guardado, sem copiar buffer.
- `executeColumnarProjection` reconstrói os registros e chama **o executor de
  referência**. Não existe segundo motor.
- Medido em `RDAC2401.dbc` com `npm run bench:columnar`: **9,5x** menos
  memória que os mesmos registros como objetos, resultado idêntico ao do
  caminho normal, e o cache servindo o pedido estreito pelo superset.

**Deliberadamente fora:** executor vetorizado direto sobre os índices. Criá-lo
agora duplicaria `resolvePlanRecord` e a semântica do motor — que é o erro que
a 4.6 evita explicitamente. Só entra com corpus suficiente para provar
igualdade contra os goldens, do mesmo jeito que o caminho SQL.

### 4.8 Testes end-to-end com Playwright

**Estado em 2026-08-30: CONCLUÍDA.** `@playwright/test` instalado, Chromium
baixado, `npm run e2e` com **7 testes passando** na VM e a CI rodando a mesma
suíte depois do `npm run check`, com o relatório subindo como artefato quando
falha. Handoff em `docs/handoffs/R10_9_E2E_PLAYWRIGHT.md`.

O que a suíte cobre hoje: CSV local → Web Worker → tabulação exibida;
catálogo nacional postando `uf[]=BR` explicitamente; catálogo por UF postando
a UF escolhida; editor de gráficos redesenhando o SVG sem refazer a
tabulação; limites de eixo inválidos recusados; zoom por `viewBox` e
reenquadrar; e ida e volta do estilo pela receita.

**Correção de registro:** a auditoria do snapshot `5879760` descreveu aqui um
`scripts/verify-e2e-contract.mjs` "executado pelo gate". Esse arquivo nunca
existiu nesta árvore, e o gate nunca o executou. A suíte Playwright real
substitui a ideia: ela exercita os mesmos seletores num navegador de verdade,
que é o que o contrato tentava aproximar sem poder rodar.

**Esforço:** semanas · **Risco:** baixo · **Valor:** alto

A motivação original continua valendo como registro: o bug do `uf=BR` passou
por 121 testes verdes porque todos eram unitários e fixavam o comportamento
defeituoso. Os dois testes de catálogo desta suíte são exatamente a rede que
faltava — e um deles agora também exige que a interface **explique** por que
não há UF para escolher, em vez de só esconder o seletor.

---

### 4.9 Microdatasus filtrável pelo próprio aplicativo

**Estado em 2026-08-30: CONCLUÍDA.** Handoff em
`docs/handoffs/R10_14_MICRODATASUS.md`.

A ideia original: baixar e filtrar microdados do DATASUS sem R e sem FTP
manual. O catálogo oficial já resolvia o download; faltava a saída.

- `packages/export/src/microdatasus.ts` exporta CSV registro a registro
  usando o **mesmo `resolvePlanRecord`** que a tabulação usa para aceitar ou
  rejeitar. Não existe segunda semântica de filtro.
- Campo bruto sempre presente; coluna `CAMPO__ROTULO` só quando o DEF aponta
  para **exatamente uma** conversão ou tabela auxiliar carregada e executável.
  Havendo ambiguidade, fica só o bruto — não se escolhe CNV em silêncio.
- Proveniência opcional por arquivo: fonte, sistema, tipo, ano, mês e UF,
  aproveitando a consulta do catálogo quando o dado veio do fluxo DATASUS.
- UTF-8 com BOM, `;`, CRLF e escape de aspas, quebras e delimitador.
- O Worker emite blocos transferíveis por lote; a UI só baixa depois de
  conferir `rowsEmitted === recordsAccepted` da tabulação ativa.

**Teto explícito de 512 MiB.** O download final ainda cresce na heap do
navegador porque o `Blob` precisa das partes juntas. Superar isso exige sink
gravável (File System Access API) com fallback; remover o teto antes disso
seria trocar um limite honesto por um OOM.

---

## Bloqueados por evidência, não por esforço

Não estimar nem agendar. Só saem do lugar quando aparecer fonte.

- **Presets clínicos de implausibilidade.** Dizer que gestante acima de 55 é
  impossível é inventar política epidemiológica. Precisa de fonte citada ou
  assinatura explícita do usuário.
- **Concept Registry.** Mapear conceito para variável exige autoridade que o
  projeto não tem.
- **DEF `X` e novo formato `N` do CNV.** Semântica desconhecida; exigem fixture
  real.
- **Regras automáticas de auxiliar fora de SIH-RD.** Associação DEF/CNV por
  semelhança de nome é adivinhação.
- **CI do GitHub Actions.** Bloqueado por billing da conta, não por código.

---

## Ordem que eu recomendo

1. Faixa 1 inteira — é quase de graça e tira dívida visível.
2. **2.1 e 2.2**, a interface de qualidade de dados. O núcleo já está pago e
   é o que você pediu; deixar escondido é desperdício.
3. **3.1**, o cache L3. Transforma o Dengue de "abre" em "usável".
4. **4.1**, começar a bateria de goldens em paralelo, porque é captura manual
   e leva tempo de calendário.
5. **4.8**, um e2e mínimo da busca oficial, pelo motivo registrado acima.
6. O resto por demanda real de usuário, não por completude de catálogo.
