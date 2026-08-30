# R10.11 — Faixa 4.4 fechada: distâncias e fluxos origem–destino

**Data:** 2026-08-30
**Estado:** 4.4 concluída. Gate **270/270**, E2E **9/9**.

## O que veio do ChatGPT

`packages/analysis/src/spatial-flows.ts` inteiro, e é um bom módulo:

- agregação origem→destino com peso opcional e contagem de registros por aresta;
- **cinco contadores de descarte separados** — origem ausente, destino ausente,
  origem desconhecida, destino desconhecida, peso inválido — em vez de um
  "ignorados" que esconde qual problema é qual;
- `unknownPolicy` explícita, com `exclude` por padrão;
- Haversine e planar como **contratos distintos**, nunca inferidos;
- `mapGeocodePoints` usa o `labelPoint` como ponto representativo e **lança** se
  o mesmo geocódigo aparecer com pontos conflitantes.

A recusa central — não adivinhar se um `.MAP` está em graus ou em unidades
projetadas — está certa e ficou.

## Uma mudança de arquitetura

A primeira ligação com o Worker acumulava todos os registros num array para
passar ao `buildOriginDestinationFlows`, que recebe um `Iterable`. Isso
contradiz a razão de existir do `dataset-worker.ts`, que está escrita no topo do
arquivo: os registros são varridos em lotes limitados justamente para o arquivo
nacional de 63 MiB caber. Projetar três campos reduz o custo por registro, mas
milhões de objetos ainda são milhões de objetos.

`createFlowAccumulator({...}).push(batch)` / `.finish()` segue o mesmo formato do
`createTabulationAccumulator` que o Worker já usa para tudo. O
`buildOriginDestinationFlows` do ChatGPT continua existindo com a mesma
assinatura e os testes dele passam sem alteração — agora é o acumulador em uma
chamada só.

## A UI que faltava

O ChatGPT entregou o contrato de dados e disse que a UI não existia. Ela existe
agora, no painel do mapa:

- origem, destino, peso opcional, política para geocódigo fora do mapa;
- **distância com padrão "não calcular"** — a coluna só aparece depois que
  alguém diz em que modelo o mapa está;
- limite de arcos desenhados;
- tabela dos 50 maiores fluxos, com nome da área quando o mapa conhece o
  geocódigo.

O relatório mostra `aceitos de vistos` e, quando há diferença, **enumera os
cinco motivos**. Um mapa de fluxo parece autoritativo; ele não pode descartar um
terço dos registros em silêncio.

Os arcos usam uma curva quadrática com desvio perpendicular à corda, para que
ida e volta entre o mesmo par apareçam como dois arcos e não como uma linha só.

`mapGeocodePoints` lança em geocódigo duplicado conflitante, o que é correto,
mas não pode derrubar o desenho inteiro do mapa: o `renderMap` usa um invólucro
que devolve mapa vazio nesse caso — os arcos não aparecem e o resto continua.

## Um defeito de layout que só o E2E pegou

O painel de fluxos entrou dentro de `.map-stage`, que tem
`position: relative; overflow: hidden`, e o `.map-message` dentro dele é
`position: absolute; inset: 0`. A mensagem cobria o painel inteiro e engolia
todos os cliques. O typecheck passava, a inspeção no navegador achava todos os
controles, e nada indicava problema — o Playwright falhou com
`<div id="map-message"> intercepts pointer events`.

Painel de fluxos, lista de camadas e nota de quebras saíram do `.map-stage` e
agora são irmãos dele. Bom argumento para a 4.8 ter vindo antes.

## Verificação

- `npm run check`: **270/270** (eram 267).
- 3 testes do ChatGPT sobre distância, agregação e pontos representativos: PASS,
  sem alteração, contra o acumulador novo.
- `npm run e2e`: **9/9**, com dois casos novos sobre fluxos: a agregação com
  peso somando 20 na aresta mais pesada e prestando contas do registro sem
  destino, e a ausência de coluna de distância enquanto ninguém escolheu modelo.

## O que continua fora, e por quê

**Projeção automática.** Continua sendo escolha explícita do usuário. Isso não é
pendência: é a resposta certa enquanto não houver metadado que diga em que
sistema de coordenadas cada `.MAP` está. Um número de quilômetros calculado
sobre unidades projetadas desconhecidas seria pior que nenhum número.
