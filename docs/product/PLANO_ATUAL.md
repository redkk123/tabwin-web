# Plano atual

Escrito em 2026-09-02. A ordem é de prioridade: cada bloco só começa quando o
anterior passa no portão (`npm run check:all`). Erros relatados pelo usuário
entram na frente de tudo — o resto da fila espera.

## Bloco 1 — Download resistente ao DATASUS lento ✅

Motivo: o usuário viu "o download veio incompleto" no DNBR2025 pelo celular.

Diagnóstico de 02/09: o `/prepare` do DATASUS devolve o endereço do ZIP **antes
de terminar de escrevê-lo**. Quem baixa cedo demais recebe 404 ou um pacote
cortado. Para DNBR2025 (108 MB) o preparo leva cerca de 11 segundos. Medido:
prepare 11,1–12,3 s; download completo 108,33 MB em 22,9 s (4,74 MB/s da VM),
ZIP íntegro.

- [x] Corte de pacote vira `TruncatedDatasusArchiveError`, separado do inválido
      genérico — repetir resolve um, nunca resolve o outro.
- [x] `shouldRetryDatasus` passa a retentar corte (até 3 tentativas).
- [x] `waitForPreparedArchive` espera a URL preparada existir, sondando dois
      bytes a cada 2 s, no máximo 45 s.
- [x] A tela diz "O DATASUS está montando o pacote… Ns" em vez de ficar em 0%.
- [x] 11 testes novos.

## Bloco 2 — Densidade inicial da barra lateral ✅

Dois erros que os testes pegaram e vale não repetir: esconder os **Metadados**
tirava da tela o Editor de CNV, que funciona sem conjunto aberto; e amarrar a
barra a `setControlsEnabled` faria o formulário piscar a cada tabulação,
porque esse sinal também desliga durante o cálculo.

Motivo: revisão externa, com a qual o usuário concordou. Antes de abrir um
arquivo, a barra mostrava a configuração inteira de uma tabulação inexistente.

- [x] Sem dados: só abrir arquivo, buscar no DATASUS e análises salvas.
- [x] Com dados: linhas, colunas, medida e **filtros** (caminho principal).
- [x] "Opções avançadas", fechado: medidas extras, limpeza assistida, regras
      cruzadas, combinações raras, transformação, posições iniciais.
- [x] `TabWin 4.15` → `Compatível com TabWin 4.15`, para não sugerir que este
      programa é o TabWin oficial.
- [x] `Compatibilidade com transparência` → `Dados públicos. Processamento
      local.`

Nenhuma capacidade foi removida. Só deixou de disputar atenção.

## Bloco 3 — Laboratório publicado ✅

- [x] Publicado em https://tabweb.me/lab/, com o link no topo do aplicativo.
      `npm run lab:sync` refaz a cópia a partir do repositório vizinho e grava
      o commit de origem em `lab/ORIGEM.json`.
- [x] Publicar o Lab publicou o código-fonte dele: um app estático de navegador
      entrega o próprio JavaScript, não há meio termo. Conteúdo auditado em
      02/09 — sem segredos, sem dado pessoal, fixtures sintéticas.
- [x] Verificado no ar: abre sem erro de script, com o caderno montado.

## Bloco 3.5 — O corte no download, resolvido ✅

O relato original ("o download veio incompleto") **não era do DATASUS**. O
`boundedArchiveStream` do Worker passava cada pedaço por JavaScript para contar
bytes; num arquivo de dezenas de MB isso estoura o limite de CPU da Cloudflare
no meio do stream, e o cliente recebe um corpo cortado sem erro nenhum.

Como apareceu: o usuário notou que o portal oficial baixava 154 MB no mesmo
navegador e na mesma conexão. Isso descartou tamanho e origem de uma vez.

Medido com a mesma URL preparada, fatia de 48 MB, intercalado:

| caminho | antes | depois |
|---|---|---|
| direto do DATASUS | 3/3 inteiros · 7,1–7,7s | 3/3 |
| pelo proxy | 1/3 | 3/3 · 10,3–11,0s |
| proxy, 4 faixas | 0/3 | 3/3 · **3,0–3,4s** |

Com o tamanho declarado, o corpo passa direto para a resposta. O limite não se
perde: o `Content-Length` já era conferido antes do primeiro byte.

