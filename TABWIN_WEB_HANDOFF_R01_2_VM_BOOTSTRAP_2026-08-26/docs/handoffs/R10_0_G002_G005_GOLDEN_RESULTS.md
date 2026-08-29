# R10.0 — G002–G005: resultados da primeira bateria diferencial

**Data:** 2026-08-29
**Status:** os quatro casos capturados, comparados e **aprovados** com
tolerância zero. Duas divergências reais encontradas no G003, ambas
investigadas até a causa e resolvidas com evidência.

## O QUE CHEGOU

O usuário capturou G002–G005 no TabWin 4.15 real, no diretório isolado, com
os assets já verificados por hash (`RDAC2401.dbc`, `RD2008.DEF`,
`COMPLEX2.CNV`, `CARATEND.CNV`, `CARATENDc.CNV`). Quatro exports BIFF,
1.133 / 380 / 431 / 344 bytes, nenhum editado depois.

## RESULTADO

| Caso | Semântica | Forma | Registros | Resultado |
| --- | --- | --- | --- | --- |
| G001 | frequência 1D com CNV | 4×1 | 4.315 / 4.315 | PASS (já existia) |
| G002 | linha × coluna | 4×6 | 4.315 / 4.315 | **PASS** |
| G003 | medida de soma | 4×1 | 4.315 / 4.315 | **PASS** (após 2 correções) |
| G004 | seleção via CNV | 4×1 | 4.315 / **2.092** | **PASS** |
| G005 | supressão de zeros | **2**×1 | 4.315 / 4.315 | **PASS** |

Todos com `absoluteTolerance: 0`. Só o G003 usa comparação em precisão
declarada (2 casas), pelo motivo documentado abaixo.

## G002 — a pergunta em aberto foi respondida

O protocolo registrava uma dúvida real: com seis categorias no
`CARATENDc.CNV` mas só duas com dado no arquivo, o TabWin mostraria as
quatro vazias ou as esconderia?

**Mostra todas as seis.** Colunas vazias aparecem zeradas, não somem. Nosso
executor já fazia o mesmo — 4×6, zero células divergentes.

Bônus de consistência cruzada: o total da coluna `Eletivo` que o TabWin
reporta no G002 (**2.092**) é exatamente o número de registros que o G004
aceita depois de filtrar por "01 Eletivo". Dois casos independentes, capturados
separadamente, concordando — é o tipo de checagem que um corpus de goldens
compra de graça.

## G003 — duas divergências reais

Este foi o único caso que falhou na primeira comparação, e falhou por dois
motivos distintos. Nenhum golden foi editado; os dois foram investigados até
a causa.

### Achado 1 — rótulo da coluna (corrigido no código)

TabWin escreve **"Valor Total"** no cabeçalho: o rótulo do incremento `I` do
DEF, verbatim. Nosso executor escrevia **"Valor"**, genérico.

Isso não foi surpresa — o próprio `execute.ts` carregava o comentário:

> *"Sum headers remain 'Valor' until a focused increment golden captures them."*

O G003 **é** esse golden. Corrigido: `MeasureSpec` ganhou `label?`,
`sumMeasureFromDefIncrement` passou a carregar o rótulo do incremento, e a
interface passou a rotear pelo bridge do DEF em vez de montar a medida na
mão. Sum sobre campo cru sem incremento no DEF mantém o cabeçalho neutro —
é um caso para o qual o TabWin não tem precedente, então não inventamos um.

### Achado 2 — acumulação de ponto flutuante (1 ULP)

Para `Média complexidade` (4.153 registros somados):

```text
TabWin 4.15      3016736.9200000036508
este executor    3016736.9200000031851   (-1 ULP, exatamente o último bit)
soma exata       3016736.9199999999255
```

A diferença é **1 ULP** — 4,66e-10 sobre um valor de 3 milhões, erro relativo
de 1,5e-16. Investiguei antes de concluir qualquer coisa, testando seis
hipóteses de acumulação contra o valor real do TabWin:

