# Handoff — onde parei em 2026-08-28

Para quem continuar o TabWin Web, humano ou modelo. Leia junto com
`CHECKPOINT_MASTER.md` e `PROJECT_STATE.json`.

## ESTADO

O estado recebido estava commitado e enviado para a `main` de
`redkk123/tabwin-web`. `npm run check` ficou verde com **149 testes** após a
auditoria Codex. G001 permaneceu inalterado e ainda `pass`
com tolerância zero.

### Atualização posterior — auditoria Codex

A Faixa 1 de `docs/product/ROADMAP_POR_COMPLEXIDADE.md` foi encerrada: yield de
análise independente de quadro, modalidade final/preliminar em auditoria e
receita, e exportação JSON. A auditoria também corrigiu preservação/restauração
do Worker em abertura, falha e cancelamento, além do falso truncamento de
valores distintos. Relatório completo em
`docs/handoffs/CODEX_AUDIT_CLAUDE_2026-08-28.md`.

### Atualização posterior — Faixa 2.1

A interface de regras cruzadas de qualidade foi entregue. O usuário monta duas
condições sobre campos diferentes, escolhe comparação exata ou numérica,
alterna cada regra entre sinalizar e excluir, e vê a contagem de ocorrências
devolvida pelo Worker. Salvamento e abertura de receita incluem as regras.
Teste real no `RDAC2401.dbc`: `MUNIC_RES = 120040` e `IDADE >= 0` encontrou
1.789 registros tanto em sinalização quanto em exclusão, sem erros no console.
Relatório em `docs/handoffs/R09_1_CROSS_FIELD_QUALITY_UI_REPORT.md`.

O site publicado no GitHub Pages **continua atrás de todos os commits abaixo**,
inclusive da correção da busca nacional. Nenhum deploy foi autorizado.

## AMBIENTE

VM Windows no Google Cloud. O `winget` não instala Node aqui — o MSI exige
elevação UAC impossível numa sessão headless. Node 24.19.0 portátil em
`C:\Users\angelogabriel860\tools\node-v24.19.0-win-x64`, já no PATH do usuário.

Depois de `npm ci`, rode `npm rebuild esbuild workerd`: o npm 11.17 bloqueia
postinstall e o build Vite falha sem os binários de plataforma.

