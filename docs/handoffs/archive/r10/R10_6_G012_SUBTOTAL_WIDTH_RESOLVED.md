# R10.6 — G012 resolvido: o indicador de subtotal do formato N tem 4 colunas

**Data:** 2026-08-29
**Status:** fechado por experimento controlado contra o motor real, implementado
e verificado. G012 passa com tolerância zero. **14 goldens** agora executáveis.

## O enigma

O export real do TabWin 4.15 para `Freqüência segundo Natureza Jurídica`
mostrava quatro linhas:

```text
Total                                                      4.315
102-3 Órgão Público do Poder Executivo Estadual/DF         3.282
104-0 Órgão Público do Poder Legislativo Federal             524
114-7 Fundação Pública de Direito Público Estadual/DF        509
399-9 Associação Privada                                     524
```

As células somam 4.839, mas o Total diz 4.315. E a contagem direta do campo
bruto `NAT_JUR` no `RDAC2401.dbc`, sem DEF e sem CNV, mostra que **só existem
três códigos no arquivo inteiro**: `1023`→3282, `3999`→524, `1147`→509,
somando exatamente 4.315. **Nenhum registro tem código `1040`.**

Ou seja, a linha `104-0` não vinha de dado nenhum.

## O que estava errado no nosso lado

O parser lia o indicador de subtotal do layout `N` com **5 colunas**. Os
arquivos oficiais gravam o valor alinhado à direita no que parece ser um
campo de 5 (`"   56"`), então líamos `56` e apontávamos para a sequência 56
(`233-0 Cooperativas de Consumo`) — que não é o pai semântico de nada disso.
E como o formato `N` estava bloqueado para execução, isso nunca aparecia.

Havia também uma pista estrutural que quase levou à conclusão errada: os
cinco grupos do `NATJUR.CNV` estão nas sequências 1, 28, 57, 79 e 86,
enquanto os ponteiros usados são 1, 28, **56**, 79 e 86. Quatro batem exato e
um destoa — o que sugeria erro de dados no arquivo oficial. Não era isso.

## O experimento que decidiu

Três cópias byte a byte do `NATJUR.CNV`, cada uma com **uma única alteração**:
o indicador da linha 80 (`399-9 Associação Privada`, a única categoria com
registros reais). Mesmo tamanho, mesma codificação, nada mais tocado.

O teste decisivo gravou `"  105"`, escolhido porque as três larguras
candidatas produzem resultados visualmente inconfundíveis:

| Leitura | Resolve para | Linha esperada |
| --- | --- | --- |
| 3 colunas (o que o manual clássico diz) | `"  1"` = 1 | `1. Administração Pública` |
| **4 colunas** | `"  10"` = 10 | **`110-4 Autarquia Federal`** |
| 5 colunas | `"  105"` = 105 | nenhuma (sequência não existe) |

**Resultado real no TabWin 4.15:**

```text
Total                                                      4.315
102-3 Órgão Público do Poder Executivo Estadual/DF         3.282
110-4 Autarquia Federal                                      524   <- foi para cá
114-7 Fundação Pública de Direito Público Estadual/DF        509
399-9 Associação Privada                                     524
```

A linha derivada migrou para `110-4 Autarquia Federal`, o `104-0` desapareceu
e o Total continuou 4.315. **Só a leitura de 4 colunas prevê isso.**

## A regra, agora provada

O indicador de subtotal do layout `N` ocupa as **colunas 1–4**. Como os
arquivos oficiais gravam o valor alinhado à direita num campo aparentemente
de 5, o último dígito cai fora do campo lido:

| No arquivo | Lido (4 col.) | Resolve para |
| --- | --- | --- |
| `"   01"` | `"   0"` = 0 | nenhum pai — por isso 102-3 e 114-7 não geram linha derivada |
| `"   56"` | `"   5"` = 5 | sequência 5 = `104-0` — **a linha do G012 original** |
| `"   28"` | `"   2"` = 2 | sequência 2 (sem registros neste arquivo) |

E a linha derivada é uma **linha de subtotal comum**: fica visível, mas fora
do total — exatamente a semântica que o **G010** já tinha provado e que o
executor já implementava. Por isso o Total permanece 4.315 mesmo com as
células somando 4.839. O `4.315` "aritmeticamente impossível" era o TabWin
fazendo a coisa certa o tempo todo.

## Implementação

- `packages/formats/src/cnv-parser.ts`: indicador de subtotal passa a ser lido
  com 4 colunas no modo `N` (3 no clássico, inalterado). Um indicador que
  degrada para `0` significa "sem pai", não ponteiro quebrado — evita um
  aviso espúrio em toda linha cujo valor original começava com `0`.
- `packages/core/src/execute.ts`: execução do formato `N` desbloqueada. A
  propagação de subtotal e o `excludeFromTotal` já existentes (do G010) fazem
  todo o trabalho, sem código novo de hierarquia.
- `apps/web/src/main.ts`: CNVs `N` voltam a aparecer nos seletores de linha e
  coluna e podem ser aplicadas.
- **Gravação continua recusada.** `cnv-serializer.ts` ainda se nega a
  escrever o layout `N`: a leitura está provada, a escrita não. Reescrever um
  indicador de 4 colunas num campo que os arquivos oficiais gravam com 5
  produziria um arquivo que o próprio TabWin leria diferente.

## Verificação

Reprodução célula a célula do G012 real, com o `NATJUR.CNV` oficial:

```text
102-3 Órgão Público do Poder Executivo Estadual/DF   3282
104-0 Órgão Público do Poder Legislativo Federal      524   [fora do total]
114-7 Fundação Pública de Direito Público Estadual/DF  509
399-9 Associação Privada                              524
Total                                                4315
```

Rótulos idênticos, células idênticas, total idêntico.

- `npm run check`: **242/242** (eram 241).
- `verify-goldens-local.mjs` + `verify-second-goldens-local.mjs` contra os
  arquivos reais: **todos passam**, e o G012 entrou no segundo verificador
  com checagem de total.
- `fixtures/golden/G012/manifest.json` promovido de
  `captured-not-yet-executable` para `verified-zero-tolerance`. **O golden
  não foi alterado** — só o status da comparação, depois que o motor passou a
  reproduzi-lo.

## Crédito e correção de rumo

Duas contribuições do ChatGPT foram decisivas e me fizeram recuar de uma
conclusão errada:

1. Ele achou na documentação oficial que o campo é o **Indicador de
   Subtotal**, e que linha derivada de subtotal é função documentada do CNV —
   não bug. Eu ia recomendar classificar o G012 como "divergência deliberada"
   e deixar nosso motor produzir só as três linhas reais. Estaria errado: o
   incompleto era o nosso motor.
2. Ele apontou que eu ia cristalizar "4 colunas" a partir de **uma**
   observação, e propôs uma matriz de testes com um valor `>99` para separar
   as hipóteses. Foi exatamente isso que tornou o resultado inequívoco em vez
   de plausível.

## O que continua aberto

- **G009**: segue como erro de protocolo de captura (o roteiro mandava
  combinar `AIH_MA.DEF` com `RD*.DBC`, combinação que a própria definição não
  oferece). Não é falha do motor nem do operador.
- **Escrita de CNV formato `N`**: deliberadamente não implementada.
- A largura de 4 colunas está provada para este layout `N` a partir de um
  arquivo real e um experimento controlado. Se aparecer um `N` de outra
  origem que se comporte diferente, isso vira um novo caso — não uma
  suposição a estender.
