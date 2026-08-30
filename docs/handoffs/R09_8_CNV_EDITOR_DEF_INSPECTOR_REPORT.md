# R09.8 — editor de CNV e inspetor de DEF

**Data:** 2026-08-29
**Status:** completo e verificado em navegador real com `COMPLEX2.CNV` e
`RD2008.DEF` reais. Faixa 3 do roadmap fecha inteira nesta sessão.

## POR QUE

Os modelos de DEF e CNV já eram parseados e validados desde cedo no
projeto, mas só existiam por baixo — nenhuma interface deixava editar uma
CNV ou inspecionar o que o parser realmente entendeu de um DEF real. Uma
CNV errada ou incompleta é o tipo de problema que hoje só se descobre
exportando, editando em outro programa e reimportando; um DEF real (como o
`RD2008.DEF` nacional, com centenas de opções e dezenas de diretivas `X`
não documentadas) não tinha nenhuma visão linha a linha do que foi ou não
interpretado.

## POR QUE O ESCOPO É ASSIMÉTRICO

CNV ganhou um **editor** completo. DEF ganhou só um **inspetor**
somente-leitura. Não é uma limitação de tempo — é a mesma disciplina já
aplicada em todo o projeto (nunca adivinhar semântica sem evidência):

- O layout de `.CNV` de colunas fixas é documentado e reversível por
  completo para os modos `short`/`literal`/`numeric-ranges`. Só o `N`
  (new-format) não tem offsets confirmados — e o editor se recusa a
  serializá-lo, do mesmo jeito que `cnv-parser.ts` se recusa a interpretá-lo.
- `.DEF` real tem a diretiva `X` (48 ocorrências reais só no `RD2008.DEF`) e
  campos à direita em opções contemporâneas sem semântica executável
  documentada. Um editor teria que inventar o que essas coisas significam
  para poder reescrevê-las — exatamente o que este projeto se recusa a
  fazer em qualquer outro lugar (seleção manual de auxiliar, propriedade de
  GeoJSON, presets clínicos bloqueados por evidência). Inspecionar o que
  foi parseado, linha a linha, é o valor real e honesto aqui.

## O QUE FOI FEITO — CNV

`packages/formats/src/windows-1252.ts`: `encodeWindows1252`, contraparte de
escrita do `TextDecoder('windows-1252')` já usado em `map-parser.ts`,
`tabwin-biff.ts` e no próprio `main.ts` — a plataforma web só tem decoder
nativo para Windows-1252, `TextEncoder` é UTF-8 apenas. Tabela idêntica ao
índice windows-1252 do WHATWG Encoding Standard. Verificado contra os
**256** valores de byte possíveis via `TextDecoder` → `encodeWindows1252` →
comparação byte a byte, não uma amostra.

`packages/formats/src/cnv-serializer.ts`: `serializeCnv(definition)` grava
de volta o layout de colunas fixas exato que `cnv-parser.ts` lê (subtotal
1-3, sequência 4-7, rótulo 10-59, códigos 61+). Decisões de segurança:
recusa `new-format`; falha alto (nunca trunca silenciosamente) quando um
campo excede sua largura fixa ou contém `;` (que o parser leria como
início de comentário, corrompendo a linha na releitura); garante que toda
linha tenha pelo menos 61 caracteres mesmo quando os códigos estão vazios,
porque o parser em modo estrito rejeita qualquer linha mais curta **antes**
de preencher com espaços.

`packages/formats/src/cnv-validate.ts`: `validateCnvDefinition` reaplica os
mesmos diagnósticos que o parser calcula ao ler texto — mas contra o
**modelo**, porque um editor onde linhas são adicionadas, editadas e
removidas não tem mais um "número de linha original" estável para ancorar
diagnóstico. Cobre: contagem de categorias divergente do cabeçalho, rótulo
vazio, alvo de subtotal inexistente, categoria sem regra correspondente,
regra sem código/faixa, sequência duplicada, faixa numérica não monotônica.

