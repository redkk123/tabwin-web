# Roadmap do que falta, ordenado por complexidade

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
G006 (não classificados) segue adiado: nenhum campo do arquivo AC/2024-01
produz valor fora da cobertura da sua CNV. Evidência completa em
`docs/handoffs/R10_0_G002_G005_GOLDEN_RESULTS.md`.

**Esforço:** semanas de captura, pouco código · **Risco:** é o que reduz risco

O documento mestre pede bateria por subsistema: CNV, DEF, motor, quadro,
persistência, geografia. Cinco casos cobrem o motor; o resto continua aberto.

O trabalho é operar o TabWin 4.15 e capturar, não programar. Deve começar cedo
mesmo sendo longo, porque é o que autoriza a palavra "compatível".

### 4.2 Editor de gráficos

**Esforço:** semanas · **Risco:** médio

Títulos, fontes, legenda, cores, rótulos, ligação x/y para dispersão e bolhas,
eixos, limites, zoom, impressão por família.

### 4.3 Mapas: quebras manuais, camadas, legendas, sedes e seleção espacial

**Esforço:** semanas · **Risco:** médio

A seleção espacial ligada de volta aos filtros é a peça de maior valor
analítico do conjunto.

### 4.4 Distâncias e fluxos origem–destino

**Esforço:** semanas · **Risco:** médio

Depende de projeção e de contrato de tabela de fluxo. Casos de borda de
geocódigo ausente ou desconhecido precisam de teste dedicado.

### 4.5 `.TAB` archaeology e replay

**Esforço:** semanas · **Risco:** alto

Formato de container desconhecido. Comece por leitura apenas, com artefatos
mínimos de salvar e reabrir capturados no 4.15. Escrita só para campos provados
estáveis e necessários.

### 4.6 SQL local via DuckDB

**Esforço:** semanas · **Risco:** alto se mal colocado

Restrição arquitetural que não pode ser violada: DuckDB **executa** planos, não
define semântica. Qualquer resultado precisa bater com o executor de referência
antes de substituí-lo.

### 4.7 Armazenamento colunar e cache L2

**Esforço:** semanas · **Risco:** alto

**Deixou de ser pré-requisito** — a projeção por campos do plano já resolveu o
Dengue. Continua valendo para levar reanálise de 13 s a milissegundos, mas o
L3 entrega a maior parte desse ganho por muito menos.

Se for feito: cardinalidade medida no Dengue não passa de 29.539 por coluna,
índice de 2 bytes serve para todas, e as 121 colunas somam cerca de 228 MiB.
E a regra dura: **provar igualdade com `resolvePlanRecord`** antes de
substituí-lo.

### 4.8 Testes end-to-end com Playwright

**Esforço:** semanas · **Risco:** baixo · **Valor:** alto

Não existe nenhum hoje. O bug do `uf=BR` passou por 121 testes verdes porque
todos eram unitários e fixavam o comportamento defeituoso. Um e2e que faz uma
busca real teria pego.

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
