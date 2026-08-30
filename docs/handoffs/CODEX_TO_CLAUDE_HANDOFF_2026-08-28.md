# Handoff Codex → Claude — 2026-08-28

## Estado exato

- Repositório: `C:\projetos\tabwin-web\TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26`
- Branch: `main`, sincronizada com `origin/main`.
- Últimos commits funcionais:
  - `fddb5cd` — interface das regras cruzadas de qualidade (Faixa 2.1).
  - `fab6caa` — perfil de combinações raras e ponte para regra (Faixa 2.2).
  - `683c416` — auditoria do trabalho anterior e fechamento da Faixa 1.
- Gate: `npm run check` verde, **149/149**, typecheck web e build Vite.
- G001 não foi alterado e continua com tolerância zero.
- Nenhum deploy foi autorizado; GitHub Pages continua atrás da `main`.

## O que o Codex entregou nesta retomada

### Faixa 2.1

- Editor de duas condições sobre campos distintos.
- Comparação exata, limites inclusivos/exclusivos e faixa numérica.
- Ação alternável entre `flag` e `exclude`.
- Lista ativa, remoção, reexecução e `matchedRecords` visível.
- Persistência/replay em receita, inclusive conversões referenciadas.
- Teste real no `RDAC2401.dbc`: `MUNIC_RES=120040` + `IDADE>=0` encontrou
  1.789 registros; sinalização e exclusão exibiram a mesma contagem.
- Relatório: `docs/handoffs/R09_1_CROSS_FIELD_QUALITY_UI_REPORT.md`.

### Faixa 2.2

- Mensagem `profile-combinations` no Worker, com projeção apenas dos dois campos.
- Ranking das 50 combinações menos frequentes, com contagem e participação.
- Um clique cria `CrossFieldRuleSpec` inicialmente em `flag`; raridade nunca é
  classificada automaticamente como erro.
- Teste real no `RDAC2401.dbc`: `MUNIC_RES=110045` + `SEXO=3`, 1 registro,
  0,023%; regra criada com `matchedRecords=1`.
- Relatório: `docs/handoffs/R09_2_RARE_COMBINATION_PROFILE_UI_REPORT.md`.

## Onde parar e retomar

A Faixa 2.3 foi apenas analisada; **nenhum código de virtualização foi escrito**.
O ponto atual continua em `renderTable`, em `apps/web/src/main.ts`: ela corta
em 500 linhas. `.table-wrap` já tem `max-height: 470px` e `overflow: auto`.

Próxima unidade recomendada: tabela virtualizada com janela e overscan,
preservando:

- `currentTableRowIndexes()` como fonte de ordenação e busca;
- rodapé de totais sticky;
- exportação e cópia sobre o resultado completo, nunca sobre a janela DOM;
- impressão completa (renderizar todas as linhas durante `beforeprint` e
  restaurar a janela em `afterprint`);
- acesso por rolagem às 1.927 linhas municipais do Dengue, sem aviso/corte 500.

Vale extrair um helper puro de cálculo da janela e cobri-lo com testes antes de
ligar ao DOM. Depois validar no navegador, idealmente com
`C:\projetos\tabwin-private\oracle\large\DENGBR25.dbc`.

## Ordem depois da Faixa 2.3

1. Faixa 2.4 — log moderno da tabulação, sem alegar equivalência `.LST`.
2. Faixa 3.1 — cache L3 de resultado.
3. Começar captura dos goldens G002–G006 em paralelo quando houver operador do
   TabWin 4.15.

## Regras obrigatórias

Leia antes de editar:

- `C:\projetos\PROTOCOLO_VM_COMPARTILHADA.md`
- `C:\projetos\OPERACOES_LOG.md`
- `docs/product/ROADMAP_POR_COMPLEXIDADE.md`
- este handoff e os dois relatórios R09.1/R09.2.

Depois: `git pull --rebase`, criar `C:\projetos\LOCK.md`, não tocar em G001,
não inventar preset clínico, rodar backup antes do commit, `npm run check`,
commit pequeno, push imediato, registrar no log e liberar a trava.

Não refazer a auditoria já fechada e não reimplementar 2.1/2.2.
