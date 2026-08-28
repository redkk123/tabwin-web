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

Coisas que já estão prontas por baixo e só não aparecem, ou que são de uma
linha. Melhor relação valor/esforço do projeto inteiro.

### 1.1 Trocar o `requestAnimationFrame` de `runAnalysis` por `setTimeout` de zero

**Esforço:** minutos · **Risco:** nenhum

`runAnalysis` espera um quadro antes de tabular. Em navegador comum funciona,
mas amarra a análise à composição da página e trava em ambiente headless. O
`await` só existe para ceder a thread; um `setTimeout(0)` faz o mesmo sem
depender de renderização.

### 1.2 Propagar a modalidade preliminar até a auditoria e a receita

**Esforço:** horas · **Risco:** baixo · **Valor:** alto para quem analisa ano corrente

O DATASUS resolve preliminar contra final **pelo ano consultado** e devolve
`Dados - Preliminares` ou `Dados - Finais`. O aplicativo já recebe e exibe isso
na lista do catálogo, mas o dado morre ali. Quem tabula 2026 está usando dado
preliminar e a receita não registra.

Falta carregar `modality` até `datasetSources` na auditoria e até a receita.

### 1.3 Export JSON do resultado

**Esforço:** horas · **Risco:** nenhum

CSV, XML e XLSX já existem. JSON é o mesmo caminho com outro serializador.
Parquet é outra faixa, não confundir.

---

## Faixa 2 — um dia

Núcleo pronto e testado, falta interface. **É aqui que mora a qualidade de
dados**, e é por isso que ela não deve ir para o fim.

### 2.1 Interface das regras cruzadas de qualidade

**Esforço:** um dia · **Risco:** baixo · **Valor:** alto

`CrossFieldRuleSpec`, validação, execução, contagem por regra, persistência em
receita e replay: **tudo pronto e coberto por testes**. Não aparece nada na
tela.

Falta: formulário para montar a regra (campo, condição, campo, condição),
lista das regras ativas, exibição de `dataQuality[].matchedRecords` e o botão
que alterna entre apenas sinalizar e excluir.

O caso que motivou — gestante de 80 anos — passa a ser possível para o usuário
comum sem escrever código.

### 2.2 Interface do perfil de combinações raras

**Esforço:** um dia · **Risco:** baixo

`profileFieldCombinations` devolve as combinações mais raras com participação
no total. Falta escolher dois campos e mostrar a tabela, com um caminho de um
clique de "combinação rara" para "criar regra a partir dela".

### 2.3 Tabela virtualizada

**Esforço:** um dia · **Risco:** nenhum

Hoje a tabela corta em 500 linhas com aviso. No Dengue isso significa ver 500
de 1.927 municípios. Trocar por renderização em janela resolve; o resultado
completo já existe em memória.

### 2.4 Log da tabulação

**Esforço:** um dia · **Risco:** baixo

O `.LST` do TabWin registra o que foi tabulado. Todo o conteúdo já existe no
plano e na auditoria; falta o formato e o botão. Cuidado: reproduzir o layout
histórico exige artefato original, então entregue como log moderno e explicite
que não é equivalência.

---

## Faixa 3 — dias

### 3.1 Cache de resultado L3

**Esforço:** dias · **Risco:** baixo · **Valor:** alto

Hoje cada reanálise repete uma passada inteira: trocar um filtro no Dengue
custa 13 s de novo. Um cache no Worker por chave estável de plano mais
conversões, com invalidação ao abrir ou combinar fonte, transforma isso em
instantâneo.

É a diferença entre **abrir** o arquivo e **trabalhar** com ele.

### 3.2 Editor e inspetor DEF/CNV

**Esforço:** dias · **Risco:** médio

Os modelos já são parseados e validados. Falta editor sobre o modelo, não
sobre string, com diagnóstico por linha, prévia da classificação contra o
conjunto aberto e gravação determinística em Windows-1252.

Nunca serializar especulativamente `X` nem o novo formato `N`.

### 3.3 Import geográfico GeoJSON

**Esforço:** dias · **Risco:** baixo

Abre a porta para mapas além dos `.MAP` empacotados. SHP e os formatos
históricos ficam para depois, por demanda.

### 3.4 Diff entre execuções

**Esforço:** dias · **Risco:** baixo

Já existe diff de manifesto de fontes. Falta comparar dois resultados e
mostrar o que mudou, que é o que sustenta "atualizar esta análise".

---

## Faixa 4 — semanas, e com risco semântico

Aqui o custo deixa de ser código e passa a ser **evidência**. Nada nesta faixa
deve ser feito sem captura pareada no TabWin 4.15.

### 4.1 Bateria de goldens G002–G006

**Esforço:** semanas de captura, pouco código · **Risco:** é o que reduz risco

Hoje a compatibilidade se apoia em **um** caso. O documento mestre pede bateria
por subsistema: CNV, DEF, motor, quadro, persistência, geografia.

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
