# Prompt pronto para o Claude

Copie e envie o texto abaixo quando o Claude voltar:

---

Retome o TabWin Web em
`C:\projetos\tabwin-web\a raiz do repositório`.

Antes de agir, leia integralmente:

1. `C:\projetos\PROTOCOLO_VM_COMPARTILHADA.md`
2. `C:\projetos\OPERACOES_LOG.md`
3. `docs/handoffs/CODEX_TO_CLAUDE_HANDOFF_2026-08-28.md`
4. `docs/product/ROADMAP_POR_COMPLEXIDADE.md`
5. `docs/handoffs/R09_1_CROSS_FIELD_QUALITY_UI_REPORT.md`
6. `docs/handoffs/R09_2_RARE_COMBINATION_PROFILE_UI_REPORT.md`

Não repita a auditoria do Codex e não refaça as Faixas 2.1/2.2: elas já estão
na `main` nos commits `fddb5cd` e `fab6caa`, com gate 149/149 e testes reais no
`RDAC2401.dbc`.

Siga as regras de convivência: sincronize a `main`, adquira `LOCK.md` antes de
editar, preserve qualquer alteração alheia, não altere G001, faça backup antes
de commitar, rode `npm run check`, faça commit pequeno, push imediato, atualize
o log e libere a trava. Não faça deploy sem autorização.

Ataque agora a estrutura em ordem crescente, começando pela **Faixa 2.3 —
tabela virtualizada**. O corte atual está em `renderTable`, dentro de
`apps/web/src/main.ts`, com limite fixo de 500. Implemente janela + overscan
sobre `currentTableRowIndexes()`, preserve totais sticky, busca e ordenação,
mantenha exportação/cópia sobre o resultado completo e garanta impressão
completa via `beforeprint`/`afterprint`. Crie um helper puro testável para o
cálculo da janela. Valide no navegador que é possível rolar pelas 1.927 linhas
municipais do Dengue sem truncamento e sem inflar o DOM inteiro.

Quando 2.3 estiver verde e enviada, siga para 2.4 e depois 3.1, sempre em
unidades pequenas. Não invente semântica clínica, compatibilidade legada ou
formato `.LST` sem evidência; o log 2.4 deve ser explicitamente moderno.

---
