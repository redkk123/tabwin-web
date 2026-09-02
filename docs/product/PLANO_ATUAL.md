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

## Bloco 3 — Laboratório publicado

- [ ] `npm run lab:sync` traz o Lab para `/lab/`; o link no topo aparece
      sozinho quando `lab/ORIGEM.json` responde.
- [ ] Publicar o Lab publica o código-fonte dele: um app estático de navegador
      entrega o próprio JavaScript. Conteúdo auditado em 02/09 — sem segredos,
      sem dado pessoal, fixtures sintéticas.

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
- [ ] **Concorrência adaptativa no download**, hoje fixa em 4 faixas.
- [ ] **Partes retomáveis em OPFS**, para conexão de celular que cai no meio.

### O que a revisão pediu e já existe

Registrado para não virar trabalho duplicado:

- Processamento fora da thread principal: `apps/web/src/dataset-worker.ts`.
- Selo de privacidade visível: a tarja no topo, desde a primeira versão.
- Busca de variável por nome técnico **e** rótulo do DEF: campo `#field-search`.
- Mapa coroplético e importação de GeoJSON: aba Mapa.
- Código equivalente em dplyr/pandas: no módulo de transformação.
