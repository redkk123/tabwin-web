# R10.14 — Microdatasus filtrável pelo próprio aplicativo

**Data:** 2026-08-30
**Estado:** concluída. Gate **291/291**, E2E **11/11**.

## A ideia, e o que faltava

Uma das duas ideias que você tinha esquecido: baixar e filtrar microdados do
DATASUS **sem R e sem FTP manual**. O catálogo oficial já resolvia o download —
sistema, tipo, múltiplos anos/meses/UFs, lote determinístico, cache local. O que
faltava era a saída: poder levar embora exatamente o subconjunto que está na
tela.

## A decisão que sustenta tudo

`packages/export/src/microdatasus.ts` usa o **mesmo `resolvePlanRecord`** que a
tabulação usa para aceitar ou rejeitar um registro. Não há segunda semântica de
filtro. Se a tabela diz 2.092 registros aceitos, o CSV tem 2.092 linhas — e a UI
recusa o download se `rowsEmitted` não bater com `recordsAccepted`.

Para expor isso, o `resolveDimension` do executor virou `resolveDimensionValue`
exportado. É o mesmo código, não uma cópia: CNV, lookup DBF, `startPosition` e
unclassified continuam com uma implementação só.

## Rótulo legível sem adivinhação

Todo campo bruto do DBF está sempre presente. Uma coluna `CAMPO__ROTULO` é
acrescentada **só** quando o DEF ativo aponta para exatamente uma conversão ou
tabela auxiliar que está carregada e é executável (opções com papel de seleção
ganham quando isso desempata). Havendo duas CNVs concorrendo para o mesmo campo,
fica só o bruto.

Isso importa: escolher em silêncio entre duas CNVs produziria um CSV com rótulos
que ninguém pediu e que ninguém consegue auditar depois.

## Proveniência

Colunas opcionais por arquivo de origem — fonte, sistema, tipo, ano, mês, UF —
preenchidas a partir da consulta do catálogo quando o dado veio do fluxo DATASUS.
Num CSV que combina meses ou UFs, é a diferença entre um arquivo reproduzível e
um monte de linhas sem origem.

## Formato

UTF-8 com BOM, `;` como delimitador, CRLF, e escape de aspas, quebras de linha e
do próprio delimitador. É o que o Excel brasileiro abre sem perguntar nada.

## Streaming, e o teto que fica

O Worker varre as fontes em lotes e emite blocos transferíveis; o dataset
decodificado nunca vai para a thread principal. Mas o download final precisa das
partes juntas num `Blob`, então **o CSV cresce na heap do navegador**.

Daí o teto explícito de **512 MiB**, que o Worker verifica enquanto emite e
interrompe com uma mensagem que diz o que fazer. Remover o teto sem trocar o
destino por um sink gravável (File System Access API, com fallback para quem não
tem) seria trocar um limite honesto por um OOM. Fica registrado como o próximo
corte, não como pendência escondida.

## Verificação

- `npm run check`: **291/291** (eram 289).
- 2 testes do ChatGPT sobre o encoder: PASS, sem alteração.
- `npm run e2e`: **11/11**, com dois casos novos:
  - o CSV tem cabeçalho mais uma linha por registro aceito, com os campos brutos;
  - **um filtro aplicado na tabulação chega ao CSV**: filtrando UF por `AC`, o
    arquivo cai para dois registros e a string `AM` não aparece em lugar nenhum
    dele.

O segundo é o teste que importa. Ele prova a afirmação central da faixa — que o
CSV é o subconjunto da tabulação, não uma segunda consulta parecida.

## Detalhe da integração

O botão Microdatasus é desabilitado nos mesmos três pontos que o "Salvar seleção
em DBF": ao iniciar uma nova tabulação, ao abrir uma tabela portátil (que não
tem registros por trás) e antes de qualquer resultado existir. Um CSV gerado a
partir do plano anterior seria, em silêncio, o subconjunto errado.