**Duas conclusões anteriores caem por terra**, e ficam registradas para não
serem repetidas: o corte não vinha de reusar o pacote preparado, nem de carga
no DATASUS. As duas medições mediam este defeito. A lição é olhar
`wrangler tail` antes de investigar a origem.

### O que foi medido e não vale a pena

- **Mais conexões**: 1 conexão 7,43s, 2 conexões 4,13s, 4 conexões 4,01s. O
  joelho está antes de 4; acima disso não melhora.
- **Vários arquivos num pedido só**: o DATASUS aceita e monta um zip único, mas
  o preparo é por arquivo de qualquer forma — 22,2s separados contra 21,5s
  juntos. E um corte passa a levar todos os arquivos em vez de um.
- **Baixar o `.dbc` direto do FTP**, como faz o microdatasus: impossível no
  navegador. `ftp.datasus.gov.br` só fala FTP, e navegador não fala FTP desde
  2021 — daí existir todo o caminho de preparo e ZIP.

## Bloco 3.6 — Prévia pelo TabNet ✅

O botão **Ver totais** aparece na linha do arquivo, ao lado de baixar, e
responde em ~2 s o que o caminho do microdado cobra ~11 s de preparo mais
105 MB para responder. Verificado no ar em 2026-09-03: SINASC/DN 2023
devolveu as 27 unidades da federação e TOTAL 2.537.576 — o mesmo número
medido antes por outro caminho, o que confirma que não é só "uma tabela",
é a tabela certa.

Três decisões que a verificação forçou, e que valem ficar escritas:

- **O leitor busca o formulário do `.def` em vez de adivinhar os nomes.**
  Cada `.def` nomeia as coisas do seu jeito (a medida do nascidos vivos é
  `Nascim_p/resid.mãe`, o arquivo de 2023 é `nvuf23.dbf`) e nada disso se
  deduz do par sistema/tipo. Fixar no código seria chute em cinco dos seis
  `.def` do mapa. De brinde, a lista de anos é a real: 2027 aparece sozinho
  quando o DATASUS publicar.
- **O corpo do POST sai em latin-1.** `URLSearchParams.toString()`
  percent-codifica em UTF-8 e "Região" viraria `Regi%C3%A3o`; o TabNet lê
  byte a byte e devolveria erro, ou pior, a tabulação de outra coisa.
- **O botão exige o proxy, não só o `.def`.** Medido: o TabNet não manda
  nenhum cabeçalho CORS. Sem proxy o navegador recusa ler a resposta, então
  o botão simplesmente não aparece — melhor do que oferecer e falhar.

O diálogo diz em destaque que esta é a única parte do aplicativo em que a
pergunta viaja. Isso não é ornamento: o resto do TabWin Web baixa o arquivo
e tabula no aparelho sem contar a ninguém o que se quis saber, e perder
isso de vista por conveniência seria trair o motivo do projeto existir.

O que ficou de fora, de propósito: **SIH/RD**. O `sih/cnv/niuf.def` não
conectou na sondagem, e uma prévia que erra é pior do que nenhuma. Quando
responder, entra no mapa em `TABNET_DEFS` e o botão aparece sozinho.

Aberto: a prévia usa sempre unidade da federação na linha e a primeira
medida. Deixar quem usa escolher linha e coluna é o passo natural — o
leitor do formulário já devolve as 23 opções de linha e as 22 de coluna,
falta só a interface.

## Bloco 4 — Pendências antigas

- [x] Segredo `CLOUDFLARE_API_TOKEN` no GitHub ✅ (03/09/2026). Conferido
      rodando o workflow à mão: publicou sozinho, e o `/health` respondeu com
      a revisão nova. O Worker não depende mais de publicação manual.
- ~~Drive: 6 duplicatas antigas na pasta `SIDS_R95`.~~ **Decidido em
  03/09/2026: ficam onde estão.** São sobra de um handoff antigo, não afetam
  nada do projeto, e limpá-las custaria mais atenção do que vale.