| Método | Resultado |
| --- | --- |
| sequencial float64 (o nosso) | −1 ULP do TabWin |
| ordem reversa / crescente / decrescente | erram por mais |
| pairwise (árvore binária) | −8 ULP |
| soma exata em centavos (BigInt) | −8 ULP |
| valores em float32 | erra por 25 milhões de ULP |

Nenhuma ordem reproduz o valor do TabWin, e — o ponto que decide a questão —
**o nosso resultado está mais perto do valor matematicamente exato que o do
TabWin**. Não é um bug nosso a corrigir: é deriva de arredondamento
acumulada, cujo valor exato depende da sequência de instruções da FPU de uma
aplicação Delphi de 1998.

Também confirmei que o grupo pequeno (`Alta complexidade`, 162 registros)
bate **exatamente**, bit a bit, sem nenhuma tolerância. A divergência só
aparece com milhares de somas.

**Decisão:** o G003 compara em **2 casas decimais** — não uma tolerância
afrouxada arbitrariamente, mas a precisão que o **próprio campo declara no
cabeçalho do DBF** (`VAL_TOT`, tipo N, largura 14, **decimais 2**). Abaixo do
centavo o dado não tem significado; comparar ali é comparar ruído. Os três
valores (TabWin, nosso, exato) renderizam idênticos no que o usuário vê:
`3016736,92`.

Garantias que mantêm isso honesto, cobertas por teste:

- Contagens continuam em comparação exata (`decimalPlaces` fica indefinido),
  então um erro de ±1 registro nunca se esconde atrás de arredondamento.
- Um erro real de **um centavo** ainda reprova, testado explicitamente.
- Os `cellDiffs` reportam os doubles **crus**, então a evidência guarda o que
  cada engine realmente produziu, mesmo quando a decisão saiu no centavo.

## G004 — filtro antes da agregação

4.315 vistos, **2.092 aceitos**. O filtro roda antes da agregação, e o número
bate com o total independente do G002. Confirmado também que o papel de
seleção do `Caráter atendimento` liga em `CARATEND.CNV` — arquivo diferente
do `CARATENDc.CNV` do papel de coluna, com rótulos de categoria diferentes.
Ambos reais, ambos presentes, ambos exercitados.

## G005 — supressão remove, não esconde

As duas linhas zeradas do G001 (`Atenção Básica`, `Não se aplica`)
**desaparecem do resultado**: 4 linhas viram 2. Não aparecem em branco, não
são agrupadas num "outros". E o Total continua **4.315** — supressão é
apresentação, não muda o que foi contado.

## O QUE FOI COMMITADO

- `fixtures/golden/G002` … `G005`: export BIFF original, `recipe.txt`,
  `capture-notes.md`, `expected/golden-table.json` e `manifest.json` com
  hashes de assets e de evidência. Imutáveis.
- `tests/golden-corpus.test.mjs`: 5 testes que reparseiam o BIFF original
  **independentemente** do normalizador que gerou o `golden-table.json` — um
  bug no normalizador não consegue fazer a própria saída concordar consigo
  mesma.
- `scripts/verify-goldens-local.mjs` (`npm run verify:goldens`): roda o
  executor completo contra os assets reais externos, os cinco casos de uma vez.
- `CompareGoldenOptions.decimalPlaces` e `MeasureSpec.label`, com o porquê
  documentado no próprio código, não só aqui.

## GATE

`npm run check`: **215/215** (eram 207). Verificação local contra os assets
reais: **5/5 PASS**. G001 inalterado — `git status` limpo no diretório dele.

## PRÓXIMO PASSO

G006 (não classificados) segue adiado pelo motivo já documentado: nenhum campo
deste arquivo AC/2024-01 produz um valor fora da cobertura da sua CNV. Precisa
de um DBC maior ou de outro par campo/CNV. G007+ estão enfileirados em
`docs/testing/GOLDEN_CORPUS_QUEUE.md`.
