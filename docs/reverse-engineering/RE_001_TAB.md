# RE-001 — O formato `.TAB` do TabWin 4.15

**Data:** 2026-08-30
**Método:** dez capturas controladas no TabWin 4.15, uma propriedade alterada
por arquivo, seguindo `docs/testing/TAB_CAPTURE_PROTOCOL.md`.
**Base comum:** `RD2008.DEF` + `RDAC2401.dbc` (o mesmo par do G001).
**Resultado:** o formato está descrito. Nenhuma linha abaixo é inferência a
partir do binário; toda afirmação vem de um par de arquivos que difere em uma
coisa só.

---

## Como as capturas isolaram cada campo

O `.patch` mental é simples: se T01 e Tnn diferem em exatamente uma propriedade
da interface, tudo que o `diff` mostrar **é** aquela propriedade. Foi o que
aconteceu — os dez diffs saíram limpos, sem ruído.

| Captura | O que mudou na tela | O que apareceu no arquivo |
| --- | --- | --- |
| T02 | título | só `Titulo1=` |
| T03 | acrescentou coluna | `Coluna=`, `Titulo2=` e a matriz inteira |
| T04 | seleção Eletivo | seção `[Seleções_Ativas]` nova |
| T05 | suprimir zeradas | `Suprime_Linhas_Zeradas=true` e as linhas sumiram |
| T06 | 2 casas decimais | **só os valores**, nenhuma chave |
| T07 | medida Valor Total | `Incremento=`, `Titulo2=` e os valores |
| T08 | mapa aberto | seção `[Mapa]` nova |
| T09 | título acentuado | só `Titulo1=` |
| T10 | aspas no título | só `Titulo1=` |

---

## Estrutura

Um `.TAB` tem três partes, nesta ordem, em **CRLF**:

```text
NEW                                    ← linha de assinatura, literal
Titulo1=<texto livre>                  ← cabeçalho solto, antes de qualquer seção
Titulo2=<texto livre>
[Mapa]                                 ← opcional
...
[Opções]                               ← sempre presente
...
[Seleções_Ativas]                      ← opcional, só quando há filtro
...
[Arquivos]                             ← sempre presente
<nome do arquivo de dados>
Registros_Processados= <n>
Tempo_Decorrido= <m:ss>
<tabela delimitada por ponto e vírgula>
```

`Titulo1` e `Titulo2` ficam **fora** de qualquer seção, entre a assinatura `NEW`
e a primeira `[`.

### `[Opções]`

| Chave | Exemplo | Observação |
| --- | --- | --- |
| `DEF` | `C:\...\G001\RD2008.DEF` | caminho **absoluto** |
| `PATH` | `C:\...\G001\RD*.DBC` | padrão de arquivos, absoluto |
| `Linha` | `Complexidade do Procedimento` | **rótulo** da opção do DEF, não o campo |
| `Coluna` | `Caráter atendimento` | ausente quando a coluna não está ativa |
| `Incremento` | `Freqüência` | rótulo da medida |
| `Suprime_Linhas_Zeradas` | `false` / `true` | |
| `Suprime_Colunas_Zeradas` | `false` / `true` | |
| `Não_Classificados` | `0` | chave com acento e cedilha no nome |

### `[Seleções_Ativas]`

Aparece **só** quando existe filtro. Não é `chave=valor`; é `rótulo: código
rótulo`:

```text
[Seleções_Ativas]
Caráter atendimento: 01 Eletivo
```

O código da categoria (`01`) e o rótulo (`Eletivo`) vão **juntos, no mesmo
campo**, separados por espaço.

### `[Mapa]`

**Na captura T08, o mapa não foi embutido.** O arquivo registrou uma referência
por caminho absoluto, mais a classificação:

```text
[Mapa]
Nomemapa=C:\...\MAPAS\ac_municip.MAP
Colunamapa=1
NumClasses=5
IndCor=3
Cor0=16318424
Classe0=358
Cor1=13434726
Classe1=716
...
```

- `Cor<n>` é `TColor` do Delphi, ou seja **`$00BBGGRR`** — byte de azul primeiro.
  `16318424` = `0xF8FAD8` → RGB(216, 250, 248).
- `Classe<n>` é o **limite superior** de cada classe. Os cinco valores da captura
  são 358, 716, 1073, 1431, 1789 — passo de ~357,8 sobre um máximo de 1789, ou
  seja, **intervalos iguais**.
- `Colunamapa=1` indica qual coluna da tabela alimenta o mapa.
- `IndCor=3` ainda não foi isolado; provavelmente índice da paleta.

### `[Arquivos]` e a tabela

Depois de `[Arquivos]` vem uma linha por arquivo de dados, depois duas linhas de
diagnóstico e então a tabela:

```text
[Arquivos]
RDAC2401.dbc
Registros_Processados= 4315
Tempo_Decorrido= 0:00
"Complexidade do Procedimento";"Freqüência"
"Atenção Básica";0
"Média complexidade";4153
"Alta complexidade";162
"Não se aplica";0
"Total";4315
```

