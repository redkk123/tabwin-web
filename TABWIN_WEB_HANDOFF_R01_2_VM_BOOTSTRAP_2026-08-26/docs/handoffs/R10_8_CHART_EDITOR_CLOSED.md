# R10.8 — Faixa 4.2 fechada: editor de gráficos

**Data:** 2026-08-29
**Base:** corte do ChatGPT (`R10_4`), integrado sobre `efb3925`.
**Estado:** 4.2 concluída. Gate `npm run check` **262/262**.

## Como o corte do ChatGPT entrou

O `.patch` do pacote não aplicava: as linhas de contexto vinham em LF e toda a
árvore aqui é CRLF. O corte foi reconstruído a partir do snapshot `MODIFICADO`,
depois de conferir o `SHA256SUMS.txt` (4/4 OK).

Dos dez arquivos, só `main.ts` e `tests/core.test.mjs` tinham divergido desde a
base `5879760` — por causa da validação do G017 e do G009 — e os dois casaram
só com deslocamento de linha, sem conflito semântico.

O que veio dele está no commit de integração, separado do fechamento, para a
autoria continuar legível.

## Três regressões que a revisão pegou

O corte inicial mudava, sem querer, o que um gráfico já mostrava. Todo controle
novo nasce em "Automático", e **automático tem que significar o que o gráfico
fazia antes de o editor existir**.

| | Antes do editor | Corte inicial | Agora |
| --- | --- | --- | --- |
| Contagem inteira | `4.315` | `4.315,00` | `4.315` |
| Soma de `VAL_TOT` | `3.016.736,92` | `3.016.736,92` | `3.016.736,92` |
| Legenda da pizza | sempre | **desligada** | sempre |
| Rótulos em barras h. | sempre | ligados | sempre |
| Fonte na tela | fixa | **ignorava a escolha** | igual à do export |

1. **Casas decimais.** O corte trocou `maximumFractionDigits: 2` por um par
   `minimum`/`maximum` fixo em 2, então toda contagem ganhava `,00`. O seletor
   agora tem "Automático" como padrão: mínimo 0, máximo 2 — inteiro fica
   inteiro, dinheiro mantém os centavos. 0–6 continua disponível para quem
   quiser fixar.

2. **Legenda da pizza.** A legenda passou a depender de um checkbox que nascia
   desmarcado, e na pizza a legenda *é* a rotulagem das categorias: o gráfico
   virava um disco colorido sem nome nenhum. Os controles de legenda e de
   rótulo viraram tri-estado (`Automático` / `Sempre` / `Nunca`) e o
   "Automático" consulta uma tabela por família — a decisão que o próprio
   handoff do ChatGPT deixou em aberto na seção 5.

3. **Fonte só no papel.** O `styles.css` reestilizava `.chart-label`,
   `.chart-value`, `.chart-tick`, `.chart-axis` e `.chart-empty` dentro de
   `.result-chart-svg`, com especificidade maior que o `<style>` embutido no
   próprio SVG. A tela ignorava a fonte escolhida e o SVG/PNG exportado
   obedecia. Os overrides saíram; só o contêiner continua estilizado de fora.

## O que o fechamento acrescentou

**Eixos e limites.** `resolveAxis` em `packages/visualization/src/chart-model.ts`
é puro e testado: passos "bonitos" (1/2/2,5/5 × 10ⁿ), sem lixo de ponto
flutuante nos rótulos, e limites manuais aceitos só como par completo com
máximo maior que o mínimo. Um par inválido é **descartado inteiro** e o eixo
volta à faixa dos dados — meio limite aplicado desenharia uma escala que mente.
A UI avisa uma vez por problema e o `parseRecipe` rejeita o par inválido na
leitura, para uma receita salva não prometer o que o renderer não faz.

Em dispersão com limites manuais, um ponto fora da janela é **omitido**, não
grudado na borda, onde pareceria um dado real.

**Séries por coluna.** O renderer reduzia toda linha ao seu total, então a
"legenda" nunca podia nomear mais de uma coisa. Agora, quando o resultado tem
mais de uma coluna, barras verticais saem agrupadas e linhas/áreas saem
sobrepostas, uma série por coluna, com legenda de verdade. O seletor "Séries"
permite voltar ao total das linhas.

**Tamanho da bolha.** Terceiro binding, opcional; sem ele o raio continua vindo
do total da linha, como antes.

**Zoom.** Manipula o `viewBox` do SVG, não `transform: scale` — texto e traços
continuam nítidos. Roda do mouse com foco no cursor, teclas `+`/`-`/`0`, botões
e um "Reenquadrar" que só habilita fora do enquadramento original. **Zoom não
entra na receita nem na exportação**: o que alguém salva ou imprime é o gráfico
inteiro, não o recorte que o último leitor estava olhando.

**Impressão por família.** O `@media print` forçava `#table-view`, o que está
certo para o caso comum e errado para o botão novo. "Imprimir" no painel do
gráfico marca o `<body>` enquanto o diálogo está aberto e devolve a marca
depois — inclusive se o `afterprint` nunca chegar. Imprimir pelo menu do
navegador continua dando a tabela inteira.

## Snapshots visuais

O renderer chama `document.createElementNS`, então nunca tinha sido testado.
`tests/svg-dom-stub.mjs` é o menor `document` que ele de fato usa, e o Node 24
importa o `.ts` direto por type stripping — sem passo de build novo.

`tests/chart-renderer.test.mjs` tem 12 casos sobre o SVG real, incluindo uma
serialização completa byte a byte. **Cada caso existe porque alguma coisa
quebrou**: os três da tabela acima, mais séries, eixos, recorte e binding de
tamanho.

## Verificação

- `npm run check`: **262/262** (eram 245 depois da integração, 244 antes).
- `typecheck:web` e `web:build`: limpos.
- Smoke no navegador: app inicializa sem erro de console, os 25 controles novos
  existem, e os estados iniciais desabilitados estão certos (X/Y só em
  pontos/bolhas, tamanho só em bolhas, limites de X só em dispersão ligada).
- G001 e os 15 goldens: inalterados. Nada aqui toca o motor de tabulação.

## O que ficou de fora, e por quê

- **Tamanho/peso de fonte por elemento.** O handoff do ChatGPT lista como
  possível; não está no escopo do roadmap para 4.2 e a fonte já é escolhível.
- **Empty chart / composition workflow.** É item do inventário legado, não
  desta faixa.
- **Contraste automático em fundo escuro.** As cores de tinta continuam fixas.
  Vale resolver quando houver tema escuro de verdade, não antes.
- **Oráculo TabWin 4.15.** Nada aqui é compatibilidade de artefato: são
  controles modernos de apresentação. Continua valendo que **nenhum golden foi
  tocado**.