Interface (`apps/web/index.html`, `apps/web/src/main.ts`,
`apps/web/src/styles.css`): diálogo "Editor de CNV" com tabela editável
(sequência, rótulo, subtotal/#, códigos/faixas), diagnósticos por linha
(borda vermelha + tooltip na linha com erro), prévia de classificação que
lê valores distintos de um campo do conjunto **realmente aberto**
(reaproveitando o mesmo `askDataset({type:'distinct', ...})` já usado pelo
seletor de filtro) e classifica cada um contra o modelo em edição via
`classifyCnv` — mostrando quantos valores distintos caem em cada categoria,
rotulado explicitamente como "valores distintos, não registros" para não
prometer precisão que a prévia não tem. Duas ações: **Aplicar ao conjunto
atual** (substitui a entrada em `cnvByName`, re-tabula na hora se a CNV
editada está em uso) e **Baixar .CNV** (serializa + codifica Windows-1252 +
baixa via `downloadBlob`, já existente no projeto). Ambas bloqueadas
enquanto houver erro (não aviso) nos diagnósticos.

## BUG REAL ENCONTRADO E CORRIGIDO NA PRÓPRIA VERIFICAÇÃO

A primeira versão listava as categorias na ordem de `definition.categories`
— que `cnv-parser.ts` **ordena por número de sequência** para exibição, não
na ordem real das linhas do arquivo. Para uma CNV real onde o fallback
amplo vem **primeiro** no arquivo (layout real confirmado no próprio
`COMPLEX2.CNV`: `00-99` na primeira linha, `01`/`02`/`03` depois), isso
invertia silenciosamente a precedência de sobreposição — `classifyCnv` usa
`last-match-wins` para código curto, e com a ordem errada o fallback virava
a "última" regra, vencendo sobre os códigos específicos.

Pego na própria verificação em navegador: com a CNV real carregada, a
prévia de classificação contra o campo `COMPLEX` mostrava os dois valores
reais (`02`, `03`) caindo ambos em "Não se aplica" — quando deveriam cair
em "Média complexidade" e "Alta complexidade" respectivamente. Corrigido em
`rowsFromDefinition` para ordenar por `rules[].sourceOrder`, nunca por
`categories`. Reverificado: cada valor caiu na categoria certa, e uma
tabulação real com a edição aplicada reproduziu **exatamente** os números
já conferidos contra o TabWin 4.15 real no G001 (4.153 / 162).

## O QUE FOI FEITO — DEF

Inspetor somente-leitura (`#def-inspector-dialog`), habilitado assim que um
`.DEF` é carregado. Mostra: descrição, fontes de dados (`A`), tabela de
opções com diretiva/rótulo/campo/papéis/origem (CNV, DBF ou recurso
externo) e campos à direita não interpretados, incrementos (`I`), outras
diretivas (`G`/`R`), avisos, comentários preservados, e — a parte que não
existia de forma nenhuma antes — as **linhas não reconhecidas**, com texto
bruto e número da linha, não apenas uma contagem.

## VERIFICADO EM NAVEGADOR COM ARQUIVOS REAIS

`COMPLEX2.CNV` real: editor carregou as 4 categorias reais na ordem certa,
zero diagnóstico (arquivo bem formado). Prévia contra `COMPLEX` do
`RDAC2401.dbc` real confirmou o bug acima e sua correção. Edição de rótulo
aplicada ao conjunto atual e confirmada numa tabulação real (números batendo
com G001). Download inspecionado byte a byte: `ã` codificado como `0xE3`
(Windows-1252 correto), quebras de linha CRLF, layout de colunas intacto,
rótulo editado presente. Diagnóstico de erro (sequência duplicada testada
manualmente) bloqueou corretamente Aplicar e Baixar, com feedback visual na
linha errada.

`RD2008.DEF` real (arquivo nacional de produção, não um fixture pequeno):
inspetor renderizou a descrição, todas as fontes de dados e centenas de
opções reais (incluindo os lookups de CNES por UF), e surfaceou **48 linhas
`X` não reconhecidas** com **65 avisos** correspondentes — informação que
antes só existia como uma contagem (`unresolvedLines: N`) no JSON de
auditoria.

Console sem erro em toda a sessão de teste, nos dois fluxos.

## GATE

`npm run check`: **207/207** testes (eram 184), typecheck do núcleo,
typecheck web e build Vite, todos limpos. G001 inalterado.

## LIMITE DELIBERADO

DEF permanece somente-leitura — nenhum plano de virar editor até `X` e os
campos à direita de DEFs contemporâneos terem evidência documentada real,
pelos mesmos motivos já registrados em "Bloqueados por evidência" no
roadmap. CNV não escreve `new-format` (`N`) pelo mesmo motivo que não lê:
offsets não confirmados.

## PRÓXIMO PASSO

Faixa 3 do roadmap fecha inteira com este item. Próximo bloco é a Faixa 4 —
dominada pela bateria de goldens G002+ (captura manual, já em andamento
pelo usuário) e, em paralelo de código, um e2e mínimo (4.8) como já
recomendado no roadmap.
