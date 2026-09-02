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

## Bloco 4 — Pendências antigas

- [ ] Segredo `CLOUDFLARE_API_TOKEN` no GitHub, para o workflow do Worker
      publicar sozinho. **Depende do usuário.**
- [ ] Drive: 6 duplicatas antigas na pasta `SIDS_R95`; o envio da versão
      corrigida nunca completou.
- [ ] `REMAINING_IMPLEMENTATION_PLAN.md` está defasado (baseline R05.1).

## Bloco 5 — Evolução sugerida na revisão

Ordem por valor sobre esforço, não por ordem de chegada.

- [ ] **Exportar Parquet.** Formato colunar é o que R e Python querem hoje, e
      é o único item da revisão externa que não existe de alguma forma.
- [ ] **Primeiro DBC absurdamente fluido.** A revisão apontou isto como o que
      vende o projeto sozinho: buscar no DATASUS → escolher → abrir → tabela,
      sem atrito. Medir o caminho inteiro e atacar o pior trecho.
- [ ] **Partes retomáveis em OPFS**, para conexão de celular que cai no meio.
      Menos urgente depois do conserto do Worker, mas ainda é o que protege
      quem está no 4G num arquivo de 108 MB.

### O que a revisão pediu e já existe

Registrado para não virar trabalho duplicado:

- Processamento fora da thread principal: `apps/web/src/dataset-worker.ts`.
- Selo de privacidade visível: a tarja no topo, desde a primeira versão.
- Busca de variável por nome técnico **e** rótulo do DEF: campo `#field-search`.
- Mapa coroplético e importação de GeoJSON: aba Mapa.
- Código equivalente em dplyr/pandas: no módulo de transformação.
