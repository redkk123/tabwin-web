# R09.2 — Interface do perfil de combinações raras

**Data:** 2026-08-28  
**Escopo:** Faixa 2.2 do roadmap por complexidade

## Entrega

A interface permite escolher dois campos e pedir ao Worker o perfil das 50
combinações menos frequentes. O Worker projeta somente os campos escolhidos e
alimenta o acumulador incremental já provado, sem devolver registros à thread
principal.

Cada linha informa os dois valores observados, número de registros e
participação no conjunto. O texto da interface afirma explicitamente que
raridade não significa erro.

O botão `Criar regra` transforma a combinação observada em uma
`CrossFieldRuleSpec` com ação inicial `flag`. Valores ausentes permanecem
representáveis como condição explícita. A exclusão só acontece se o usuário
revisar a regra e alternar sua ação depois.

## Verificação

- `npm run check`: 149/149 testes, typecheck web e build Vite.
- Navegador, `RDAC2401.dbc` real: perfil de `MUNIC_RES` + `SEXO` exibiu as 50
  combinações menos frequentes entre 4.315 registros.
- Primeira combinação: `MUNIC_RES=110045`, `SEXO=3`, 1 registro, 0,023%.
- `Criar regra` produziu uma sinalização com `matchedRecords=1`.
- Console do navegador sem erros ou avisos.
- G001 não foi alterado.

## Próximo passo

Faixa 2.3: substituir o corte visual de 500 linhas por tabela virtualizada,
sem alterar o resultado completo mantido em memória.
