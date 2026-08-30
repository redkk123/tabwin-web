# R10.10 — Faixa 4.3 fechada: mapas avançados

**Data:** 2026-08-30
**Base:** corte do ChatGPT no pacote `TABWIN_FAIXA_4_3_A_4_7_MICRODATASUS`.
**Estado:** 4.3 concluída. Gate **267/267**, E2E **7/7**.

## O que veio do ChatGPT, e como entrou

Do pacote (49/49 hashes conferidos) o corte de 4.3 trouxe quatro peças, todas
revisadas antes de aplicar:

- `map-scale.ts` com `manual` e `manualThresholds`, que exige quebras finitas,
  estritamente crescentes e **estritamente interiores** ao intervalo observado —
  sem isso a borda vira uma classe de largura zero;
- `map-hit-test.ts`, extraindo do canvas o teste ponto-em-polígono com a mesma
  paridade *even-odd* que o preenchimento usa;
- `spatial-selection.ts`, que converte geocódigos selecionados num `FilterSpec`
  comum e **exige o campo explicitamente**;
- validação de `mapManualBreaks` no `.twrecipe`.

O `.patch` integrado não foi usado: como no pacote anterior, o contexto vinha em
LF e a árvore é CRLF, e a base dele é anterior à 4.2 fechada aqui. As peças
foram reconstruídas do snapshot com verificação por arquivo. `map-scale.ts`,
`map-scale.test.mjs` e `map-hit-test.test.mjs` não tinham divergência nenhuma
contra o HEAD e foram copiados direto.

## Uma decisão trocada

`createMapScale` agora pode lançar, e o corte do ChatGPT deixava cada chamador
responsável por embrulhar em `try/catch`. Isso funciona enquanto ninguém
esquece. O caso que expõe o problema é concreto: uma receita salva com quebras
`10; 25; 50` reaberta com dados cujo máximo é 8. As quebras são válidas
sintaticamente — o `parseRecipe` as aceita, e deve mesmo, porque ele não conhece
a faixa dos dados — mas `manualThresholds` recusa, e o mapa não desenharia.

Agora quem trata é o `renderMap`: ele captura, desenha **por quantis** e escreve
o motivo numa nota fixa abaixo da barra de ferramentas. O usuário vê o mapa e vê
que as quebras dele não foram usadas. Um toast some; o mapa ficaria mentindo.

## O que faltava e foi feito aqui

O log do ChatGPT listou camadas, sedes e a UI de seleção como não fechadas.

**Seleção espacial.** Clique alterna a área (com tolerância de 4 px para não
confundir arrastar com escolher), o contorno grosso mostra o que está
selecionado, e o painel diz quantas áreas são. "Filtrar por seleção" empurra um
filtro comum para `configuredFilters` e re-executa: ele aparece na mesma lista
de chips, sai na mesma receita e volta do mesmo jeito. Nada no `QueryPlan` é
especial para mapa.

O campo do geocódigo é explícito, como o ChatGPT exigiu — mas com padrão. O
padrão é a dimensão de linha, e isso não é adivinhação: o mapa casa
`object.geocode` contra `row.key`, então **se as áreas se pintaram, aquele campo
carrega os geocódigos**. O seletor continua lá para quem tabula por um campo e
quer filtrar por outro.

**Sedes.** Marcador no `labelPoint` dos objetos que a fonte marcou como
`polygon-with-seat`. Só nesses. O modelo não tem coordenada de sede separada, e
calcular um centróide para os outros e chamá-lo de sede seria afirmar um fato
sobre o território que ninguém verificou.

**Camadas.** Mapas extras (`.MAP` ou GeoJSON) desenhados como contorno sobre o
coroplético, com liga/desliga e remoção. **Sem ligação com dados, de propósito.**
Deixar uma segunda camada se colorir do mesmo resultado afirmaria em silêncio
que os geocódigos dela significam a mesma coisa que os da primeira — que é
exatamente o erro que o `uf=BR` ensinou a não cometer. Camada é contexto de
leitura; quem quiser tabular por outra malha troca a dimensão.

Como camada não casa nada, o GeoJSON dela não abre o diálogo de escolha de
propriedade: usa a primeira disponível só para satisfazer o conversor, sem
afirmar identidade.

**Legendas.** Já eram discretas fora do modo contínuo, então as quebras manuais
aparecem como classes com seus intervalos sem uma linha de código nova. Foi
verificado, não assumido.

## Verificação

- `npm run check`: **267/267** (eram 262).
- 7 testes de mapa/hit-test/seleção do ChatGPT: PASS, mais um caso acrescentado
  aqui para quebra infinita no recipe.
- `npm run e2e`: **7/7**, sem regressão.
- Navegador: aplicação sobe limpa, os nove controles novos existem, `manual`
  mostra o campo de quebras e desabilita a contagem de classes, os outros
  métodos fazem o inverso.

## O que continua fora

- **Inferência automática do campo geográfico.** Não vai acontecer sem metadado
  ou oráculo. O ChatGPT estava certo em recusar e a recusa fica.
- **Camada com dados próprios.** Precisaria de um segundo resultado tabulado por
  outra dimensão, não de uma segunda cor no mesmo.
