# Handoff — onde parei em 2026-08-28

Para quem continuar o TabWin Web, humano ou modelo. Leia junto com
`CHECKPOINT_MASTER.md` e `PROJECT_STATE.json`.

## ESTADO

Tudo commitado e enviado para a `main` de `redkk123/tabwin-web`. Working tree
limpo. Gate `npm run check` verde. G001 inalterado e ainda `pass` com
tolerância zero.

O site publicado no GitHub Pages **continua atrás de todos os commits abaixo**.
Nenhum deploy foi autorizado.

## AMBIENTE

VM Windows no Google Cloud. O `winget` não instala Node aqui — o MSI exige
elevação UAC impossível numa sessão headless. Node 24.19.0 portátil em:

```
C:\Users\angelogabriel860\tools\node-v24.19.0-win-x64
```

Já está no PATH do usuário; sessões antigas precisam do prefixo. Depois de
`npm ci`, rode `npm rebuild esbuild workerd` — o npm 11.17 bloqueia postinstall
e o build Vite falha sem os binários de plataforma.

Projeto em `C:\projetos\tabwin-web\TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26`.
Assets privados do oracle fora do Git em `C:\projetos\tabwin-private\oracle\`,
incluindo agora `large/DENGBR25.dbc` baixado do DATASUS.

Regras de convivência e backup em `C:\projetos\PROTOCOLO_VM_COMPARTILHADA.md`.
Histórico do que foi feito em `C:\projetos\OPERACOES_LOG.md`. Backup antes de
qualquer operação de risco: `C:\projetos\scripts\backup-tabwin.ps1`.

## O QUE FOI ENTREGUE HOJE

| Commit | Entrega |
| --- | --- |
| `5f9cc8a` | Restauração da árvore de trabalho do kit de migração, que só existia em disco |
| `53a4645` | Leitura de registros em blocos limitados |
| `bb440a8` | **Correção crítica**: consulta nacional devolvia catálogo vazio |
| `909d547` | Regras de qualidade cruzadas entre campos |
| `d7ade22` | Agregação da tabulação dentro do Worker |
| `ba1aa14` | Forma incremental limitada para todo consumidor de registros |
| `fafd88b` | Medição de onde vai o tempo ao abrir um DBC |

Cada um tem relatório em `docs/handoffs/`.

## A CORREÇÃO QUE MAIS IMPORTA

`expandDatasusSearchSelection` removia a UF quando o valor era `BR`, apoiada num
comentário afirmando que o catálogo oficial representa cobertura nacional
omitindo a UF. A premissa é falsa: o endpoint exige `uf[]=BR`.

Consequência: **buscar qualquer arquivo nacional no app sempre devolvia "nenhum
arquivo encontrado"** — os 58 tipos do SINAN, SINASC/DNEX, SIM/DO, PO. Os testes
fixavam a omissão defeituosa, então passavam enquanto o produto não funcionava.

Detalhes e evidência em `CRITICAL_NATIONAL_CATALOG_UF_FIX_REPORT.md`.

## O BLOQUEIO QUE CONTINUA

`DENGBR25.dbc` ainda não abre na interface. O que já existe:

- decodificador PKWARE DCL que emite blocos de 4 KiB, provado byte a byte;
- montagem de registros através de fronteiras arbitrárias de bloco, provada
  idêntica ao leitor publicado sobre o `RDAC2401.dbc` real;
- acumulador de tabulação incremental, limitado por células distintas e não por
  registros, provado idêntico à execução de uma vez;
- Worker que agrega e devolve só a tabela;
- forma incremental limitada para perfil numérico, combinações, valores
  distintos e exportação de selecionados.

Falta a última milha, e ela **não é ligar fio na interface**. Ver abaixo.

## POR QUE NÃO BASTA LIGAR NA INTERFACE

Medido, não estimado (`npm run bench:decode-breakdown`):

- descompressão DCL: 35 ms sobre o `RDAC2401.dbc`;
- bytes mais registros: 386 ms sobre o mesmo arquivo;
- **91% do tempo é criar objeto JavaScript de registro**, não descomprimir.

O `DENGBR25.dbc` real tem **1.643.215 registros**, 326 bytes cada, 121 campos,
511 MiB de DBF declarado. Uma passada completa custa da ordem de dois a três
minutos nesta VM.

Isso descarta dois desenhos:

1. Worker guarda os bytes e re-decodifica a cada análise — trocar um filtro
   custaria minutos.
2. Guardar registros como objeto JavaScript — 1,2 milhão de registros já custou
   376 MiB medidos.

## A PROJEÇÃO JÁ RESOLVEU O BLOQUEIO

`packages/core/src/plan-fields.ts` enumera os campos que o plano lê, e o fluxo
em blocos aceita `fields` para decodificar só esses. Medido sobre o Dengue real
com `npm run bench:plan-projection`:

| Caminho | Tempo |
| --- | --- |
| Só descompressão DCL | 7,3 s |
| Tabulação com os 3 campos do plano | **13,2 s** |
| Tabulação com os 121 campos | 190,9 s |

Resultado idêntico nos dois casos: 4.815 linhas, 1.629.310 registros aceitos.

Isso é de baixo risco semântico porque o executor continua recebendo
`DataRecord` e rodando o mesmo código; o ganho vem de decodificar 3 campos em
vez de 121.

**Portanto o armazenamento colunar não é mais pré-requisito.** Ele continua
valendo como otimização de reanálise, levando 13 s para milissegundos, mas não
bloqueia o Dengue. O piso é a descompressão: 7,3 s dos 13,2 s.

Se alguém for mesmo implementar o colunar: cardinalidade medida no Dengue não
passa de 29.539 por coluna, índice de 2 bytes serve para todas, e as 121
colunas somam cerca de 228 MiB. E a regra que não pode ser quebrada: qualquer
executor colunar precisa **provar igualdade com `resolvePlanRecord`** antes de
substituí-lo, do mesmo jeito que o acumulador em lotes foi provado. G001
sozinho não cobre CNV, `startPosition`, faixas numéricas, não classificados nem
regras cruzadas.

## O QUE FALTA DE VERDADE

Ligar o caminho na interface, e como **caminho único**, não como desvio para
arquivo grande. O `main.ts` ainda carrega registros para um array residente e
seis consumidores leem esse array. Todos já têm forma incremental limitada
(`ba1aa14`), então a troca é mecânica: uma passada em lote alimentando os
acumuladores, com o Worker devolvendo só resultado.

## OUTRAS PENDÊNCIAS

- Interface para regras cruzadas e perfil de combinações: o núcleo está pronto
  e testado, mas nada aparece na tela.
- Propagar a modalidade preliminar até a auditoria e a receita. O DATASUS
  resolve preliminar contra final pelo ano consultado, e o app já recebe
  `modality`, mas ela para na lista do catálogo.
- CI do GitHub Actions bloqueado por billing da conta, não por teste vermelho.
- Deploy do Pages nunca autorizado.

## O QUE NÃO FAZER

- Não adicionar `SINAN_P` nem `ESUSNOTIFICA_p` ao seletor. Foram medidos:
  devolvem resposta idêntica a `SINAN` e `ESUSNOTIFICA`. Ver a correção em
  `SINAN_CATALOG_AUDIT_2026-08-28.md`.
- Não alterar golden nem G001 para fazer teste passar.
- Não criar um segundo caminho de leitura só para arquivo grande. O ponto do
  trabalho de hoje foi justamente evitar isso.
- Não confiar em teste verde como prova de que o produto funciona: o bug do
  `uf=BR` passou por 121 testes verdes.
