# R11.4 — Pipeline de transformação e limpeza manual

**Data:** 2026-08-30
**Estado:** concluída para um primeiro corte de cinco tipos de etapa. Gate
**326/326**, E2E **17/17**.

## O que existia e por que não bastava

"Limpeza assistida" já existia (perfil numérico, faixa válida, regras
cross-field `flag`/`exclude`) mas só sabe **filtrar** — nunca renomear uma
coluna, recodificar um valor, marcar um código sentinela como ausente ou
deduplicar. Nenhuma combinação de filtros existentes expressa "M/F vira
Masculino/Feminino" ou "9 e 99 são ausentes neste campo". A spec do ChatGPT
(seção 5, "Módulo A") pede quatorze tipos de etapa, código R/Python
equivalente e reexecução com detecção de drift de schema — semanas de
trabalho pelo cronograma do próprio autor. Esta rodada entrega um núcleo
real e útil, não o módulo inteiro.

## Escopo: cinco tipos de etapa, não quatorze

`packages/core/src/transform-pipeline.ts` implementa `select-columns`,
`filter-rows`, `recode`, `missing-value-policy` e `dedupe`. Ficam de fora
desta rodada: `mutate()` por fórmula (adiado de propósito — é o mesmo motor
de expressões que R11.5 vai construir para as fórmulas estilo Excel;
construir duas vezes seria desperdício), `cast`/tipo, extração de
data/texto/código, `join` de microdados, `bind_rows` (o "Combinar
DBC/DBF" já existente cobre o caso comum), `group_by()+summarise()`
(a tabulação comum já cobre count/sum/mean/min/max agrupado), "ver código
equivalente" em R/Python, e reexecução com detecção de schema drift.

## Decisão de arquitetura: aplicar substitui o conjunto ativo, como um `append`

Cada etapa é validada e executada contra a lista de campos **como ela está
naquele ponto do pipeline** — uma etapa `select-columns` mais cedo pode
derrubar ou renomear um campo que uma etapa mais tarde depende, e essa etapa
posterior tem que falhar claramente (`field X does not exist at this point
in the pipeline`), nunca operar sobre `undefined` em silêncio. Aplicação é
tudo-ou-nada: a primeira etapa inválida ou que falhe lança, e quem chamou
não recebe resultado parcial — o mesmo padrão transacional que o resto do
projeto já usa para trocar de conjunto de dados.

O motor (`applyTransformPipeline`) é puro — `DataRecord[]` para dentro,
`DataRecord[]` para fora, sem I/O — e roda no Worker (`transform-apply`),
que materializa toda fonte retida (mesmo uma fonte binária DBC/DBF
normalmente decodificada por streaming, nunca residente) num array e
**substitui** `sources`/`header` do Worker pelo resultado, exatamente como
`append` já faz. Não existe variante "em memória, sem substituir": uma etapa
pode reescrever ou remover valores de um jeito que nada a jusante consegue
desfazer, então a saída do pipeline *tem* que virar a nova fonte de verdade
residente.

Renomear um campo perde o nome original visto por fora — para que o Worker
consiga reconstruir `DbfField.type/length/decimalCount` do campo renomeado
sem inventar nada, `TransformPipelineResult.fields` carrega
`{ name, originalName }` por campo, rastreado através de qualquer número de
etapas `select-columns` em sequência (testado: renomear duas vezes seguidas
ainda aponta pro nome original de verdade).

## "Aplicar" é idempotente por construção

A primeira versão desta função reaplicava o pipeline sobre o que já estivesse
ativo no Worker — e um segundo clique em "Aplicar" (ou editar uma etapa e
reaplicar) compunha sobre a própria saída anterior. Uma etapa `select-columns`
já tendo derrubado um campo fazia uma etapa anterior no pipeline "sumir" na
segunda rodada, porque o Worker via aquele campo como ausente. Corrigido
antes de qualquer teste existir: `runTransformPipeline()` sempre reabre os
arquivos originais primeiro (`rebuildSourcesFromOriginalFiles()`, extraída da
recuperação de falha que já existia) e só então aplica — cada clique em
"Aplicar" começa do mesmo lugar, sempre. Achado e corrigido durante a
verificação manual no navegador, antes do E2E existir; o E2E cobre
explicitamente aplicar duas vezes seguidas e exige resultado idêntico.

"Restaurar dados originais" reabre os mesmos arquivos sem aplicar nada — as
etapas continuam na lista para revisar ou reaplicar, porque descartar o
resultado não é o mesmo que descartar o trabalho de configurar o pipeline.

## A tela: "Transformar dados", no mesmo lugar que Limpeza e Filtros

Um `<details>` a mais na barra lateral, ao lado de "Limpeza assistida" e
"Regras cruzadas" — cinco formulários (um por tipo de etapa), uma lista de
etapas adicionadas com remoção individual, "Aplicar pipeline" e "Restaurar
dados originais". Reaproveita `matchesFilters`/`validateFilter`/
`validateCrossFieldRuleShape` (agora exportadas de `plan.ts`) para o passo
`filter-rows`, em vez de reinventar validação de filtro.

Cortes deliberados na UI, para caber no tempo desta rodada: `select-columns`
só marca quais colunas manter (renomear já existe no motor e nos testes,
mas não tem campo de texto na tela ainda); `filter-rows` aceita só um
filtro por etapa, valores digitados separados por vírgula em vez do
seletor de categorias com checkbox que "Filtros e seleções" já tem;
reordenar colunas não está na lista. Nenhum desses é regressão — são
recortes explícitos, documentados aqui para a próxima rodada.

## Verificação

- `npm run check`: **326/326** (315 novos vindos do núcleo: 14 testes do
  motor, incluindo o rastreamento de `originalName` através de dois
  renomeios seguidos e a atomicidade tudo-ou-nada; mais o refactor de
  `plan.ts`, coberto pelos testes já existentes de filtro/regra cruzada,
  inalterados).
- `npm run e2e`: **17/17**, com um caso novo que monta um pipeline de cinco
  etapas (recodificar SEXO, marcar EVOLUCAO="ignorado" como ausente,
  filtrar IDADE≥10, deduplicar por SEXO+EVOLUCAO, manter só três colunas),
  confere as contagens antes/depois de cada etapa, confirma que os campos
  em toda a aplicação refletem o novo schema, aplica duas vezes seguidas e
  exige resultado idêntico, e por fim restaura os dados originais e
  confirma que os valores brutos (`F`/`M`, não `Feminino`/`Masculino`) e
  todas as colunas voltam exatamente como estavam.
- Verificação manual no navegador com um dataset sintético (40 registros de
  referência difusos + 20 registros de grupo, o mesmo desenho do R11.3) foi
  o que encontrou o defeito de idempotência antes do E2E existir.
