# Onde o tempo realmente vai ao abrir um DBC

**Data:** 2026-08-28
**Consequência:** muda o próximo passo arquitetural. Leia antes de ligar o
caminho em blocos à interface.

## POR QUE ESTA MEDIÇÃO EXISTE

O caminho em blocos derrubou a parede de memória. Antes de desenhar a próxima
etapa em cima de um palpite, era preciso descobrir onde está a próxima parede.

## MEDIDO

`npm run bench:decode-breakdown -- RDAC2401.dbc`, 5 execuções após aquecimento:

| Etapa | Tempo |
| --- | --- |
| Descompressão DCL materializada | 44 ms |
| Descompressão DCL em blocos | 35 ms |
| Leitor publicado: bytes + registros | 352 ms |
| Fluxo em blocos: bytes + registros | 386 ms |

Duas leituras diretas:

- **A decodificação de registros é 91% do tempo.** Descomprimir é barato;
  transformar bytes em objetos JavaScript é o custo real.
- O fluxo em blocos está a **1,1x** do leitor publicado, ou seja, não introduzi
  regressão de desempenho. E a descompressão em blocos é mais rápida que a
  materializada, porque não aloca a saída inteira.

## PROJEÇÃO PARA O DENGUE

Escalando linearmente pelo tamanho comprimido, uma passada completa sobre os
63 MiB do `DENGBR25.dbc` custa da ordem de **80 segundos**, dos quais cerca de
73 são criação de objetos de registro. A projeção é indicativa e não foi medida
no arquivo grande.

## O QUE ISSO DESCARTA

Descarta o desenho em que o Worker guarda apenas os bytes de origem e
**re-decodifica a cada análise**. Trocar um filtro passaria a custar 80
segundos. Guardar o DBF decodificado em vez do DBC não resolve: os 91% estão na
decodificação de registro, não na descompressão.

Descarta também guardar os registros como objetos JavaScript: é justamente a
representação que a medição de memória já mostrou custar 376 MiB para 1,2
milhão de registros.

## MEDIDO NO ARQUIVO REAL

O `DENGBR25.dbc` foi baixado do DATASUS e lido inteiro pelo fluxo em blocos:
**1.643.215 registros**, 326 bytes cada, 121 campos, 511 MiB de DBF declarado e
nunca materializado, em 130.784 blocos.

Cardinalidade observada: **nenhuma coluna passa de 29.539 valores distintos**
(`ID_UNIDADE`). Índice de 2 bytes serve para todas, e o total colunar das 121
colunas fica em cerca de 228 MiB.

## A PROJEÇÃO RESOLVE, E O COLUNAR NÃO É PRÉ-REQUISITO

Como só a criação de objeto custa caro, decodificar apenas os campos que o
plano nomeia elimina quase todo o custo. Medido com
`npm run bench:plan-projection` sobre o Dengue real, plano de
`ID_MUNICIP` por `CS_SEXO` com filtro em `NU_IDADE_N`:

| Caminho | Tempo |
| --- | --- |
| Só descompressão DCL | 7,3 s |
| Tabulação decodificando os 3 campos do plano | **13,2 s** |
| Tabulação decodificando os 121 campos | 190,9 s |

**14,5x mais rápido, com resultado idêntico** (`projectedEqualsFull: true`):
4.815 linhas, 3 colunas, 1.629.310 registros aceitos.

Conclusão que corrige a expectativa anterior deste documento: **o
armazenamento colunar deixa de ser pré-requisito para abrir o Dengue.** Treze
segundos com progresso é uso aceitável. O colunar continua valendo como
otimização para reanálises repetidas, levando 13 s para a casa dos
milissegundos, mas não bloqueia mais nada.

O piso é a descompressão: 7,3 s dos 13,2 s. Nenhum trabalho sobre a
representação de registro desce abaixo disso sem guardar bytes descomprimidos
ou colunas.

## RISCO A RESPEITAR

Um executor colunar precisa reproduzir exatamente a semântica atual de
`resolvePlanRecord`, incluindo CNV, `startPosition`, faixas numéricas,
não classificados e regras cruzadas. É onde mora o risco de compatibilidade, e
G001 sozinho não cobre isso. Qualquer implementação colunar deve provar
igualdade com o executor atual sobre os mesmos dados antes de substituí-lo,
como foi feito com o acumulador em lotes.
