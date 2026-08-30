# R09.7 — import geográfico GeoJSON

**Data:** 2026-08-29
**Status:** completo e verificado em navegador real com `RDAC2401.dbc`.

## POR QUE

Hoje o mapa temático só abre `.MAP` legado — os arquivos empacotados
(`br_municip.MAP`, `br_ufsigla.MAP`) ou um `.MAP` trazido pelo usuário. Não
existe fronteira geográfica moderna disponível fora desses dois casos. GeoJSON
é o formato padrão de facto para limites administrativos hoje (IBGE publica
malhas municipais nesse formato), então é o caminho mais barato para abrir o
mapa temático a qualquer geografia além das duas já empacotadas.

## O QUE FOI FEITO

`packages/formats/src/geojson-map.ts`: `convertGeoJsonToTabwinMap(source,
{ geocodeProperty, nameProperty })` converte um `FeatureCollection` (Polygon,
MultiPolygon, LineString, Point) para o mesmo `TabwinMapDefinition` que
`map-parser.ts` já produz a partir de um `.MAP` binário real. Isso significa
**zero mudança** em renderização, zoom/pan, hit-testing, exportação PNG ou
classificação coroplética — todos já leem esse modelo compartilhado, então
importar GeoJSON é só mais um jeito de preencher `activeMap`.

Decisão central: a função **nunca adivinha** qual propriedade do GeoJSON
carrega o geocódigo ou o nome de exibição. Arquivos reais do IBGE/DATASUS
usam nomes de propriedade diferentes por fonte (`CD_MUN`, `GEOCODIGO`,
`codarea`, `id`...), e escolher errado rotula toda área silenciosamente, sem
erro visível — exatamente o tipo de semântica inventada que o projeto evita
em todo outro lugar (seleção manual de auxiliar, por exemplo). Em vez disso:
`listGeoJsonFeatureProperties(source)` lê as chaves reais da primeira feature
com `properties`, e a interface as apresenta para a pessoa escolher.

Tratamento explícito de casos de borda:
- Feature sem valor na propriedade de geocódigo escolhida é **descartada com
  aviso**, nunca silenciosamente ("feature skipped: empty..."). Um arquivo
  com uma linha malformada não trava a importação inteira.
- MultiPolygon vira um `TabwinMapObject` por polígono-membro, todos com o
  mesmo geocódigo/nome — o modelo compartilhado nunca teve conceito de "um
  objeto, vários polígonos", só "um objeto, várias `parts`" (que é como o
  próprio `.MAP` já representa um objeto multi-parte).
- Anel interior de polígono (um buraco — um lago dentro de um município, por
  exemplo) **converte**, mas emite aviso explícito: o modelo compartilhado
  não tem conceito de buraco, então o anel interior desenha preenchido, não
  recortado. Mesma limitação que o `.MAP` legado já tem para qualquer objeto
  multi-parte — documentada, não escondida.
- Tipo de geometria não suportado (`GeometryCollection`, por exemplo) falha
  explicitamente nomeando a feature, em vez de tentar adivinhar ou pular.
- Coordenada não finita é rejeitada antes de entrar nos limites do mapa.

`version: 0` no `TabwinMapDefinition` resultante marca explicitamente "não
veio de um `.MAP` legado" — documentado também em `map-model.ts`, ao lado do
comentário já existente sobre `100` significar versão 1.00 legada.

12 testes em `tests/geojson-map.test.mjs`: listagem de propriedades reais,
conversão de Polygon simples, MultiPolygon em múltiplos objetos, fallback do
nome para o geocódigo quando a propriedade de nome está vazia, feature
descartada com aviso, buraco convertido com aviso, Point e LineString,
tipo de geometria não suportado rejeitado nomeando a feature, documento que
não é FeatureCollection/Feature rejeitado, coordenada não finita rejeitada,
resultado vazio falha explicitamente, e limite de segurança de contagem de
objetos.

`apps/web/index.html`: botão "Importar GeoJSON" na barra do mapa, input de
arquivo dedicado (`#geojson-input`, `.geojson`/`.json`, separado do
dropzone geral para não colidir com o fluxo de `.twrecipe`), e um diálogo
novo (`#geojson-import-dialog`) com dois `<select>` — geocódigo e nome —
populados com as propriedades reais lidas do arquivo.

`apps/web/src/main.ts`: `loadGeoJsonFile(file)` lê e faz `JSON.parse`,
lista as propriedades e abre o diálogo; `confirmGeoJsonImport()` converte
com as duas propriedades escolhidas, define `activeMap`/`activeMapSource`
(`"${nome do arquivo} (GeoJSON)"`, distinguível de um `.MAP` no painel de
auditoria) e reindexação de nomes por geocódigo (`indexActiveMapNames`) —
o mesmo mecanismo que já liga município ao rótulo da tabela.

## VERIFICADO EM NAVEGADOR COM ARQUIVO REAL

GeoJSON de teste com dois municípios de código IBGE real — Porto Velho
(`110020`) e Acrelândia (`120001`) — importado pelo fluxo completo: arquivo
escolhido → diálogo abre com as propriedades reais (`CD_MUN`, `NM_MUN`) →
confirmar com essas duas escolhidas → toast "2 áreas convertidas" → diálogo
fecha.

Depois, `RDAC2401.dbc` real aberto e tabulado por `MUNIC_RES`, view trocada
para Mapa: legenda mostrou **"2 áreas associadas"** — exatamente os dois
municípios do GeoJSON de teste, os únicos com geometria disponível, e ambos
presentes nos dados reais do AC/RO. JSON de auditoria confirmado via
inspeção direta do estado:

```json
"map": { "source": "test-areas.geojson (GeoJSON)", "version": 0, "objects": 2, ... }
```

`version: 0` prova que o marcador de proveniência funciona; `source` prova
que o rótulo distingue de um `.MAP` normal. Console sem erro durante toda a
sessão de teste.

## GATE

`npm run check`: **184/184** testes (eram 172), typecheck do núcleo,
typecheck web e build Vite, todos limpos. G001 inalterado.

## LIMITE DELIBERADO

Buracos de polígono (anéis interiores) convertem mas renderizam preenchidos,
não recortados — herdado do modelo compartilhado, que nunca teve esse
conceito porque o `.MAP` legado também não tem. Documentado com aviso
explícito no resultado da conversão, não escondido. SHP e outros formatos
históricos continuam fora de escopo, por demanda, como já registrado no
roadmap.

## PRÓXIMO PASSO

Faixa 3.2 do roadmap — editor/inspetor de DEF e CNV. Último item de código
pendente da Faixa 3 antes de a Faixa 4 (bateria de goldens, já em captura
manual pelo usuário) dominar o resto do trabalho.
