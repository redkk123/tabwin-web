# R11.5 — Fórmulas estilo Excel, sem virar Excel

**Data:** 2026-08-30
**Estado:** concluída, mais a costura R11.5b com o pipeline. Gate
**354/354**, E2E **19/19**.

## O que existia e por que não bastava

`packages/analysis/src/table-expression.ts` já tinha um parser próprio de
expressões para a operação "Nova coluna por expressão": números, referências
de coluna (`C01` ou `[Rótulo]`), `+ - * / ^`, parênteses, precedência e
potência associativa à direita. Era um motor real e testado — mas **sem
nenhuma função**. Escrever `(Óbitos / População) * 100000` funcionava;
`ARRED(...)`, `SE(...)`, `TAXA(...)` não existiam, e nada dizia ao usuário o
que ele podia escrever.

O ChatGPT tinha apontado exatamente isso: *"a arquitetura atual já está
perfeitamente preparada; expandir o AST para aceitar `FUNCTION(argumentos…)`
é uma evolução natural, em vez de reescrever o motor."* Foi o que esta faixa
fez — o AST ganhou dois nós (`call` e `comparison`), o resto do motor ficou
como estava.

## O que é, e o que explicitamente não é

**Não é "implementar o Excel".** É uma linguagem de fórmulas com sintaxe
familiar ao Excel sobre as colunas desta tabela. Não existe grade de células,
então não existem `A1:B35`, `PROCV`/`VLOOKUP`, macros nem centenas de funções
financeiras. `COUNTIF`/`CONT.SE` também **não** existe, e isso é decisão, não
esquecimento: o contrato dela é intervalo + critério, e fingir isso sobre uma
única linha daria ao nome um significado que um usuário de Excel leria
errado. A interface diz isso em texto, no próprio painel.

## 32 funções em cinco grupos

- **Agregação sobre os argumentos escritos**: `SUM`, `AVERAGE`, `MIN`, `MAX`,
  `MEDIAN`, `COUNT`.
