# Correção crítica — consulta nacional devolvia catálogo vazio

**Data:** 2026-08-28
**Severidade:** alta — impedia baixar qualquer arquivo de abrangência nacional.

## SINTOMA

Buscar Dengue, ou qualquer outro tipo do SINAN, pela busca oficial do
aplicativo sempre respondia *"Nenhum arquivo encontrado para essa combinação. O
período pode ainda não ter sido publicado."* O arquivo existe e sempre existiu.

## CAUSA

`expandDatasusSearchSelection` tratava `BR` como um sentinela apenas de
interface e **removia** a UF da consulta:

```ts
// The official catalog represents national coverage by omitting UF.
// `BR` is only the explicit multi-select UI sentinel.
...(uf === 'BR' ? {} : { uf }),
```

A premissa do comentário é falsa. O endpoint oficial exige `uf[]=BR` para
arquivos nacionais e responde `[]` quando a UF é omitida.

A interface agravava o efeito: para tipos de cobertura `BR` ela esconde o
seletor de UF (`catalogUfLabel.hidden = type?.coverage === 'BR'`) e deixa
`Brasil` marcado por padrão. O usuário não tinha nada para corrigir — a
seleção estava certa e era descartada na compilação da consulta.

## EVIDÊNCIA

Medido diretamente contra `datasus.saude.gov.br/wp-content/ftp.php` em
2026-08-28, mesma requisição com e sem `uf[]=BR`:

| Fonte | Tipo | Ano | Sem `uf` | Com `uf=BR` |
| --- | --- | --- | --- | --- |
| SINAN | DENG | 2024 | 0 arquivos | `DENGBR24.dbc` |
| SINASC | DNEX | 2023 | 0 arquivos | `DNEX2023.dbc` |
| SIM | DO | 2023 | 0 arquivos | 1 arquivo |
| PO | PO | 2019, 2021, 2022 | 0 arquivos | 1 arquivo |
| SIM | DOFET | 2023 | 1 arquivo | 1 arquivo |

Nenhuma consulta observada perdeu resultado por enviar `uf[]=BR`. O caso
`SIM/DOFET` mostra que enviar a UF é inofensivo mesmo onde a omissão já
funcionava.

## CORREÇÃO

A cobertura nacional passa a viajar como o token explícito `BR`, com a
evidência registrada no próprio código. `catalogQueryLabel` continua exibindo
`Brasil` para o usuário, agora tratando `BR` e a ausência de UF do mesmo jeito.

## VERIFICAÇÃO END-TO-END

Pelo caminho de consulta do próprio aplicativo, contra o serviço oficial:

```text
SINAN/DENG/2024/BR  -> DENGBR24.dbc
SINAN/DENG/2025/BR  -> DENGBR25.dbc
SINASC/DNEX/2023/BR -> DNEX2023.dbc
SIHSUS/RD/2024/AC   -> RDAC2401.dbc
```

O `DENGBR25.dbc` que motivou todo o trabalho de execução em blocos agora é
localizável pelo aplicativo. O caminho por UF não regrediu.

## REGRESSÃO

`tests/datasus.test.mjs` fixa que a seleção nacional produz `uf: 'BR'` e que
`buildSearchBody` emite `uf[]=BR`. `tests/research.test.mjs` foi atualizado
pelo mesmo motivo: ambos os testes fixavam a omissão defeituosa, então
passavam enquanto o produto não funcionava.

## OBSERVAÇÃO

Este defeito é a razão prática pela qual o `DENGBR25.dbc` precisou ser obtido
fora do aplicativo. Abrir o arquivo continua dependendo da execução em blocos;
**encontrá-lo** já não depende mais de nada.
