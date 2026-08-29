# R09.3 — tabela virtualizada

**Data:** 2026-08-29
**Status:** completo e verificado em navegador real com o Dengue nacional.

## VISTORIA PRÉVIA

Antes de tocar em código, auditei de forma independente o trabalho que o
Codex entregou enquanto eu estava fora: a auditoria de regressões
(`683c416`), a interface de regras cruzadas (`fddb5cd`) e o perfil de
combinações raras (`fab6caa`). Não aceitei os relatórios pela palavra — rodei
o gate do zero, chequei G001 contra o oracle real, li o diff de cada commit e
reproduzi os três cenários no navegador com o `RDAC2401.dbc` real:

- `MUNIC_RES=120040` + `IDADE≥0`: sinalizou 1.789, excluir levou o total de
  4.315 para 2.526 (4.315 − 1.789, exato);
- perfil de `MUNIC_RES` × `SEXO`: primeira combinação `110045`+`SEXO=3`,
  1 registro, 0,023%, idêntico ao relatado;
- a ponte "criar regra" a partir da combinação gerou regra em modo sinalizar
  com `matchedRecords=1`.

Os três números batem exatamente com o que o Codex reportou. Auditoria
aprovada sem ressalva sobre a correção funcional.

## O QUE FOI FEITO

`packages/visualization/src/table-window.ts`: `computeTableWindow`, função
pura que recebe contagem de linhas, altura de linha, posição e altura de
rolagem, e devolve o intervalo de linhas a renderizar mais as alturas dos dois
espaçadores (antes e depois). Sem DOM, sem estado — só geometria. 8 testes
cobrindo topo, fundo exato, geometria sempre consistente (espaçador + linhas
renderizadas = altura total), overscan, viewport maior que o conteúdo,
tabela vazia e valores negativos.

`apps/web/src/main.ts`: `renderTable` continua construindo legenda, cabeçalho
e rodapé como antes; o corpo da tabela passou a ser responsabilidade de
`renderTableBody`, chamada tanto pelo render completo quanto por um listener
de `scroll` em `#table-wrap`. Cabeçalho e rodapé continuam `position: sticky`,
sem mudança de CSS.

Sem limiar de tamanho: o mesmo código atende uma tabela de 10 linhas e uma de
milhares. O limite fixo de 500 linhas com aviso foi removido.

## BUG REAL ENCONTRADO E CORRIGIDO DURANTE A VERIFICAÇÃO

Não foi só o painel de pré-visualização. Testei diretamente: `wrap.scrollTop
= wrap.scrollHeight` aplicava corretamente (`immediatelyAfterSet: 70967`),
mas **disparar o evento `scroll`** — que aciona `renderTableBody` — fazia o
navegador **zerar `scrollTop` de volta** (`afterDispatch: 0`).

Causa: a primeira versão de `renderTableBody` chamava `body.replaceChildren()`
sem argumento para limpar, e só depois anexava as linhas novas uma a uma. Isso
cria um instante síncrono em que o `<tbody>` fica vazio antes das novas linhas
entrarem. Com o conteúdo momentaneamente vazio, o navegador recalcula a altura
rolável do contêiner e prende `scrollTop` a 0 antes que as linhas novas
voltem a crescer o conteúdo — e uma vez preso, não se restaura sozinho.

Corrigido substituindo o padrão limpar-depois-anexar por uma troca atômica:
construir os nós num array e chamar `body.replaceChildren(...nodes)` uma
única vez, tanto no caminho normal quanto no vazio. Nunca existe um estado
intermediário de corpo vazio.

Confirmado que era o defeito, não o ambiente: repeti exatamente o mesmo teste
depois da correção e `scrollTop` permaneceu em 70967 após o `dispatch` e após
uma espera adicional.

## IMPRESSÃO

`beforeprint` renderiza todas as linhas sem espaçador; `afterprint` restaura a
janela na posição de rolagem atual. O CSS de impressão já zerava
`max-height`/`overflow` do `.table-wrap`; agora o DOM realmente contém todas
as linhas nesse momento, não apenas as que estavam na janela.

## EXPORTAÇÃO E CÓPIA — NADA MUDOU DE PROPÓSITO

`exportCsv`, `exportJson`, `exportXlsx`, `exportXml` e a cópia TSV já liam
`currentResult` e `currentTableRowIndexes()` diretamente, nunca o DOM. Não
foram tocados nesta entrega porque não precisavam ser: a garantia de que
exportação nunca depende da janela visível já existia antes da virtualização.

## ROLAGEM SEM RESET INDEVIDO

Uma decisão de design corrigida antes mesmo de chegar ao navegador: a primeira
versão zerava `scrollTop` toda vez que `renderTable` rodava. Só que
`renderTable` também roda a cada tecla digitada em título/subtítulo/rodapé da
tabela (evento `input`), o que zeraria a rolagem do usuário a cada letra
digitada. Corrigido: o reset de rolagem só acontece em `renderResult()`, o
único momento em que uma análise nova de fato começa. Mudança de ordenação,
busca, decimais ou texto livre preserva a posição de rolagem.

## VERIFICADO NO NAVEGADOR COM O DENGUE REAL

`DENGBR25.dbc`, 1.643.215 registros, tabulação `MUNICIPIO` com 1.927 linhas:

- carregamento inicial: **17 linhas reais no DOM** (mais 1 espaçador) para
  1.927 linhas totais;
- rolagem ao topo: `Ji-Paraná`, `Porto Velho`… no início;
- rolagem ao fundo exato: últimas linhas terminam em `Brasília (530010)`,
  o maior código de município da base — confirma alcance completo, sem corte;
- rolagem ao meio: município do Rio de Janeiro em posição intermediária
  plausível, espaçadores somando corretamente com as linhas renderizadas;
- impressão: 1.927 linhas sem espaçador durante `beforeprint`, janela restaurada
  em `afterprint`;
- console do navegador sem nenhum erro durante toda a sessão de testes.

## GATE

`npm run check`: **157/157** testes (eram 149), typecheck do núcleo, typecheck
web e build Vite. G001 inalterado e ainda `pass` com tolerância zero.

## PRÓXIMO PASSO

Faixa 2.4 (log moderno da tabulação, explicitamente não-`.LST`), depois
Faixa 3.1 (cache de resultado L3), na ordem do
`docs/product/ROADMAP_POR_COMPLEXIDADE.md`.