- delimitador `;`;
- **rótulos entre aspas, números sem aspas**;
- a linha `"Total"` faz parte do arquivo;
- com coluna ativa, a última coluna também é `"Total"`;
- o arquivo termina em CRLF depois do total, **sem marcador de fim** — nada de
  `0x1A`, ao contrário dos `.CNV`.

---

## Encoding: **Windows-1252**

Decidido por bytes crus, que é o que a captura T09 existe para resolver:

```text
Freqüência  →  46 72 65 71 fc ea 6e 63 69 61
                             ~~ ~~
                             ü  ê      um byte cada
[Opções]    →  5b 4f 70 e7 f5 65 73 5d
                        ~~ ~~
                        ç  õ
```

Byte único por caractere acentuado. **Não é UTF-8.** Vale inclusive para os
nomes das chaves (`Não_Classificados`) e das seções (`[Opções]`,
`[Seleções_Ativas]`).

## Aspas: o cabeçalho não escapa nada

T10 pôs `ele disse "oi"` no título e o arquivo saiu:

```text
Titulo1=ele disse "oi"
```

Sem escape, porque o cabeçalho é `chave=valor` até o fim da linha — não há
ambiguidade a resolver. O defeito histórico que o `HISTORIA.TXT` registra é
sobre aspas na **descrição das linhas**, que ficam na parte delimitada, e esse
caso não foi capturado ainda.

O corpo tem apóstrofo sem escape dentro de campo entre aspas
(`"110001 ALTA FLORESTA D'OESTE"`), o que é esperado.

## Casas decimais são presentação, gravadas no valor

T06 é o achado mais consequente para quem for escrever o leitor. Mudar para duas
casas **não acrescentou nenhuma chave**. Só os valores mudaram:

```text
"Média complexidade";4153      →  "Média complexidade";4153,00
```

Duas consequências:

1. o separador decimal é **vírgula**;
2. o número de casas **não é recuperável** do arquivo a não ser olhando o
   próprio texto do valor — e um `.TAB` com zero casas perdeu os centavos de
   verdade. T07 mostra isso: com a medida `Valor Total` e zero casas, o arquivo
   guarda `3016737`, enquanto o valor real é `3.016.736,92`.

**Um `.TAB` não é um formato sem perdas.** Ele guarda o que foi exibido.

---

## Classificação da evidência

| Conclusão | Grau |
| --- | --- |
| Assinatura `NEW`, CRLF, seções INI, tabela `;` no fim | **PROVADO** |
| Encoding Windows-1252 | **PROVADO** (bytes crus) |
| T08 gravou o mapa por referência, sem conteúdo embutido | **PROVADO para T08** |
| `Cor<n>` é `TColor` `$00BBGGRR` | **FORTEMENTE INDICADO** (bate com paleta verde) |
| `Classe<n>` é limite superior, intervalos iguais na captura | **PROVADO** para esta captura |
| Casas decimais não são persistidas como chave | **PROVADO** |
| `IndCor` é índice de paleta | **HIPÓTESE** |
| Comportamento com quantis ou quebras manuais no mapa | **DESCONHECIDO** |
| Aspas na descrição de linha | **DESCONHECIDO** |
| Múltiplos arquivos em `[Arquivos]` | **DESCONHECIDO** (só uma captura tinha um) |
| `.PRN` compartilhando o caminho de leitura | **FORTEMENTE INDICADO** (RE-000) |

As capturas exploratórias T01–T10 que originaram parte desta análise não estão
versionadas neste repositório. Portanto, as conclusões que dependem apenas delas
são rastreáveis ao protocolo descrito aqui, mas não são reproduzíveis a partir
do clone. Os goldens commitados continuam sendo a evidência verificável.

---

## O que isso destrava, e o que ainda não

**Destrava:** leitor de `.TAB`. Tudo que é preciso para reconstruir título,
dimensões, medida, supressão, seleções, mapa e a tabela exibida está descrito e
verificado.

**Não destrava replay fiel.** O arquivo guarda o **rótulo** da opção do DEF
(`Linha=Complexidade do Procedimento`), não o campo nem a CNV. Reexecutar exige
abrir o mesmo DEF e casar pelo rótulo — que é exatamente o que o `HISTORIA.TXT`
descreve como "recuperar todas as seleções que foram utilizadas". Se o DEF
mudar de rótulo, o replay quebra. Isso é limitação do formato, não nossa.

**Não destrava escrita ainda.** Escrever exige decidir o que fazer com
`Não_Classificados`, `IndCor`, e o caso de vários arquivos — três capturas a
mais resolvem.

## Próximas capturas, se quiser fechar de vez

| # | O que fazer | O que decide |
| --- | --- | --- |
| T11 | mapa com **quantis** em vez de intervalos iguais | se `Classe<n>` muda de significado |
| T12 | tabular **dois** `.dbc` juntos | como `[Arquivos]` lista vários |
| T13 | rótulo de linha contendo `"` no fim | o defeito do `HISTORIA.TXT` |
| T14 | duas seleções ao mesmo tempo | se `[Seleções_Ativas]` repete linha |
| T15 | `Não classificados` como "discriminar" | o que `Não_Classificados=` guarda |
