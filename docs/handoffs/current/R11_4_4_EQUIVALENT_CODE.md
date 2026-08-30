# R11.4.4 — "Ver código equivalente" (dplyr / pandas)

**Data:** 2026-08-30
**Estado:** concluída. Gate **378/378**, E2E **22/22**.

## Por que

Direto da conversa com o ChatGPT de 2026-08-30 sobre o curso do Wanderson:
*"o iniciante faz pela interface, mas consegue aos poucos enxergar o que
aquela operação significaria em R/Python. Isso seria muito foda
pedagogicamente."* A spec formaliza em 5.6 ("Ver código equivalente —
recurso pedagógico, não runtime").

## O que é, e o que explicitamente não é

`packages/analysis/src/transform-pipeline-code.ts` renderiza o pipeline de
transformação como código R (dplyr) ou Python (pandas). É **só leitura, uma
via**: o código é derivado do plano, nunca o contrário — não existe parser de
volta, e nada aqui é executado. A fonte da verdade continua sendo o contrato
do TabWin Web.

Onde a semântica do TabWin Web **difere** da função embutida do alvo, o passo
é renderizado com um comentário dizendo isso, em vez de uma chamada que
calcularia outra coisa em silêncio:

- **semana/ano epidemiológico** — R aponta para `aweek::date2week`, com nota
  de que as bordas de ano podem diferir da implementação MMWR/MS exata;
  pandas não tem equivalente embutido, então a coluna fica `None` com a nota.
- **código IBGE** — a padronização 5/6/7 dígitos vira `zfill`/`substr` com
  nota de que a regra exata está no TabWin Web.
- **fórmulas** — funções como `RATE`/`ZSCORE`/`LAG` não têm equivalente
  direto; a fórmula é renderizada com os colchetes de coluna removidos e o
  `;` virando `,`, com nota de que não roda verbatim.

## O detalhe técnico que exigiu cuidado: o pipe nativo do R

O `|>` nativo do R não carrega comentário inline na mesma linha que precisa
do pipe no fim — o comentário engoliria o pipe. Então as notas são emitidas
em **linhas próprias de comentário** (que o pipe trata como espaço em
branco), e o pipe final vai sempre no **último verbo habilitado** — nunca num
comentário, nunca numa etapa desativada, nunca deixando um `|>` pendurado.
Uma etapa desativada aparece comentada por inteiro; um pipeline inteiramente
desativado nem abre o pipe. Três testes cobrem exatamente esses casos de
borda do pipe, porque um `|>` pendurado seria um erro de sintaxe óbvio que
destruiria a confiança na feature.

## Verificação

- `npm run check`: **378/378** (8 testes novos: pipeline vazio, a cadeia R
  sem pipe pendurado, etapa desativada comentada sem carregar o pipe final,
  pipeline todo desativado, modos de filtro e faixas numéricas,
  group-summarize nos dois alvos, a fórmula legível mas rotulada como não
  executável, e a semana epidemiológica sinalizada).
- `npm run e2e`: **22/22**, com um caso novo que monta filtro + agrupamento,
  abre "Ver código equivalente", confere o dplyr por padrão, troca para
  pandas, e confirma que abrir a visão **não toca no dataset** (é view, não
  ação).
- Verificação manual no navegador nos dois alvos antes do E2E.

## O que continua fora do pipeline

`join` de microdados e `bind_rows` — os dois precisam de uma **segunda
fonte** de dados, o que é um passo arquitetural maior (o Worker segura um
dataset; a UI precisaria carregar um segundo arquivo e casar esquemas). O
"Combinar DBC/DBF" já existente cobre o caso comum de empilhar arquivos do
mesmo esquema. Fica como a próxima costura do pipeline (R11.4.5), separada
por ser a única que muda o número de fontes.
