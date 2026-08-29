# R09.5 — cache de resultado L3

**Data:** 2026-08-29
**Status:** completo e verificado em navegador real com os dois arquivos
oficiais já usados nesta sessão.

## POR QUE

Medido em `R09_0` (`bench:plan-projection`): tabular o Dengue nacional real
com projeção de campos custa **13,2 s**. Aceitável para abrir o arquivo uma
vez. Inaceitável para cada ajuste de filtro, ordenação ou apresentação —
que hoje refaz a passada inteira. O cache de resultado é o que separa
**abrir** o arquivo de **trabalhar** com ele.

## O QUE FOI FEITO

`packages/core/src/tabulation-cache.ts`: `createTabulationResultCache`, cache
puro (sem DOM, sem Worker) chaveado por `stableJson({ plan, conversions })` —
a mesma serialização determinística já usada pela receita, que ordena chaves
de objeto mas **preserva ordem de array**. Isso importa: dois planos que só
diferem na ordem dos filtros ou das regras cruzadas podem produzir resultados
diferentes (uma regra cruzada com `exclude` remove registro; a ordem de
filtros de exclusão não muda o resultado final, mas a chave não pode assumir
isso por conta própria), então a chave não pode tratá-los como iguais. 7
testes cobrindo acerto, erro genuíno, sensibilidade à ordem de filtro,
sensibilidade a conversões, `clear()` invalidando tudo de uma vez, descarte
do menos recentemente usado além da capacidade, e capacidade inválida.

`apps/web/src/dataset-worker.ts`: o cache mora no Worker, ao lado das fontes
que ele descreve. `resultCache.clear()` roda em todo `open` e `append`
**bem-sucedidos** — nunca antes de confirmar que a fonte nova é válida, pelo
mesmo motivo da correção anterior do Codex: um `open` que falha não pode
apagar o que ainda é válido. `tabulate` consulta o cache antes de qualquer
leitura de bloco; um acerto responde na hora, sem tocar no fluxo de bytes.

Bônus encontrado ao mexer no `open`: a versão anterior atribuía
`sources = request.sources` **antes** de calcular `header = headerForSources(...)`.
Se `headerForSources` lançasse erro — esquema incompatível entre múltiplos
arquivos, por exemplo — `sources` já apontava para os dados novos (inválidos)
enquanto `header` continuava descrevendo os dados antigos. Um `tabulate`
seguinte decodificaria bytes novos usando os deslocamentos de campo antigos.
Corrigido calculando `headerForSources` inteiro antes de tocar em qualquer
estado do módulo, para um `open` que falha nunca deixar `sources` e `header`
descrevendo gerações diferentes de dado.

`apps/web/src/main.ts`: a resposta do Worker ganhou `cached: boolean`.
Acerto de cache mostra aviso (`Resultado em cache — sem nova leitura do
arquivo`) e o histórico da tabulação (Faixa 2.4) marca a entrada com ⚡ e
dica ao passar o mouse.

## VERIFICADO EM NAVEGADOR COM ARQUIVOS REAIS

`RDAC2401.dbc`: tabular `MUNIC_RES` × Frequência, depois repetir o **mesmo**
plano — acerto de cache confirmado pela entrada do histórico com ⚡ e sem
recontagem. Medido com precisão via `MutationObserver` no lugar de uma espera
arbitrária: **1 ms** entre disparar a mudança de campo e o aviso de cache
aparecer — a ida e volta completa (thread principal → Worker → busca no
mapa → resposta → interface), não uma estimativa.

Teste de invalidação, o mais rigoroso possível com os dois arquivos reais
disponíveis: como `RDAC2401.dbc` (SIH) e `DENGBR25.dbc` (SINAN) não
compartilham nome de campo, o teste decisivo foi **reabrir o mesmo
`RDAC2401.dbc`** e repetir exatamente o plano que estava em cache antes da
troca. Nova entrada no histórico, **sem** o marcador ⚡ — miss genuíno, porque
`open` limpa o cache incondicionalmente, mesmo quando o arquivo reaberto é
idêntico ao anterior. Não há chance de servir resultado de uma geração de
dado diferente.

Também confirmado ao vivo, sem colisão de nome de campo: abrir `DENGBR25.dbc`
com `MUNICIPIO` × Frequência produziu miss (sem ⚡) com os números já
conhecidos e conferidos — 1.643.215 vistos, 99.257 aceitos, 1.927 linhas —
prova de que o cache anterior não vazou para o dataset novo.

Console do navegador sem nenhum erro durante toda a sessão de testes.

## GATE

`npm run check`: **164/164** testes (eram 157), typecheck do núcleo,
typecheck web e build Vite. G001 inalterado e ainda `pass` com tolerância
zero.

## LIMITE DELIBERADO

O cache não sobrevive a um `open`/`append`, mesmo quando o dado reaberto é
idêntico ao anterior — decisão conservadora de propósito: detectar "mesmo
conteúdo" exigiria hash do arquivo inteiro antes de decidir, o que anula
parte do ganho. Sempre correto, ocasionalmente reprocessa um caso que
poderia ter sido evitado.

## PRÓXIMO PASSO

Faixa 4.1 do roadmap — bateria de goldens G002–G006. É captura manual no
TabWin 4.15, não código; deve começar em paralelo assim que houver operador
disponível, porque é o que sustenta a palavra "compatível".