- [ ] `REMAINING_IMPLEMENTATION_PLAN.md` está defasado (baseline R05.1).
- [x] **Python do lab: a mensagem passou a dizer o que houve.** ✅ 03/09/2026.
      O sintoma era "Falha ao carregar o worker Python", que não diz nada.

      **Uma medida minha anterior estava errada e fica corrigida:** eu havia
      anotado "~100 MB de wasm". São **6 MB** — 3,3 MB de `pyodide.asm.wasm`
      mais 2,4 MB de `python_stdlib.zip`. Memória continua sendo suspeita
      plausível (a memória linear do wasm não aparece nesse número), mas não
      pela razão que eu tinha escrito.

      Não consegui reproduzir a falha: aqui o `loadPyodide()` carrega em 5,6 s
      e roda. Então o que foi entregue não é o conserto da causa, é fazer a
      causa aparecer. O worker morrendo com código de OUTRA origem dispara um
      evento `error` com `message` vazio — o navegador esconde o texto por
      segurança —, e era daí que vinha o texto genérico. Agora o worker posta
      o motivo por `postMessage`, que atravessa a fronteira de origem intacto,
      e o adaptador usa esse motivo. Falta de memória ganha frase própria,
      porque em celular ela é esperada e tem o que fazer a respeito.

      Da próxima vez que acontecer no aparelho do usuário, a tela dirá qual é
      o erro. Cinco testes travam o contrato.

## Bloco 5 — Evolução sugerida na revisão

Ordem por valor sobre esforço, não por ordem de chegada.

- [x] **Exportar Parquet.** ✅ Botão na aba de consulta, ao lado do CSV. O
      DuckDB já estava aqui, então foi ligar o `COPY` do motor — não escrever
      um codificador.

      No caminho apareceu coisa maior que o pedido: o exportador de CSV
      escrevia as linhas **já cortadas** em `MAX_RESULT_ROWS` enquanto o
      status dizia "exporte para ver todas". Quem consultasse 400 mil linhas
      levava 5 mil achando ter tudo. Os dois formatos passam pelo `COPY`, que
      roda a consulta de novo dentro do motor. Medido: tela 5.000, arquivo
      20.000, conferido lendo o Parquet de volta com a soma batendo.

      Duas armadilhas que só a verificação no navegador mostrou, registradas
      para ninguém reintroduzir: `ENCODING` no DuckDB é opção de **leitura** e
      derruba a escrita com "not supported for writing"; e sem ela some o BOM,
      sem o qual o Excel em português lê UTF-8 como latin-1 e transforma
      "Região" em "RegiÃ£o" na planilha inteira. O BOM é acrescentado aos
      bytes.
- [ ] **Primeiro DBC absurdamente fluido.** A revisão apontou isto como o que
      vende o projeto sozinho: buscar no DATASUS → escolher → abrir → tabela,
      sem atrito.

      **Medido no ar** (2026-09-03, DNBR2024: 112 MB, 2,39 milhões de
      registros, cache local limpo):

      | etapa | tempo |
      |---|---|
      | busca no catálogo | 0,5 s |
      | download pelo espelho + SHA-256 | 8,0 s |
      | abertura + primeira tabela | 12,3 s |
      | **clique → tabela** | **21,0 s** |
      | cada campo novo depois | 6,0 s |
      | campo já tabulado | 0,1 s |

      Dentro de uma passada, decodificar registro é 84–85% do tempo e
      descomprimir é o resto (`npm run bench:decode-breakdown`). E o progresso
      aparece na tela o tempo todo — 122 atualizações, uma a cada 65 ms — então
      não há tela travada, só espera.

      **Uma tentativa já foi feita e revertida.** A ideia era guardar uma dúzia
      de campos na projeção em vez de só o tabulado, para as trocas seguintes
      saírem do cache. Um benchmark offline dava suporte: 12 campos custavam
      1,33× de um só. Em produção deu o contrário — primeira tabela 21 s → 31 s,
      e campo fora do corte 6 s → 22,5 s.

      O erro foi no que se mediu: o benchmark cronometrava **decodificar** N
      campos, e o worker decodifica **e constrói** N colunas de dicionário. A
      construção é a parte cara e não aparecia na curva. Um orçamento menor não
      resolve, porque o custo escala com colunas construídas e o ganho só vale
      para os campos adivinhados certo.

      Por onde atacar de verdade, então: os 6 s de uma passada são
      materialização de registro. Ou se reduz o custo por registro no leitor,
      ou se evita a passada — e evitá-la sem construir dicionário é o que ainda
      não tem resposta.
