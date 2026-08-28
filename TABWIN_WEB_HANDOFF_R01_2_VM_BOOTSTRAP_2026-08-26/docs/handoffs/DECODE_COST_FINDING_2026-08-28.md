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

## O QUE ISSO INDICA

A representação de registro é a parede. O caminho que resta é **armazenamento
colunar**: decodificar uma vez, a partir do fluxo em blocos que já existe, para
colunas tipadas com strings dicionarizadas, e executar cada análise sobre as
colunas.

O trabalho em blocos não foi desvio: ele é a metade da frente desse desenho,
porque é o que permite construir as colunas sem materializar 511 MiB de DBF.

## RISCO A RESPEITAR

Um executor colunar precisa reproduzir exatamente a semântica atual de
`resolvePlanRecord`, incluindo CNV, `startPosition`, faixas numéricas,
não classificados e regras cruzadas. É onde mora o risco de compatibilidade, e
G001 sozinho não cobre isso. Qualquer implementação colunar deve provar
igualdade com o executor atual sobre os mesmos dados antes de substituí-lo,
como foi feito com o acumulador em lotes.