Projeto em `C:\projetos\tabwin-web\TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26`.
Assets privados fora do Git em `C:\projetos\tabwin-private\oracle\`, incluindo
`large/DENGBR25.dbc` baixado do DATASUS.

Regras de convivência em `C:\projetos\PROTOCOLO_VM_COMPARTILHADA.md`, histórico
em `C:\projetos\OPERACOES_LOG.md`, backup em
`C:\projetos\scripts\backup-tabwin.ps1`.

Para rodar o app: `C:\projetos\.claude\launch.json` já aponta para o Vite com o
root correto.

## O QUE FOI ENTREGUE

| Commit | Entrega |
| --- | --- |
| `5f9cc8a` | Restauração da árvore de trabalho que só existia em disco |
| `53a4645` | Leitura de registros em blocos limitados |
| `bb440a8` | **Correção crítica**: busca nacional devolvia catálogo vazio |
| `909d547` | Regras de qualidade cruzadas entre campos |
| `d7ade22` | Agregação da tabulação dentro do Worker |
| `ba1aa14` | Forma incremental limitada para todo consumidor de registros |
| `fafd88b` | Medição de onde vai o tempo ao abrir um DBC |
| `9110d78` | Decodificar somente os campos que o plano lê |
| `09a0d84` | Medição da projeção no arquivo real do Dengue |
| `2f3675c` | O conjunto de dados passa a morar no Worker |
| `2ea8ee7` | Prova do Dengue abrindo em navegador |

Cada um tem relatório em `docs/handoffs/`.

## A CORREÇÃO QUE MAIS IMPORTA

`expandDatasusSearchSelection` removia a UF quando o valor era `BR`, apoiada num
comentário afirmando que o catálogo oficial representa cobertura nacional
omitindo a UF. A premissa é falsa: o endpoint exige `uf[]=BR`.

Consequência: **buscar qualquer arquivo nacional sempre devolvia "nenhum arquivo
encontrado"** — os 58 tipos do SINAN, SINASC/DNEX, SIM/DO, PO. Os testes fixavam
a omissão defeituosa, então passavam enquanto o produto não funcionava.

Detalhes em `CRITICAL_NATIONAL_CATALOG_UF_FIX_REPORT.md`.

## O BLOQUEIO DO DENGUE ACABOU

O `DENGBR25.dbc` abre e tabula na interface. Verificado em navegador com o
arquivo verdadeiro: 1.643.215 registros, 121 campos, tabela `MUNICIPIO` com
1.927 linhas e total 99.257, com **38 MiB de heap na thread principal** para um
DBF que declara 511 MiB. Conferido contra execução independente em Node:
idêntico.

Como chegou lá, em ordem: decodificador DCL em blocos de 4 KiB, montagem de
registros através de fronteiras arbitrárias, acumulador incremental limitado por
células distintas, projeção pelos campos do plano, e o Worker dono do conjunto.

Medições que sustentam o desenho, todas reproduzíveis:

- `bench:decode-breakdown` — 91% do custo é criar objeto de registro, não
  descomprimir;
- `bench:plan-projection` — no Dengue real, 13,2 s projetado contra 190,9 s sem
  projeção, resultado idêntico;
- `bench:record-stream` — pico de memória em lotes não cresce com o arquivo.

## O QUE FALTA, POR BLOCO DO DOCUMENTO MESTRE

Contra o backlog de 42 itens do `CODEX_MASTER_HANDOFF_TABWIN_WEB.md`:

**P0 (1–14) — fechado.** Ressalva: existe **um** golden só, o G001. A seção 12
do documento pede uma bateria por subsistema.

**P1 (15–25) — 7 de 11.** Faltam: log da tabulação `.LST` (18), `.TAB`
archaeology/replay (21), tabela grande virtualizada (23 — hoje corta em 500
linhas), editor/inspector DEF/CNV (24).

**P2 (26–35) — 5 de 10, e os 5 parciais.** Gráficos sem editor de eixos/zoom/
impressão; mapas sem quebras manuais, camadas, legendas e sedes. Faltam
inteiros: seleção espacial (31), distâncias (32), fluxos origem-destino (33),
import geográfico (34), notas técnicas (35).

**P3 (36–42) — 1 de 7.** Feito: data-quality (42). Parciais: 40 e 41, existe
diff de manifesto de fontes mas não diff entre execuções. Faltam: SQL local via
DuckDB (36), export SQL/R/Python (37), plugin de análise (38), substituto
moderno do RX (39).

**Arquitetura, Parte II.** Lacunas estruturais: cache em camadas só tem o L1
(raw, IndexedDB) — **faltam L2 normalizado e L3 de resultado**; Concept Registry
deferido por falta de fonte autoritativa; Progressive Research Query tem
fundação e não o resolvedor; Schema Registry é só checagem; **não há teste
end-to-end** (sem Playwright).

## PRÓXIMO PASSO QUE EU RECOMENDO

**L3 result cache.** Hoje cada reanálise repete uma passada inteira: trocar um
filtro no Dengue custa os 13 s de novo. Um cache de resultado por plano
transforma isso em instantâneo e é a diferença entre abrir o arquivo e
realmente trabalhar com ele.

Depois dele, a **bateria de goldens** — é o que sustenta a palavra
"compatível", e hoje ela se apoia num caso só.

## ARMADILHAS QUE CUSTARAM TEMPO

- **Teste verde não é prova de produto funcionando.** O bug do `uf=BR` passou
  por 121 testes verdes porque os testes fixavam o comportamento defeituoso.
- **Meça antes de desenhar.** Três desenhos meus foram derrubados por medição:
  re-decodificar por análise (80 s por filtro), guardar registros como objeto
  (376 MiB por 1,2 milhão), e a suposição de que o colunar era pré-requisito.
- **O painel de pré-visualização desta VM não compõe quadros**, então
  `requestAnimationFrame` não dispara sozinho e `runAnalysis` fica esperando.
  Um screenshot força o quadro. É limitação do ambiente, mas vale trocar esse
  `await` por `setTimeout` de zero.

## O QUE NÃO FAZER

- Não adicionar `SINAN_P` nem `ESUSNOTIFICA_p` ao seletor. Foram medidos:
  devolvem resposta idêntica a `SINAN` e `ESUSNOTIFICA`, porque o serviço
  resolve preliminar contra final pelo ano consultado. Ver
  `SINAN_CATALOG_AUDIT_2026-08-28.md`.
- Não alterar golden nem G001 para fazer teste passar.
- Não criar um segundo caminho de leitura para arquivo grande. Existe um
  caminho só, sem limiar de tamanho, e foi trabalho para chegar nele.
- Não embutir preset clínico de implausibilidade sem fonte citada.
