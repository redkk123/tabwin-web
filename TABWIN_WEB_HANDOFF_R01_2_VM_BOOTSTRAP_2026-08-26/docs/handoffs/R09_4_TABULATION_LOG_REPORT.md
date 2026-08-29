# R09.4 — log moderno da tabulação

**Data:** 2026-08-29
**Status:** completo e verificado em navegador real.

## ESCOPO E LIMITE DELIBERADO

A reverse spec (`CODEX_MASTER_HANDOFF_TABWIN_WEB.md`, seção 4.1.13) descreve
o log do TabWin 4.15 de forma genérica: registra informações sobre a
tabulação, pode ser visualizado, editado e copiado para a área de
transferência, e serve como ponto de partida para recuperar o painel da
análise. Não há layout de campos nem formato documentado — apenas
comportamento observado.

Sem artefato original para provar um formato byte a byte, esta entrega **não
tenta reconstruir o `.LST` histórico**. É um log moderno: lê "visualizado" e
"copiado para a área de transferência" como os dois comportamentos com
evidência suficiente para implementar sem inventar. "Editado" ficou de fora —
o roadmap já registrava essa cautela antes de eu começar. A recuperação do
painel a partir do log também não foi implementada aqui: quem já cumpre esse
papel é a receita (`.twrecipe`), que salva e reabre o plano completo.

## O QUE FOI FEITO

Cada tabulação bem-sucedida acrescenta uma entrada ao histórico da sessão, na
aba Auditoria, acima do JSON de auditoria já existente. Mais recente primeiro.
Cada entrada mostra: horário, nome do arquivo, dimensões (linha × coluna),
medida, contagem de filtros, contagem de regras cruzadas, registros
vistos/aceitos, forma da tabela resultante e contagem de avisos. Todo campo já
existia no plano ou no resultado; nada foi inventado.

Botão "Copiar" por entrada e "Copiar tudo" (ordem cronológica — mais antiga
primeiro — para ler como linha do tempo ao colar, mesmo com a tela mostrando
mais recente primeiro). Botão "Limpar" esvazia o histórico. O log **persiste
entre trocas de arquivo** dentro da mesma sessão, de propósito: só um clique
explícito em "Limpar" o esvazia. É rótulo explícito na interface: "Log
moderno da sessão, não uma reconstrução do `.LST` histórico do TabWin 4.15."

Limitado a 200 entradas em memória — é histórico de sessão, não trilha
persistida; sem isso uma sessão muito longa cresceria sem limite.

## VERIFICADO NO NAVEGADOR

`RDAC2401.dbc` real, duas tabulações em sequência (`MUNIC_RES`, depois
`SEXO`):

- histórico mostrou as duas entradas, mais recente (`SEXO`) no topo;
- `SEXO`: 2 linhas × 1 coluna, 4.315 vistos → 4.315 aceitos, 0 avisos;
- `MUNIC_RES`: 51 linhas × 1 coluna, mesmos vistos/aceitos — bate com o valor
  já verificado em sessões anteriores;
- "Limpar" esvaziou a lista e desabilitou os dois botões corretamente;
- console do navegador sem nenhum erro durante toda a sessão.

## LIMITAÇÃO DO AMBIENTE, VERIFICADA COMO TAL

Clicar em "Copiar tudo" e no "Copiar" por entrada dispara
`navigator.clipboard.writeText`, mas este painel de pré-visualização nega
permissão de escrita na área de transferência
(`NotAllowedError: Write permission denied`). Antes de aceitar isso como
limitação do ambiente, testei o botão "Copiar" da tabela — código já existente,
que eu não toquei — e obtive **o mesmo erro, palavra por palavra**. Confirma
que é restrição do painel, não defeito da funcionalidade nova. O tratamento
de erro da função (mostrar o erro real via toast, sem travar) funcionou
corretamente nos dois casos.

## GATE

`npm run check`: **157/157** testes, sem alteração no número desde a entrega
anterior — este recurso é composição de dados já existentes, não exigiu
função pura nova testável em isolamento. Typecheck do núcleo, typecheck web e
build Vite aprovados. G001 inalterado e ainda `pass` com tolerância zero.

## PRÓXIMO PASSO

Faixa 3.1 — cache de resultado L3, para reanálise não repetir uma passada
inteira sobre o arquivo.