- [x] **Filtro geográfico pronto, por nome, em cascata.** ✅ 03/09/2026. Hoje filtrar por
      município exige saber o código do IBGE: quem quer Belém precisa digitar
      `150140`. O aplicativo já tem tudo para resolver isso — `findGeographicFields`
      acha o campo, e os mapas incluídos trazem os nomes (27 UF em
      `br_ufsigla.MAP`, 5.570 municípios em `br_municip.MAP`, ambos com o
      código como chave).

      O que fazer: um filtro que aparece sozinho quando o arquivo tem
      geografia, listando **estado → município por nome**, com contagem ao
      lado, e que vale para a análise inteira — tabela, mapa, estatística —
      não só para o mapa. A pessoa vai escolhendo, sem digitar código.

      Dois cuidados que a implementação não pode perder: a lista sai dos
      **dados**, não das 27 UF fixas, senão oferece estado vazio; e o nome é
      só rótulo — o filtro guarda o código, porque nome de município repete
      entre estados.

      Pedido do usuário em 03/09/2026.

- [ ] **Escolher qual campo geográfico o mapa usa.** A escolha hoje é
      automática e privilegia residência, mas `CODMUNRES` e `CODMUNOCOR`
      respondem perguntas diferentes, e quem estuda rede de atenção quer
      ocorrência. Os candidatos já são calculados em ordem — falta expor a
      lista num seletor, ao lado do de recorte. Pequeno.

- [ ] **Desenhar só o estado isolado, como opção.** Hoje o estado isolado é
      enquadrado mas os vizinhos continuam desenhados em contorno, o que dá
      contexto e custa 5.570 polígonos. Num celular a versão que desenha só os
      144 municípios do estado é bem mais leve. O usuário pediu as duas
      formas; falta o interruptor e a medida que diga quanto pesa cada uma.

- [x] **O mapa se monta sozinho, e desce até o município.** ✅ Feito em
      03/09/2026. Antes ele só aparecia se a variável de linha por acaso fosse
      de UF ou município; quem tabulou por sexo lia "escolha uma variável de
      município ou UF" — o aplicativo pedindo à pessoa que fizesse o que ele já
      tinha como fazer.

      Verificado com o DOINF23: campo achado `CODMUNRES`, 27 estados no mapa
      nacional, 136 municípios com dado ao isolar o Pará, e o título da tabela
      seguiu dizendo `SEXO` o tempo todo — a análise da pessoa não é tocada.

      A descida sai de graça do código do IBGE, cujos dois primeiros dígitos
      são a UF: um campo só desenha os dois níveis. A escolha entre
      `CODMUNRES` e `CODMUNOCOR` privilegia residência, que é decisão de
      domínio — hospital de referência concentra internação de municípios
      vizinhos inteiros, e mapear ocorrência sem dizer responde outra pergunta.

      Um defeito introduzido no caminho e consertado no mesmo dia: a tabulação
      do mapa era guardada sem as condições dela, então um filtro novo deixava
      mapa e tabela discordando em silêncio. O cache passou a depender da
      assinatura dos filtros. Medido: 27 estados sem filtro, 23 filtrando por
      sexo.

- [x] **Partes retomáveis em OPFS** ✅, para conexão de celular que cai no meio.
      Verificado no ar em 2026-09-03 com o DNBR2023: 20 MB gravados, conexão
      cortada, retomada devolveu `206 · bytes 20971520-125549171/125549172`,
      99,7 MB baixados depois, 119,7 MB montados e **SHA-256 conferindo**.

      Vale **só para o espelho**, e o motivo é de segurança: retomar exige
      saber que o arquivo do servidor ainda é o mesmo, senão colar um pedaço
      velho num novo produz um arquivo corrompido que *parece* íntegro. No
      espelho o hash chega no manifesto antes do download, então ele vira a
      chave da parte guardada — e isso resolve a validade sozinho, sem carimbo
      de tempo: parte do arquivo de hash X só serve para o arquivo de hash X.
      Menos urgente depois do conserto do Worker, mas ainda é o que protege
      quem está no 4G num arquivo de 108 MB.

### O que a revisão pediu e já existe

Registrado para não virar trabalho duplicado:

- Processamento fora da thread principal: `apps/web/src/dataset-worker.ts`.
- Selo de privacidade visível: a tarja no topo, desde a primeira versão.
- Busca de variável por nome técnico **e** rótulo do DEF: campo `#field-search`.
- Mapa coroplético e importação de GeoJSON: aba Mapa.
- Código equivalente em dplyr/pandas: no módulo de transformação.
