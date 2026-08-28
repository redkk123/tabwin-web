# Qualidade de dados entre campos

**Data:** 2026-08-28
**Status:** núcleo completo e testado; interface pendente.

## PROBLEMA

O usuário relatou o caso real: em sífilis em gestante havia uma gestante de 80
anos. Nenhuma das duas colunas é aberrante sozinha — só a combinação é. A
camada de qualidade existente (`profileNumericField`, faixas manuais, sugestão
de IQR) trabalha **um campo por vez**, então não alcança esse caso.

Filtros de campo único também não alcançam, e isso é estrutural: filtros se
intersectam. Excluir gestante **e** excluir idade acima de 55 mantém apenas
quem não é nem uma coisa nem outra. A regra precisa rejeitar quem é as duas ao
mesmo tempo. `NÃO (A E B)` não é `(NÃO A) E (NÃO B)`.

Isso está fixado como teste: sobre a mesma amostra de 6 registros, dois filtros
separados aceitam 1 registro; a regra cruzada aceita 5.

## O QUE FOI IMPLEMENTADO

### Camada 1 — regras cruzadas escritas pelo usuário

`CrossFieldRuleSpec` em `packages/core/src/model.ts`:

```ts
{
  id: 'gestante-idade',
  label: 'Gestante com idade acima de 55 anos',
  action: 'flag' | 'exclude',
  conditions: FilterSpec[],   // todas precisam aceitar o registro
}
```

As condições **reusam `FilterSpec` sem alteração**. Não existe semântica de
comparação nova neste módulo: CNV, faixa numérica, `startPosition`, `mode` e
categorias funcionam exatamente como num filtro comum. O que é novo é apenas a
conjunção e a ação.

- `flag` conta e não remove nada;
- `exclude` conta e remove o registro da tabulação.

A contagem é feita sobre **todos os registros vistos**, não sobre o subconjunto
que sobreviveu aos filtros: o diagnóstico descreve a fonte, não o recorte.

A exclusão mora em `resolvePlanRecord`, não no executor, para que todo
consumidor — tabulação e exportação de registros selecionados — aplique a mesma
política de limpeza em vez de divergir.

O resultado ganha `dataQuality`, presente **somente** quando há regras
declaradas. Assim nenhum golden, `.twtable` ou comparação existente muda de
byte. G001 revalidado: `pass: true`, tolerância zero.

### Camada 2 — indicador estatístico sem semântica

`profileFieldCombinations(records, fields, options)` em
`packages/analysis/src/data-quality.ts` conta a frequência de cada combinação e
devolve as **mais raras primeiro**, com participação no total.

Ele observa que uma combinação é rara. Ele nunca diz que ela está errada. A
chave é `JSON.stringify` do vetor de valores, então ausência (`null`) continua
distinta de string vazia e nenhum separador colide com dado real. É limitado
por `maxCombinations` e sinaliza `truncated`, para não estourar memória em
campos de alta cardinalidade.

### Camada 3 — deliberadamente não implementada

Nenhum preset clínico foi embutido. Afirmar "gestante acima de 55 é impossível"
seria inventar política epidemiológica, exatamente o que o projeto proíbe sem
oracle ou fonte citada. Continua registrado em
`explicitly_partial_or_unsupported` como
`clinical-cleaning-presets-without-authoritative-source`.

## VALIDAÇÃO E PROVENIÊNCIA

O compilador exige de cada regra: id único e não vazio, rótulo, ação válida,
**pelo menos duas condições** e **pelo menos dois campos distintos** — uma
condição só já é um filtro comum, e a regra existe justamente para o que o
filtro não expressa.

As condições passam pelo mesmo `validateFilter` usado pelos filtros comuns,
extraído para função compartilhada. Uma regra não consegue aceitar um predicado
que um filtro rejeitaria.

Toda regra emite aviso no plano de que é política moderna sem oracle do TabWin
4.15, e regras com `exclude` emitem um segundo aviso de que removem registros.
Os avisos entram na auditoria.

A receita já persiste o `spec` inteiro e o valida por `compileQueryPlan`, então
as regras ficam gravadas, versionadas e reexecutáveis **sem código novo**. Há
teste de ida e volta provando que a receita reexecutada limpa exatamente os
mesmos registros.

## PRINCÍPIO

A ferramenta sinaliza, o usuário decide, e toda exclusão fica gravada,
auditável e reversível. É o que separa tratamento de dado de adulteração
silenciosa, e é o que mantém o resultado defensável.

## GATE

`npm run check`: **132/132** testes (eram 121), typecheck do núcleo, typecheck
web e build Vite. G001 inalterado e ainda `pass` com tolerância zero.

## PENDENTE

A interface. O núcleo está pronto e testado, mas nada disso aparece na tela
ainda. Detalhado em `docs/handoffs/HANDOFF_CONTINUACAO_2026-08-28.md`.
