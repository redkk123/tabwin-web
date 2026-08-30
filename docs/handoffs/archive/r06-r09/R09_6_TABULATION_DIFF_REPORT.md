# R09.6 — diff entre execuções da tabulação

**Data:** 2026-08-29
**Status:** completo e verificado em navegador real com `RDAC2401.dbc`.

## POR QUE

O histórico da tabulação (Faixa 2.4) já registra cada execução da sessão,
mas só como texto — para saber o que mudou entre duas entradas, o usuário
tinha que ler os dois blocos e comparar de olho. É exatamente o que
sustenta "atualizar esta análise" (§18 da spec mestra): mudar um filtro,
adicionar uma regra cruzada, reabrir uma fonte atualizada, e precisar ver
**o que se moveu**, não as duas tabelas inteiras lado a lado.

## O QUE FOI FEITO

`packages/core/src/tabulation-diff.ts`: `diffTabulationResults(before, after)`,
puro, sem DOM. Identidade de eixo decidida por `key`, nunca por `label` ou
posição — um rótulo pode mudar sob configuração de apresentação (busca de
nome de município, uma renomeação) sem que a categoria subjacente mude, e a
ordem de linha não é estável entre operações (ordenação, transposição). Só
compara células nas chaves comuns aos dois lados — nunca um produto
cartesiano completo, então adicionar ou remover uma linha/coluna nunca gera
uma "diferença de célula" fantasma para o que só apareceu de um lado. Delta
de `recordsSeen`/`recordsAccepted` computado separadamente, porque a
contagem pode mudar mesmo quando toda célula em comum permanece igual (mais
registros vistos, mesmos aceitos, por exemplo). 8 testes em
`tests/tabulation-diff.test.mjs`: execuções idênticas, célula alterada com
delta exato, linha adicionada/removida sem diferença fantasma, identidade
por chave (renomear ou reordenar não é mudança de valor), diff só de coluna,
delta de contagem de registro mesmo com toda célula igual, autodiff
(incluindo resultado vazio) sempre idêntico, e sensibilidade de direção
(comparar A×B inverte o sinal de B×A).

`apps/web/src/main.ts`: `TabulationLogEntry` ganhou o campo `result:
TabulationResult` — o snapshot completo da tabela renderizada (nunca o
dataset de origem, então o custo é o tamanho do resultado, não do arquivo).
Cada entrada do histórico ganhou um segundo botão, "Comparar", ao lado de
"Copiar", desabilitado quando não há tabulação atual para comparar.
`renderTabulationDiff(entry)` chama `diffTabulationResults(entry.result,
currentResult)` e preenche um painel dedicado (`#tabulation-diff-panel`)
com: resumo em uma linha (colunas/linhas adicionadas ou removidas, células
alteradas, delta de registros), lista de eixos adicionados/removidos por
rótulo, tabela de células alteradas com antes/depois/delta (delta colorido
verde para positivo, vermelho para negativo), e a linha de registros
vistos/aceitos com os dois valores e o delta. Construído inteiramente com
`createElement`/`textContent` — nunca `innerHTML` — porque rótulo de linha e
de coluna vêm de dado DBF real e podem conter qualquer caractere.

`apps/web/index.html` e `apps/web/src/styles.css`: markup do painel de
diff dentro de `#audit-view`, e `.tabulation-log-entry-actions` substitui o
botão único antigo por um contêiner flex para os dois botões.

## VERIFICADO EM NAVEGADOR COM ARQUIVO REAL

`RDAC2401.dbc` (41b7ad58…, 4.315 registros): primeira tabulação `MUNIC_RES`
× Frequência (1 coluna), segunda tabulação `MUNIC_RES` × `SEXO` bruto (2
colunas, códigos `1`/`3`). Cliquei "Comparar" na entrada mais antiga contra
a tabulação atual (a segunda). Painel mostrou:

- Resumo: `+2 coluna(s) · -1 coluna(s)`
- Eixos: `Colunas — adicionada(s): 1, 3 · removida(s): Freqüência`
- Registros: `vistos: 4.315 → 4.315 (+0) · aceitos: 4.315 → 4.315 (+0)`
- Nenhuma célula alterada listada — correto: as duas tabulações não têm
  **nenhuma** chave de coluna em comum (`__single__` contra `1`/`3`), então
  não há célula comparável, só eixo inteiro adicionado/removido.

Fechar o painel (`#tabulation-diff-close`) confirmado via inspeção direta do
estado (`hidden: false → true`). Console sem erros durante toda a sessão de
teste.

## GATE

`npm run check`: **172/172** testes (eram 164), typecheck do núcleo,
typecheck web (`tsc -p web.tsconfig.json`, limpo) e build Vite. G001
inalterado (`git diff --stat -- fixtures/golden/G001` vazio) e o teste
"committed G001 TabWin 4.15 export preserves exact labels, order and cells"
continua passando dentro do próprio `npm run check`.

## LIMITE DELIBERADO

O diff só compara o que está em comum entre os dois lados — uma troca
completa de dimensão (como no teste acima) sempre aparece como "tudo
adicionado, tudo removido", nunca como uma tentativa de casar linha por
posição. É a decisão certa para não inventar correspondência que o plano
não garante, mas significa que o painel não tenta ser "esperto" sobre uma
reanálise que muda a própria forma da tabela — só sobre o que mudou dentro
da mesma forma.

## PRÓXIMO PASSO

Faixa 4.1 do roadmap — bateria de goldens G002–G006, agora em captura manual
pelo usuário no TabWin 4.15 com o protocolo corrigido (CNVs reais já
materializados). Sem mais itens pendentes de código nesta sessão até a
captura retornar.
