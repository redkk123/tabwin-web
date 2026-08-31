# Fila reconciliada do corpus de goldens

**Data:** 2026-08-29
**Por que este documento existe:** três fontes diferentes do projeto
descreviam "o que vem depois do G001" de formas incompatíveis:
`docs/testing/GOLDEN_TEST_STRATEGY.md` (mais antigo, ~8 itens),
`docs/product/REMAINING_IMPLEMENTATION_PLAN.md` §P5 (usado para desenhar
G002–G006) e uma lista de ~20 itens que o Codex recuperou de memória numa
conversa fora deste repositório. Este documento reconcilia as três e passa a
ser a fila oficial. Não descarta nada já publicado.

## O que é real, com fonte

A lista do Codex **não existia escrita em nenhum lugar** como fila numerada
fechada. O que existe de fato é `CHECKPOINT_MASTER.md` §8.2 ("Golden corpus
matrix") — uma lista **não ordenada** de comportamentos de CNV e tabulação a
cobrir eventualmente. O Codex pegou essa matriz real e a ordenou/numerou na
hora, apresentando como se a sequência já estivesse fechada. Os conceitos são
legítimos; a ordem é nova, definida agora, aqui.

`CHECKPOINT_MASTER.md` §8.3 confirma, de forma independente da disputa de
numeração, que testes diferenciais com fixtures aleatórias/seed são plano
real — entram na seção 4 deste documento.

## Correção de uma afirmação específica

O Codex afirmou que a reverse-spec registra explicitamente: *"se o texto do
rodapé contiver 'período', o TabWin acrescenta automaticamente os períodos
dos arquivos tabulados"*, e que isso justifica um golden próprio para a
integração com R.

Busquei o termo "período" no documento inteiro (5.055 linhas): **nenhuma
ocorrência**. O que a reverse-spec realmente documenta (§4.8.3) é mais
modesto: o TabWin envia **título, subtítulo, rodapé e nome do mapa** para o
R, sem menção a preenchimento automático de período. O golden fica mantido
— o comportamento sobre rodapé/R é real e vale testar — mas o auto-append de
período fica marcado como **não verificado**: alguém precisa confirmar no
TabWin 4.15 real antes de virar alvo de golden, exatamente pela regra que o
próprio Codex citou: não inventar golden.

---

## 1. G001 — feito, imutável

Complexidade do Procedimento, sem coluna, frequência, sem seleção. **Não é
Sexo** — o `RD2008.DEF` real expõe Sexo só atrás de uma diretiva `X` não
resolvida, e assumir seu papel seria inferir associação DEF/CNV por
semelhança de nome, que o projeto proíbe. Decisão documentada desde
27/08/2026 em `R01_2_A_G001_ASSET_ACQUISITION_REPORT.md`. Passa com
tolerância zero, não muda.

## 2. G002–G006 — protocolo publicado, aguardando captura

Sem mudança. Ver `docs/testing/G002_G006_CAPTURE_PROTOCOL.md`: row×column,
soma, seleção crua, supressão de zeros, não classificados.

## 3. G007 em diante — fila reconciliada

Renumerada a partir de G007 para preservar G002–G006 já publicado. Cada item
tem a fonte que o sustenta. Nenhum tem protocolo click-a-click ainda — isso
se escreve caso a caso, quando a vez chegar, para não travar o começo da
captura em detalhe prematuro.

| # | Semântica | Fonte | Ativo real disponível? |
|---|---|---|---|
| G007 | Precedência de CNV curto (regra específica sobrepõe fallback amplo) | §8.2; **já implícito no próprio G001** — `COMPLEX2.CNV` tem fallback `00-99` sobreposto por `01`/`02`/`03`, e G001 já passa com isso | Sim, `COMPLEX2.CNV` |
| G008 | Código literal / longo (`L` no CNV) | §4.3.7 da reverse-spec | Precisa de um CNV com modo literal — nenhum materializado ainda |
| G009 | Faixas numéricas (`F`/`FAIXAS`) | §4.3.9; §8.2 | Nenhum CNV de faixa materializado |
| G010 | Hierarquia de subtotal em CNV | §4.3.10; §8.2 | Nenhum CNV com subtotal materializado |
| G011 | `#` — linha não totalizável | §4.3.11 | Verificar se algum CNV já disponível usa `#` |
| G012 | Formato novo `N` de CNV | §4.3.12; já detectado e rejeitado explicitamente no parser (`TP_FINAN.CNV` começa com `N`) | `TP_FINAN.CNV` referenciado no DEF, não materializado |
| G013 | Campo com deslocamento (`DEF slice`) | §4.2.3 | A confirmar campo real no `RD2008.DEF` |
| G014 | `G` — registros agrupados (frequência ponderada) | §4.1.6; §8.2 | Nenhum DEF com `G` confirmado ainda neste corpus |
| G015 | Lookup por DBF relacionado | §4.2.4; o próprio `RD2008.DEF` tem vários (`CNES`→`NOMEFANT` via `DBF\TCNESxx.DBF`) | Sim, DEF já referencia; DBF de lookup não materializado |
| G016 | Rodapé/título/subtítulo enviados ao R | §4.8.3, confirmado | Precisa de sessão R real para observar |
| G017 | Múltiplos incrementos simultâneos | §4.1.5; §8.2 | `RD2008.DEF` tem vários campos `I` (`VAL_TOT`, `VAL_SH`, `DIAS_PERM`…) |
| G018 | Múltiplas seleções simultâneas | §4.1.4; §8.2 | Sim, `RD2008.DEF` tem várias entradas `S` |
| G019 | `T` — variável tripla | §4.2.2 | A confirmar entrada `T` real no `RD2008.DEF` |
| G020 | Tipos diferentes de total (soma/produto/média/inicial/final/mín/máx/pré-calculado) | §4.6.2; já implementado no motor moderno, falta golden contra TabWin 4.15 | N/A — é operação pós-tabela, não do TabWin legado; goldens aqui provam o que o TabWin fazia, não a operação moderna |
| G021 | Múltiplos arquivos/meses combinados | §8.2 | Precisa de um segundo DBC real (mesmo esquema) |
| G022 | Encoding/acentuação | §4.4.5; §8.2 | `RDAC2401.dbc` já tem texto acentuado — verificar se algum campo exercita isso |
| G023 | `.TAB` salvar/reabrir | §4.15; §8.2 | Precisa de artefato `.TAB` real |

G020 está marcado à parte de propósito: não é comportamento do TabWin 4.15
legado, é a suíte de operações pós-tabela que **já existe e já tem testes
unitários modernos** (`table-operations.ts`). Um golden aqui provaria que a
suíte antiga do TabWin fazia exatamente isso, não validaria a implementação
moderna — que já está coberta por outro caminho de teste. Mantido na fila
apenas se e quando aparecer evidência de que o TabWin 4.15 tinha essas
mesmas políticas de total.

## 4. Fase seguinte — diferencial por seed

Só começa depois da fila determinística acima fechar substancialmente,
conforme `CHECKPOINT_MASTER.md` §8.3. Fixtures pequenas e aleatórias rodadas
nos dois motores; toda divergência interessante vira golden permanente
imutável, nunca se "conserta" o golden pra passar o teste.

### 4.1 Gerador (metade que não depende do oracle) — pronto

`scripts/differential-seed.mjs` (`npm run seed:differential -- --seeds 1-20
--out .seed-cases`) gera, para cada seed, um caso que é **função pura da
seed**: o `.dbf` real (data de atualização fixada no cabeçalho, senão os bytes
mudariam de um dia pro outro), o `.cnv` quando o plano usa conversão, o plano
normalizado e o resultado **deste** motor. A mesma seed produz os mesmos bytes
em qualquer máquina — é isso que garante que os dois motores recebem o mesmo
caso, e não dois casos parecidos.

As quatro formas de plano miram nos cantos onde a divergência é plausível, não
em dados uniformemente fáceis:

| seed % 4 | o que exercita |
| --- | --- |
| 0 | contagem por UF com supressão de linhas zeradas |
| 1 | CNV que não cobre todo o domínio, não classificados omitidos |
| 2 | soma com decimais, cruzando UF por SEXO |
| 3 | CNV parcial com não classificados discriminados, sob filtro de faixa |

O gerador **não** decide quem está certo, e nada aqui vira golden sozinho.
A outra metade — abrir o mesmo `.dbf` no TabWin 4.15 e capturar o resultado —
depende de quem tem o programa instalado, e segue `G001_CAPTURE_PROTOCOL.md`.
Cobertura em `tests/differential-seed.test.mjs`.

## 5. Regra que vale para tudo isto

`docs/testing/G001_CAPTURE_PROTOCOL.md` §8 (classificação de falha) e a regra
de ouro do projeto se aplicam à fila inteira: nenhum comportamento vira
"compatível" sem fixture real + plano normalizado esperado + teste unitário
+ comparação golden quando existir oracle. Um item desta tabela sem "ativo
real disponível" não pode virar golden por suposição — precisa do arquivo
real primeiro.
