# R10.5 — auditoria full-chat do ChatGPT (rodada 1): revisada e aplicada

**Data:** 2026-08-29
**Base:** commit `5879760` (o mesmo enviado ao ChatGPT em modo chat).
**Status:** patch da rodada 1 revisado hunk por hunk, aplicado, testado contra
dependências reais (não os stubs do sandbox dele), e a evidência do G012
aprofundada até a causa provável.

## O que aconteceu antes deste documento

O primeiro pacote que o usuário tentou trazer do ChatGPT chegou com o zip
truncado (`AUDITORIA_FULL_CHAT_5879760_20260829.zip`, 12,9 MB, sem rodapé de
zip válido — `unzip`/`.NET ZipFile` confirmaram independentemente). Uma
segunda rodada (R2, `AUDITORIA_FULL_CHAT_5879760_R2_20260829.zip`) chegou
íntegra, mas era construída **em cima** da rodada 1 sem eu nunca ter aplicado
a rodada 1 de verdade — e o patch da R2 usava `diff -ruN` contra uma cópia
que perdeu a pasta `.github/` (dotfile) em algum ponto do pipeline do
sandbox dele, o que faria `ci.yml` ser sobrescrito por uma versão quebrada
(sem `working-directory`) se aplicado sem revisão. Não apliquei nada da R2.

O usuário conseguiu o zip da rodada 1 de novo, desta vez íntegro, mais o
`AUDITORIA.md` em separado. Este documento cobre só a rodada 1.

## Verificação de integridade antes de ler qualquer coisa

- `sha256sum -c SHA256SUMS.txt` do próprio pacote: **todos OK**.
- O patch está em formato `git diff` de verdade (não `diff -ruN`), o que já
  é sinal de maior fidelidade — provavelmente gerado com `git diff` contra
  uma árvore de trabalho real, não uma reconstrução manual.
- `git apply --check` inicialmente reportou "Skipped patch" nos 7 arquivos.
  Investigado: não era conflito de conteúdo — era o `git apply` resolvendo
  caminhos relativos à raiz do repositório (`C:/projetos/tabwin-web`) em vez
  do subdiretório onde o projeto real vive
  (`TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26/`). Resolvido com
  `git apply --directory=TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26`.
  Depois disso, os 7 arquivos aplicaram **limpo, sem um único conflito**.

## O que foi revisado e aplicado

### 1. G017 — fechamento de um buraco real de validação em runtime

`packages/core/src/plan.ts`: `TabulationSpec` já documentava, em comentário,
que `measure` deveria ser igual a `measures[0]` quando `measures` está
presente — mas `compileQueryPlan` nunca verificava isso. Como uma receita
chega como JSON, o TypeScript não protege em runtime: dava para carregar
uma receita com `measure={count}` e `measures[0]={sum VAL}` incoerentes, ou
um `kind` desconhecido, ou `measures` que não é array.

Extraído `validateMeasure()` compartilhado entre o caminho de medida única e
o de múltiplas medidas (elimina duplicação e fecha o buraco de `kind`
desconhecido, que o código anterior nunca checava). Adicionado
`measuresEqual()` e a checagem `measure === measures[0]`. 5 testes novos em
`tests/multi-measure.test.mjs`, todos passando.

**Verificado:** não muda nenhum plano que a interface atual produz — o
`buildPlan()` do navegador já monta `measures: [measure, ...extraMeasures]`
com a mesma primária, então nenhum fluxo real existente quebra.

### 2. Web Worker — recuperação real, buraco real

`apps/web/src/dataset-worker.ts`: `headerForSources()`, quando a primeira
fonte é CSV/TSV, somava `recordCount` olhando **só** as fontes
`kind: 'records'` — ignorando qualquer DBC/DBF combinado depois via
"Combinar próximos DBC/DBF". Corrigido para iterar todas as fontes,
somando registros binários também e validando compatibilidade de esquema
contra a fonte de registros original.

`apps/web/src/main.ts`: `restoreDatasetWorker()` (chamada depois de
cancelamento ou falha do Worker) reconstruía **só o primeiro CSV/TSV**,
esquecendo qualquer arquivo binário anexado — um dataset reconstruído após
falha podia voltar com menos registros que o original, silenciosamente.
Corrigido para preservar todos os `File` handles anexados na reconstrução.

Também: nova classe `DatasetWorkerInterruptedError`, usada **só** nos dois
caminhos de falha real do Worker (crash de thread, resposta que não
deserializa) — nunca em erro de aplicação comum (verificado: erro de
validação de negócio ainda rejeita com `Error` simples, via
`data.type === 'error'` no `onMessage`). `askDataset()` agora reconstrói o
último dataset **confirmado** automaticamente quando detecta esse tipo de
falha, mas **não repete a operação interrompida sozinho** — evita reenviar
um `append` cujo buffer já foi transferido, o que criaria efeito colateral
ambíguo. A pessoa só precisa repetir a ação uma vez.

