# R09.1 — Interface de regras cruzadas de qualidade

**Data:** 2026-08-28  
**Escopo:** Faixa 2.1 do roadmap por complexidade

## Entrega

A interface agora cria regras explícitas com duas condições sobre campos
distintos. Cada condição pode comparar um valor original, usar limite numérico
inclusivo ou exclusivo, ou declarar uma faixa inclusiva.

As regras ativas:

- entram em `TabulationSpec.crossFieldRules` sem caminho paralelo de execução;
- alternam entre apenas sinalizar e excluir correspondências;
- mostram `matchedRecords` devolvido pelo Worker;
- são removíveis e reexecutam a análise automaticamente;
- sobrevivem ao salvamento e à abertura de receitas, inclusive com conversões
  já referenciadas por receitas existentes;
- nunca embutem significado clínico ou epidemiológico.

O resultado ganhou um painel separado que informa a contagem por regra e deixa
explícito se os registros foram somente sinalizados ou retirados da tabulação.

## Verificação

- `npm run check`: 149/149 testes, typecheck web e build Vite.
- Navegador, `RDAC2401.dbc` real: regra `MUNIC_RES = 120040` combinada com
  `IDADE >= 0` encontrou 1.789 registros.
- No modo `flag`, os 1.789 registros foram apenas sinalizados.
- Após alternar para `exclude`, a mesma contagem foi exibida como excluída.
- Console do navegador sem erros ou avisos.
- G001 não foi alterado.

## Próximo passo

Faixa 2.2: expor o perfil de combinações raras e permitir criar uma regra a
partir de uma combinação observada, sem atribuir significado clínico a ela.
