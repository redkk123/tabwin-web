# G023 — formato `.TAB` (salvar/reabrir)

**Semântica sob teste:** o formato do arquivo `.TAB` que o TabWin 4.15 grava
quando você salva uma tabela.

**Estado:** capturado em 2026-08-31, leitura provada. Escrita fora de escopo.

## O que este golden prova

O `.TAB` **não é um container binário** — é texto Windows-1252 com CRLF,
sem BOM, abrindo na linha literal `NEW`, com preâmbulo `chave=valor`,
seções `[Opções]` e `[Arquivos]`, e uma matriz `;`-separada com aspas.

Isso corrige uma suposição de trabalho. `packages/formats/src/legacy-tab.ts`
foi escrito como reconhecimento binário justamente porque não havia arquivo
real para conferir; ele nunca afirmou saber reproduzir o painel, e listava
`plain-text` entre as hipóteses que sabia relatar. Este artefato resolve a
questão para este caminho de gravação.

## Por que este caso e não outro

O `.TAB` foi salvo na **mesma execução** que gerou o G002, cujo resultado já
era conhecido célula por célula através de um caminho de exportação
independente (o BIFF `result.xls`). O leitor não está sendo validado contra a
própria leitura de um arquivo desconhecido — está sendo conferido contra uma
tabela da qual este projeto já tinha golden separado e anterior.

Os dois concordam exatamente. `tests/tab-file.test.mjs` faz essa comparação
como asserção, então uma regressão no leitor quebra o teste.

## O que continua desconhecido

Uma amostra não define um formato. Estão registrados como valor bruto, sem
tradução: o marcador `NEW`, o código `Não_Classificados=0`, a existência de um
`Titulo1` que este arquivo não traz, e qualquer formatação decimal — todas as
células aqui são inteiras. Ver `reference-tabwin415/capture-notes.md`.

Escrever `.TAB` exige campos provados estáveis em **vários** artefatos reais.
Um não são vários.