**Risco aceito:** este é o item que eu não pude testar em navegador real
ainda (o ChatGPT também não pôde, admitiu isso explicitamente). Typecheck
web limpo, mas fica registrado como pendente de smoke test em navegador
antes de considerar 100% fechado.

### 3. G012 — ferramenta de evidência, sem inventar execução

Novo `scripts/inspect-new-format-cnv.mjs` (+ `npm run inspect:cnv-n`):
lê Windows-1252, respeita o marcador `0x1A`, decodifica as colunas do
formato N (prefixo 5 colunas, sequência 4, rótulo 100, códigos a partir da
113) e reporta payloads de código idênticos entre sequências — puramente
observacional, não atribui semântica ao prefixo, não muda `cnv-parser.ts`.

## O que rodei que o ChatGPT não pôde rodar

Ele foi honesto sobre a limitação: sem rede, sem `npm ci` real, typecheck
feito com stubs de tipo temporários, sem browser real. Eu tinha tudo isso
disponível, então rodei de verdade:

- `npm run check`: **241/241** (era 236 antes do patch; +5 dos novos testes
  de validação de medida), tipagem web limpa, build Vite ok.
- `node scripts/verify-goldens-local.mjs` e
  `verify-second-goldens-local.mjs` contra os arquivos reais: **13/13
  goldens** continuam passando com tolerância zero — o patch não regrediu
  nenhum.
- `npm run inspect:cnv-n -- <NATJUR.CNV real> --sequences 104,524`: **zero
  linhas encontradas** — descobri que 104 e 524 não são o número de
  sequência interno do arquivo (que vai de 1 a 90), são parte do texto do
  rótulo (código de natureza jurídica). Rodando sem filtro:
  `payloads duplicados=0` — a hipótese específica de "duas categorias com a
  mesma lista de códigos" está **descartada** para este arquivo.

## A peça que faltava: contagem direta do campo bruto

Segui a recomendação do próprio ChatGPT (§3, passo 3 do `AUDITORIA.md`):
contar `NAT_JUR` direto no `RDAC2401.dbc` real, sem CNV nenhuma no meio.

```text
código bruto "1023" -> 3282 registros
código bruto "3999" ->  524 registros
código bruto "1147" ->  509 registros
                         ----
                         4315   (bate exato com o total do TabWin)
```

**Não existe nenhum registro com código bruto "1040".** A linha do export
real do TabWin rotulada "104-0 Órgão Público do Poder Legislativo Federal"
mostra **524** — o mesmo valor exato do código `3999` (que corretamente
vira a linha "399-9 Associação Privada"). Ou seja: a linha "104-0" é
**fantasma** — o TabWin real está exibindo os mesmos 524 registros do
código 3999 sob dois rótulos diferentes. Não é coincidência de dois grupos
com o mesmo tamanho; é uma duplicação de apresentação que o próprio TabWin
produz para este CNV formato N específico.

Isso é evidência mais forte e mais precisa do que a rodada de auditoria
tinha — mas ainda **não** explica o mecanismo (por que o prefixo da
sequência 5, "01", faz o código 3999 da sequência 78 aparecer também ali).
G012 continua bloqueado. Próximo experimento, herdado do próprio ChatGPT:
em uma **cópia** do `NATJUR.CNV`, alterar só o prefixo da sequência 5 (ou
da 78) e observar se a duplicação desaparece — teste causal, não mais
observacional.

## Backup, gate e commit

- `npm run check`: 241/241, typecheck e build limpos.
- G001 inalterado (fixture imutável, nunca tocada).
- Backup antes do commit, com hash conferido.

## O que fica pendente para o ChatGPT (ou próxima sessão)

1. Smoke test em navegador real do fluxo CSV+DBC combinado, cancelamento e
   restauração do Worker — o item que nem eu nem o ChatGPT verificamos
   ainda em navegador de verdade.
2. Rodar `npm run inspect:cnv-n` no seu round1 real teria sido impossível
   sem os ativos privados — agora que rodei, a evidência está registrada
   aqui e pode alimentar a próxima rodada de auditoria dele.
3. Corrigir meu processo de empacotamento (`git archive` com
   `core.autocrlf=true` nesta máquina corrompe terminador de linha de
   arquivos de texto no zip) antes do próximo pacote — usar
   `git -c core.autocrlf=false archive`.
4. Round 2 do ChatGPT (Playwright/4.9/4.10) segue **não aplicado** — o
   `ci.yml` dele sobrescreveria a configuração real de forma quebrada.
   Vou reimplementar a parte boa (config do Playwright, os dois testes E2E,
   que batem certinho com os IDs reais da minha interface) manualmente
   contra os arquivos reais, sem usar o diff dele mecanicamente.