- **Aritmética**: `ABS`, `SQRT`, `POWER`, `EXP`, `LN`, `LOG`, `LOG10`.
- **Arredondamento**: `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `TRUNC`, `INT`.
- **Lógica**: `IF`, `IFS`, `AND`, `OR`, `NOT`, `IFERROR`, `ISNUMBER`.
- **Epidemiologia**: `RATE`, `PERCENT`, `RATIO`, `CHANGE`, `PCTCHANGE`,
  `LAG`, `ZSCORE`.

Mais **comparações** (`<`, `>`, `<=`, `>=`, `=`, `<>`, com precedência
abaixo da aritmética, para `a + 1 < b * 2` comparar os dois lados já
calculados), **`=` inicial opcional** (reflexo de quem usa Excel), **`;`
como separador** além de `,` (Excel pt-BR), e **apelidos em português**
sem ponto: `SOMA`, `MÉDIA`, `MEDIANA`, `MÍNIMO`, `MÁXIMO`, `RAIZ`,
`POTÊNCIA`, `ARRED`, `TRUNCAR`, `SE`, `E`, `OU`, `NÃO`, `CONT`, `TAXA`,
`PERCENTUAL`, `RAZÃO`, `VARIAÇÃO`.

### As bordas do Excel que valem estar certas

As quatro funções de arredondamento **discordam entre si em negativos**, e
cada uma foi implementada pela sua própria regra, não por apelido de outra:
`ROUND` arredonda a metade para longe do zero (`ROUND(−2,5) = −3`, enquanto
`Math.round` do JavaScript daria `−2`); `ROUNDUP` vai para longe do zero;
`ROUNDDOWN` e `TRUNC` vão em direção ao zero; `INT` arredonda para baixo
(`INT(−2,7) = −3`, diferente de `TRUNC(−2,7) = −2`). `LOG` tem base 10 por
padrão como no Excel — a natural é `LN`.

Arredondar casas decimais **não** multiplica por potência de dez: `2,345 *
100` é `234,49999999999997` em ponto flutuante binário, e uma implementação
ingênua responde `2,34` onde o Excel responde `2,35`. O deslocamento é feito
no expoente decimal da forma `toExponential()`, preservando os dígitos que o
autor realmente digitou.

## As funções de epidemiologia são o ponto, não o enfeite

`RATE(eventos; população; por)`, `PERCENT`, `RATIO`, `CHANGE`, `PCTCHANGE`
nomeiam o que uma divisão anônima esconderia. Todas respeitam a **mesma
política explícita de divisão por zero** que a operação já expõe na
interface (`Interromper`/`Usar zero`) — o princípio "default pode existir;
default invisível não" da spec.

`LAG([coluna]; n)` e `ZSCORE([coluna])` precisam da coluna **inteira**, não
só da linha atual, então o avaliador passou a receber um contexto
(`TableExpressionContext`) com todas as linhas em vez de só a linha corrente.
Como "qual coluna" precisa ser respondível na hora de compilar, esses
argumentos são obrigados a ser referência de coluna nua — `ZSCORE(C01 + 1)`
é recusado no parse, com a explicação.

`ZSCORE` reusa `descriptiveStatistics()` de `statistics.ts`, então usa
exatamente o mesmo desvio-padrão amostral que o painel de Estatística já
mostra — os dois nunca vão discordar.

`LAG` na primeira linha **falha**. Não existe linha anterior, e devolver
zero ali fabricaria um dado. `IFERROR(LAG([X]); 0)` é a saída — explícita,
escrita pelo autor.

### `IFERROR` é o único lugar onde um erro é engolido

E só porque foi pedido por escrito. Uma divisão por zero nua continua
falhando alto; `IFERROR(x; 0)` é uma decisão visível na fórmula. Mesmo
princípio de sempre.

## Segurança: registro fechado, verificado por teste

Nada aqui avalia texto do usuário como código. Todo nome chamável precisa
estar em `FUNCTIONS`; qualquer outro é recusado **por nome, no parse**
(`unknown function eval`, `unknown function globalThis.alert`). O teste
antigo que garantia isso mudou de mensagem — antes `globalThis.alert(1)`
morria em "missing column", agora morre em "unknown function
globalThis.alert" — e foi atualizado junto com casos novos para `eval`,
`constructor` e `toString`. A propriedade testada é a mesma, e a rejeição
ficou mais precisa.

## Catálogo: a lista que o usuário lê é a lista que o parser aceita

`tableExpressionFunctionCatalog()` devolve nome, grupo, assinatura, resumo e
apelidos. É tipado como `Record<FunctionName, …>` **total**, então adicionar
uma função sem documentá-la não compila. A UI renderiza o painel "Funções
disponíveis" e o `<datalist>` de autocomplete a partir dele — não existe uma
segunda lista escrita à mão que pudesse divergir. Dois testes fecham o
círculo: todo nome anunciado realmente parseia, e todo apelido aceito pelo
parser está atribuído a exatamente uma função no catálogo.

## Verificação

- `npm run check`: **346/346** (20 testes novos em
  `tests/table-expression-functions.test.mjs`, cobrindo cada grupo, as bordas
  de arredondamento em negativos e em casas decimais, precedência de
  comparação, aridade validada no parse, apelidos/`;`/`=`, `LAG` na primeira
  linha, `ZSCORE` sem variância, e o registro fechado).
- `npm run e2e`: **18/18**, com um caso novo que aplica, pela interface real,
  `=SE([Frequência] > 5; ARRED(TAXA([Frequência]; 1000; 1000); 1); 0)` — `=`
  inicial, apelidos em português, `;`, comparação e aninhamento numa fórmula
  só — confere os valores por linha, mostra que o painel de funções só
  aparece na operação de expressão e vem do motor, prova que `LAG` sem
  `IFERROR` falha na primeira linha, e que `eval(1)` é recusado por nome.
- Verificação manual no navegador antes do E2E: a mesma fórmula, mais
  `IFERROR(LAG(...); 0)` e `ARRED(ZSCORE(...); 2)`, conferidas contra os
  valores esperados linha a linha.

## R11.5b — o mesmo motor virou o `mutate()` que faltava no pipeline

O handoff do R11.4 registrou que `mutate()` por fórmula ficara de fora
porque seria o mesmo motor de expressões desta faixa, e fazer duas vezes
seria desperdício. Com o motor pronto, a costura foi feita na mesma rodada:
o passo `derive-column` calcula um campo numérico novo por registro, com a
mesma linguagem, endereçada aos **campos do registro** em vez das colunas
de uma tabulação.

Para isso o parser deixou de conhecer `TabulationResult` e passou a receber
uma lista `{ key, label }` — as colunas de uma tabulação preenchem as duas
metades; os campos de um dataset usam o nome nas duas. `parseTableExpression`
continua existindo como a porta de entrada da tabulação, agora fina.

Duas consequências que precisaram de decisão explícita:

- **Layering.** `transform-pipeline.ts` vivia em `packages/core` e passaria a
  importar de `packages/analysis` — seria a única aresta `core → analysis` do
  repositório inteiro, invertendo a regra que todo o resto segue. O arquivo
  foi movido para `packages/analysis`, onde suas dependências (`matchesFilters`,
  `validateFilter`, os tipos de `model.js`) fluem na direção certa.
- **Campo sem original.** Um campo criado pelo pipeline não tem
  tipo/tamanho/decimais de origem para herdar, então `TransformedField.originalName`
  virou opcional e o Worker sintetiza uma coluna numérica para esses casos —
  em vez de fingir uma origem que não existe.

`LAG`/`ZSCORE` funcionam sobre registros também: a projeção numérica completa
só é construída quando a fórmula realmente lê a coluna inteira
(`expressionReadsEveryRow`), então uma fórmula linha a linha não paga por uma
segunda cópia do dataset. Um resultado não finito **interrompe** o pipeline com
o número do registro e a sugestão de `IFERROR`, em vez de gravar `NaN` como se
fosse número.

Gate depois desta costura: `npm run check` **354/354**, `npm run e2e` **19/19**.

## O que não entrou

`COUNTIF` (motivo acima). Editor de fórmula com autocomplete inline e
destaque de sintaxe — hoje é um `<input>` com `<datalist>` e um painel de
referência; um editor rico é trabalho de UI própria. Fórmulas em etapas do
pipeline de transformação (R11.4) — o `mutate()` que faltava lá agora tem
motor, mas ligá-lo à etapa é a próxima costura, não esta.
