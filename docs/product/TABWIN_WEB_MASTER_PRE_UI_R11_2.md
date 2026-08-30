# TabWin Web — Especificação mestre pré-UI: aquisição DATASUS, limpeza, fórmulas, comparação, auditoria estatística, mapas, documentação e faxina final

**Status:** especificação mestre de engenharia consolidada desta conversa + pré-implementação de auditoria/comparação; inclui requisitos de aquisição DATASUS, limpeza, fórmulas, mapas, comparação, auditoria, documentação e faxina pré-final  
**Data-base:** 2026-08-30  
**Classificação do projeto:** INOVAÇÃO, sem alterar a semântica COMPAT do TabWin 4.15  
**Prioridade:** alta; congelar contratos antes da correção visual final da UI  

---

## 0.0 Matriz de cobertura desta conversa — requisito de completude

Este documento substitui os handoffs analíticos anteriores desta conversa. Ele não deve ser tratado como um adendo. O objetivo desta matriz é impedir que uma ideia discutida fique registrada apenas superficialmente, seja reduzida a um exemplo isolado ou seja esquecida na implementação.

| Assunto discutido | Decisão consolidada | Onde está formalizado | Gate de conclusão |
|---|---|---|---|
| Faxina do repositório antes da UI final | Tirar entulho histórico da raiz sem apagar rastreabilidade; arquivar protótipos/checkpoints/handoffs obsoletos; revisar documentação stale | §1.2 | `npm run check` + referências internas válidas + raiz limpa |
| Manual final | Criar manual em dois níveis: “5 minutos” + referência completa; incluir ponte TabWin clássico → TabWin Web | §28 | Manual só fecha depois da UI congelada |
| Mapas dinâmicos | Preservar mapa temático interativo já existente e tratá-lo como contrato de não regressão; não transformar o projeto em GIS genérico | §1.3 | seleção espacial → filtro, classificação, legenda, missing, export e sincronização testados |
| Operações matemáticas | Formalizar operadores existentes e completar uma biblioteca analítica coerente | §1.4 e §6 | parser + registry + testes de domínio/erro/divisão por zero |
| Funções estilo Excel | Sintaxe familiar, nomes de coluna semânticos; sem células A1, VBA ou lookup opaco | §6 | autocomplete, help, funções P0 e fórmulas reproduzíveis |
| Comparação de tabelas | Feature de primeira classe, não `include-table`; alinhar, diagnosticar, comparar, normalizar e investigar diferenças | §7 | cobertura, unmatched, granularidade e métricas sempre explícitos |
| Caso HB_ALL / subconjunto versus restante | Atalho “filtro atual × restante” e análise de influência/concentração | §7.10 | reproduzível sem exportar para R/Excel |
| SIH × SIM e outras fontes | Comparar fontes distintas sem casar campos silenciosamente; exigir semântica temporal/geográfica explícita | §4.19, §7 e §14 | alinhamento confirmado + provenance por lado |
| Aula/fluxo do Wanderson | Transformações equivalentes a `select`, `filter`, `mutate`, `group_by/summarise`, `count`, recode, missing e bind/join pela interface | §5 | pipeline visual auditável e reexecutável |
| Limpeza manual de dados | IA opcional; toda transformação deve existir manualmente e produzir diff | §5 e §19 | nenhuma alteração invisível; before/after e N afetado |
| Código IBGE | Padronização explícita 6/7 dígitos, zeros à esquerda, validação e diff | §5.3 e §4 | zero à esquerda nunca perdido silenciosamente |
| Datas | Diferenciar notificação, sintomas, digitação etc.; conversão e extração explícitas | §5.3 e §4.10 | campo temporal escolhido fica na receita |
| “Ignorado” | Não assumir universalmente que é categoria nem NA; política por variável e relatório de perda | §4.9, §5.3, §9.8 | missingness preservada e reportada |
| MicrodataSUS dentro do app | Ir além do download: descoberta + raw + processors `process_*` + schemas versionados + combinação + provenance | §4 | fluxo reproduzível sem R/FTP manual |
| `rbind`/combinação de anos | Empilhar anos/UF/competências com schema drift explícito | §4.11, §5.3 | arquivo ausente ≠ zero; incompatibilidade de tipo bloqueia/sinaliza |
| “Ver código equivalente” | A operação visual pode exibir R/pandas equivalente como recurso pedagógico, sem usar esse código como motor | §5.5 e §28 | código é derivado do pipeline, não fonte da verdade |
| IA propondo limpeza | IA gera `TransformStep`, mostra diff e aguarda aprovação | §19 | sem aprovação, nada muda |
| Estranheza via estatística | Detectar padrões incomuns genericamente, sem depender do paper ou de regra clínica | §8–§13 | métodos transparentes, efeito + incerteza + BH quando cabível |
| Paper de sífilis | Usar como fixture/metodologia de validação do mecanismo, não como hardcode | §15 | motor encontra padrões sem conhecer a conclusão |
| Valores extremos versus fenômenos reais | Separar anomalia estatística, inconsistência lógica e impossibilidade de domínio | §8.2 | detector nunca chama automaticamente de erro |
| Persistência/difusão territorial | Criar assinatura estatística de grupos raros | §9.5–§9.6 | tempo + território + concentração + completude |
| Categoria estranha sistemática | Comparar proporção do grupo com referência e distribuição mais ampla | §9.4 e §9.7 | IC + efeito + referência explícita |
| Explodir faixa agregada | Abrir `10–14`, `80+` etc. nos valores originais quando possível | §13 | operação não destrutiva e provenance preservada |
| Pipeline reexecutável | Salvar todas as operações e repetir em novos anos/dados | §4.18, §5.4, §18 | `.twrecipe` contém parâmetros efetivos |
| UI final | Só depois dos contratos analíticos e testes; visual não deve mascarar semântica incompleta | §25 e §29 | feature freeze analítico antes da passada visual |

### Regra de leitura desta especificação

Quando uma seção usa exemplos de sífilis, SIH, SIM, HB ou chikungunya, o exemplo serve apenas para tornar o contrato testável. **A feature deve funcionar para bases arbitrárias compatíveis**, sem doença, idade, hospital ou sistema hardcoded.

### Ordem conceitual do produto

```text
Fonte oficial/importada
  ↓
Aquisição + provenance
  ↓
Preparação específica do sistema (process_*)
  ↓
Limpeza/transformação manual e auditável
  ↓
Tabulação / fórmulas
  ↓
Comparação de tabelas e subconjuntos
  ↓
Auditoria estatística de estranheza
  ↓
Mapa/gráfico/tabela
  ↓
Exportação + receita + relatório
```

## 0. Decisão executiva

O TabWin Web deve ganhar uma bancada analítica local, auditável e reproduzível com **cinco capacidades integradas**:

1. **Aquisição e preparação de microdados DATASUS dentro do aplicativo**, no espírito do `{microdatasus}`: escolher sistema, tipo, período e território; descobrir os arquivos oficiais realmente disponíveis; baixar, abrir, combinar e preparar os dados sem exigir R nem FTP manual.
2. **Transformação/limpeza manual de dados**, equivalente aos verbos úteis de `dplyr`, mas operada pela interface e sempre com histórico/diff.
3. **Fórmulas e colunas derivadas**, com sintaxe familiar ao Excel sem transformar o produto em uma planilha de células A1/B2.
4. **Comparação geral de tabelas**, capaz de alinhar, diagnosticar e comparar tabelas de fontes, períodos ou subconjuntos diferentes sem exigir exportação manual.
5. **Auditoria estatística automática de estranheza**, cujo trabalho é encontrar padrões estatisticamente incomuns sem declarar que são erros e sem depender de um paper, doença ou regra clínica pré-programada.

A quinta capacidade é a mais importante deste documento, mas a primeira é o ponto de entrada que permite que todo o restante aconteça sem uma etapa externa em R/Python. O sistema atual já permite ao usuário **escrever regras explícitas de implausibilidade** e inspecionar combinações raras. O que falta é uma camada diferente: o computador procurar sozinho por sinais estatísticos estranhos, explicá-los e entregar ao usuário caminhos de investigação.

**Regra central:**

> Estatística detecta estranheza. Regra de domínio avalia plausibilidade. O usuário decide se há erro, fenômeno real ou artefato sistemático.

Nunca transformar `p < 0,05`, um outlier, uma concentração geográfica ou uma categoria rara em “dado errado”. Nunca excluir automaticamente registros por uma detecção estatística.

---

# 1. Estado real do repositório e lacunas

Esta especificação parte da árvore atual do projeto, não de uma arquitetura hipotética.

## 1.1 O que já existe e deve ser reutilizado

### `packages/acquisition/src/datasus.ts` e aquisição oficial já existente

O repositório atual **já não parte do zero** na ideia “MicrodataSUS pelo aplicativo”. O README atual declara catálogo do DATASUS dentro do app, cache local/offline, provenance de origem/coleta/hash e exportação Microdatasus do subconjunto ativo. Em `datasus.ts` já existem contratos para:

- sistemas e tipos de arquivo;
- periodicidade anual/mensal;
- cobertura BR/UF;
- seleção de múltiplos anos, meses e UFs;
- descoberta no catálogo oficial;
- manifesto de disponibilidade;
- manifesto persistível de fontes;
- diff entre manifestos;
- resolução auxiliar verificada em casos específicos;
- lista ampla de sistemas, incluindo SIH, SIA, SIM, SINASC, CNES, SINAN e IBGE.

Portanto, **não criar um segundo cliente DATASUS**. A inovação especificada neste documento deve estender essa camada para entregar a experiência de `fetch_datasus() + process_*()` pela interface, preservar provenance e conectar o resultado diretamente à limpeza, comparação e auditoria.

### `packages/analysis/src/data-quality.ts`

Já existe uma base correta para qualidade de dados:

- perfil numérico;
- mínimo, quartis, mediana, máximo;
- cercas IQR;
- contagem de outliers IQR;
- coleta limitada de valores distintos;
- perfil de combinações de campos;
- arquitetura incremental/streaming para não duplicar semântica entre memória e batches.

O comentário do próprio módulo já estabelece o princípio certo: combinação rara é observação, não conclusão de erro.

### `packages/core/src/model.ts`

Já existem:

- `CrossFieldRuleSpec`;
- ações `flag` e `exclude`;
- `DataQualityRuleOutcome`;
- `FilterSpec.origin = 'data-quality'`;
- persistência das regras no plano de tabulação.

Ou seja: o motor de **regras declaradas pelo usuário** já tem contrato.

### `packages/analysis/src/table-operations.ts`

Já existem:

- operações binárias;
- fator;
- cumulativo;
- absoluto;
- arredondamento/truncamento/floor/ceil;
- sequência;
- constante;
- expressão;
- transposição;
- renomear/mover/apagar coluna;
- suprimir/agregar linhas;
- `include-table`.

`include-table` é útil, mas **não é comparação geral de tabelas**. Ele exige correspondência exata de todas as chaves de linha e foi desenhado para incluir colunas de outra tabela já perfeitamente alinhada. A nova comparação deve trabalhar inclusive quando há chaves faltantes, granularidades divergentes ou mapeamentos explícitos.

### `packages/analysis/src/statistics.ts`

Já existem:

- N, soma, média, mínimo, máximo, mediana;
- variância/desvio-padrão amostral;
- correlação de Pearson;
- regressão linear simples e R²;
- histograma.

A nova auditoria deve **complementar**, não duplicar, esse módulo.

### Roadmap atual

O roadmap já reconhece:

- limpeza não destrutiva;
- regras cross-field;
- combinações raras;
- necessidade de deduplicação e consistência;
- bancada epidemiológica com taxas/IC, RR/OR, qui-quadrado/Fisher, série temporal e regressões.

Esta especificação organiza essas peças em um produto coerente e adiciona o que ainda não estava formalizado: **descoberta estatística automática de anomalias** e **comparação geral de tabelas**.

---

## 1.2 Faxina pré-UI do repositório — separar produto atual de memória histórica

A raiz atual ainda contém artefatos históricos úteis para rastreabilidade, mas ruins como estado operacional. A limpeza deve acontecer **antes da correção visual final**, para que o agente de UI não leia decisões antigas como se fossem requisitos vigentes.

### Objetivo

A raiz deve responder rapidamente: “o que é necessário para executar, testar, entender e continuar o produto agora?”. Histórico de agentes e snapshots antigos continuam acessíveis, porém arquivados.

### Estrutura alvo da raiz

```text
.claude/
.github/
apps/
docs/
e2e/
fixtures/
packages/
scripts/
tests/

.gitignore
CHECKPOINT_MASTER.md
PROJECT_STATE.json
README.md
package.json
package-lock.json
playwright.config.ts
tsconfig.json
vite.config.ts
web.tsconfig.json
```

### Ações propostas

1. **`prototype/`**
   - confirmar por `git grep` e build que não é importado;
   - se for apenas R00 histórico, mover para `docs/legacy/prototype-r00/`;
   - apagar somente se houver decisão explícita de que o histórico não é necessário.

2. **Checkpoints antigos da raiz**
   - mover `CHECKPOINT_MASTER_R00.md`, `CHECKPOINT_MASTER_R01_0_DEV.md`, `CHECKPOINT_MASTER_R01_1_DEV.md`, `CHECKPOINT_MASTER_R01_1_DEV_PLUS_CLOUD.md`, `CHECKPOINT_MASTER_R01_2_VM_BOOTSTRAP.md` para `docs/legacy/checkpoints/`;
   - manter `CHECKPOINT_MASTER.md` e `PROJECT_STATE.json` como memória viva.

3. **Handoffs de agentes na raiz**
   - mover `CLAUDE_RETURN_PROMPT_2026-08-28.md`, `GEMINI_HANDOFF.md`, `HANDOFF_README.md`, `SELF_HANDOFF_CHATGPT.md` para `docs/handoffs/archive/agents/` ou equivalente;
   - manter um `docs/handoffs/README.md` curto dizendo qual é o handoff corrente e como navegar no arquivo.

4. **`docs/handoffs/`**
   - separar `current/` de `archive/`;
   - organizar histórico por release/onda (`r01-r05`, `r06-r09`, `r10+`) sem renomear de modo que quebre links existentes sem correção correspondente;
   - não apagar relatórios que sustentam decisões de compatibilidade/golden.

5. **`TEST_STATUS.md`**
   - verificar contra `README`, CI e `npm run check`;
   - se estiver desatualizado, substituir por documento gerado/atualizado ou mover o estado histórico para arquivo;
   - nunca manter contagem de testes “congelada” como se fosse fonte de verdade quando o projeto já avançou.

6. **Artefatos que não são lixo**
   - não mexer em `apps/`, `packages/`, `tests/`, `e2e/`, `fixtures/golden/`, `scripts/` e configs de build apenas para “deixar bonito”;
   - `.claude/` pode permanecer enquanto for ferramenta de desenvolvimento ativa;
   - não remover fixtures ou relatórios usados como evidência de compatibilidade.

### Procedimento seguro de limpeza

```text
1. git status limpo
2. npm ci
3. npm run check
4. npx playwright install chromium (se necessário)
5. npm run e2e
6. git grep <nome de cada artefato a mover>
7. mover/arquivar
8. corrigir links relativos
9. npm run check
10. npm run e2e
11. verificar GitHub Pages/build
```

### Critérios de aceitação

- [ ] Nenhum import/build/test aponta para caminho removido.
- [ ] Links do README/checkpoints principais continuam válidos.
- [ ] A raiz contém majoritariamente estado atual, não memória de agentes.
- [ ] Histórico de compatibilidade continua recuperável.
- [ ] Nenhum golden é removido por “faxina”.
- [ ] `npm run check` passa após a reorganização.
- [ ] E2E crítico passa após a reorganização.

---

## 1.3 Mapas dinâmicos — contrato de não regressão e acabamento

O produto atual já possui mapa temático interativo suficiente para ser chamado de **dinâmico** no contexto do TabWin: o README atual registra mapas temáticos, quebras manuais, camadas de referência, sedes, legenda discreta e seleção espacial que se transforma em filtro da análise. Isso deve ser preservado enquanto as novas features analíticas entram.

### O que “mapa dinâmico” significa neste projeto

P0:

- variável/medida da tabela ativa alimenta o mapa;
- classificação temática recalcula quando o dado/filtro muda;
- legenda reflete exatamente os cortes usados;
- valores ausentes têm estado visual e contagem explícitos;
- clique/seleção espacial identifica a unidade geográfica;
- seleção pode gerar/aplicar filtro na análise;
- o usuário pode desfazer/limpar seleção;
- camadas de referência e sedes não alteram os dados;
- mapa, tabela e filtros devem compartilhar a mesma chave territorial/provenance;
- impressão/exportação não pode mudar classes ou números.

### Classificação

Preservar os modos já suportados pelo motor atual e testá-los como contrato, incluindo quando presentes no código:

- escala contínua;
- intervalos iguais;
- quantis;
- cortes manuais.

Se o código atual limitar número de classes/paletas, documentar esses limites no manual em vez de escondê-los. Qualquer futura adição (por exemplo Jenks) é **INOVAÇÃO separada**, com teste próprio e sem alterar resultado das classificações existentes.

### Interação com auditoria estatística

O mapa deve poder receber um `StatisticalSignal` territorial e oferecer:

```text
[Sinal: concentração geográfica]
→ Mostrar no mapa
→ Destacar unidades que compõem top-1/top-5 share
→ Comparar grupo × referência
→ Abrir registros
```

O mapa visualiza o achado; ele não decide sua interpretação.

### Interação com comparação de tabelas

Para tabelas A/B territorialmente alinhadas:

- mapa A;
- mapa B;
- mapa de `B-A`;
- mapa de razão `B/A` quando definida;
- mapa de diferença relativa;
- mesma classificação opcional nas duas vistas para comparação honesta.

P1: modo lado a lado/sincronizado. Não é necessário transformar o produto em GIS.

### Fora de escopo por default

Não adicionar apenas para “parecer GIS”:

- buffer;
- dissolve;
- intersection espacial arbitrária;
- edição de geometrias;
- roteamento;
- geoprocessamento pesado genérico.

Essas operações só entram se houver caso epidemiológico concreto e contrato separado.

### Gate de mapa antes da UI final

- [ ] seleção espacial continua gerando filtro correto;
- [ ] tabela e mapa concordam em N/medida;
- [ ] missing não recebe classe numérica por acidente;
- [ ] classificação manual é reproduzível;
- [ ] troca de filtro recalcula mapa e legenda;
- [ ] export/print preserva o estado mostrado;
- [ ] nenhum novo módulo analítico quebra o renderer/hit-test.

---

## 1.4 Operações matemáticas — baseline e contrato de completude

A pergunta “tem todas as operações matemáticas?” deve ser respondida por contrato, não por sensação. O produto já possui aritmética e várias operações de tabela, mas não deve prometer uma linguagem matemática geral infinita.

### Baseline atual a preservar

- `+`, `-`, `*`, `/`, `^`;
- parênteses e precedência;
- operações entre colunas;
- fator/multiplicação;
- acumulado;
- absoluto;
- arredondamento;
- truncamento;
- `floor`/`ceil`;
- sequência;
- constante;
- expressão derivada;
- operações estruturais de coluna/linha já existentes.

### Contrato de erro

- divisão por zero → `NA/null` + diagnóstico, nunca zero inventado;
- overflow/resultado não finito → sinal explícito;
- tipo incompatível → erro antes de aplicar;
- função de janela (`LAG`, acumulado etc.) exige ordenação declarada;
- fórmula que depende de denominador deve registrar qual coluna/medida foi usada;
- alteração de nome de coluna deve atualizar referências de fórmula ou bloquear com mensagem clara.

### Não prometer “Excel inteiro”

A meta é uma linguagem analítica epidemiológica familiar a quem usa Excel. O núcleo deve ser pequeno, testável, documentável e extensível via registry. O conjunto P0/P1 está em §6.


# 2. Arquitetura alvo

Não colocar tudo em `data-quality.ts` e não aumentar `main.ts` indefinidamente. Separar contratos por responsabilidade.

```text
packages/acquisition/src/
  datasus.ts                     # manter: catálogo/descoberta oficial e manifestos
  research.ts                    # manter/adaptar: fluxo de aquisição de pesquisa
  datasus-processing.ts          # NOVO: contratos process_* por sistema
  datasus-schema-registry.ts     # NOVO: campos, tipos, labels, sentinelas e versões
  auxiliary-tables.ts            # NOVO/extração: tabelas auxiliares verificadas

packages/analysis/src/
  data-quality.ts                # manter: perfis e regras existentes
  statistical-anomaly.ts         # NOVO: estranheza estatística explicável
  anomaly-orchestrator.ts        # NOVO: executa detectores e agrega achados
  table-comparison.ts            # NOVO: alinhamento/comparação de tabelas
  data-transform.ts              # NOVO: transformações manuais de registros
  formula-functions.ts           # NOVO: registro de funções de fórmula
  statistics.ts                  # manter + ampliar testes inferenciais úteis

packages/core/src/
  model.ts                       # contratos persistíveis mínimos
  recipe.ts                      # incluir planos de transformação/comparação/auditoria
  portable-table.ts              # persistir metadados necessários de comparação

apps/web/src/
  main.ts                        # somente coordenação
  ...                            # idealmente extrair painéis durante a passada de UI

tests/
  statistical-anomaly.test.mjs
  table-comparison.test.mjs
  data-transform.test.mjs
  formula-functions.test.mjs
```

A pré-implementação anexada a este handoff já contém:

- `packages/analysis/src/statistical-anomaly.ts`
- `packages/analysis/src/table-comparison.ts`
- testes iniciais para ambos.

Esses dois módulos compilam em TypeScript 5.8.3 com `strict`, `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`. O conjunto inicial de 8 testes passa. Eles **não estão integrados à UI nem aos exports do repo**, pois esta entrega não possui checkout gravável do repositório; são arquivos de overlay para o próximo agente.

---

# 3. Princípios não negociáveis

## 3.1 Fonte bruta é imutável

Nenhuma limpeza altera silenciosamente o arquivo DBC/DBF/CSV original. Transformações produzem uma visão analítica derivada e um histórico reproduzível.

## 3.2 Nenhuma anomalia estatística implica erro

O motor deve usar linguagem como:

- “estatisticamente incomum”;
- “difere do padrão de referência”;
- “concentrado em poucas unidades”;
- “mudança abrupta na série”;
- “combinação rara”;
- “requer revisão”.

Evitar:

- “registro falso”;
- “idade errada”;
- “corrigir automaticamente”;
- “remover outliers”.

## 3.3 P-valor nunca anda sozinho

Em bases do SUS com centenas de milhares/milhões de registros, diferenças irrelevantes podem produzir p-valores minúsculos. Um sinal inferencial só pode subir de severidade se houver simultaneamente:

- tamanho de efeito relevante;
- N suficiente;
- estatística/IC ou método robusto apropriado;
- correção de múltiplos testes quando vários sinais são vasculhados;
- explicação legível.

## 3.4 Default pode existir; default invisível não

Todo limiar deve aparecer no relatório:

```text
Detector: Hampel robusto
Janela: ±3 períodos
Transformação: log1p
Limiar: |z robusto| ≥ 3,5
```

O usuário pode usar modo “Recomendado”, mas a receita registra os valores efetivos.

## 3.5 Detecção e regra de domínio são camadas separadas

- **Detector estatístico:** “esta idade/categoria/combinação/distribuição é incomum”.
- **Regra explícita:** “para esta análise, `idade >= X AND gestante = sim` deve ser sinalizada”.

A primeira pode ser automática. A segunda só entra por ação explícita do usuário ou por preset com fonte metodológica claramente identificada.

## 3.6 Nada é excluído por descoberta automática

Botões permitidos em um achado:

- Abrir registros;
- Criar filtro;
- Comparar com referência;
- Criar regra de sinalização;
- Marcar como esperado;
- Adicionar ao relatório;
- Investigar por tempo/local/campo.

“Excluir” só aparece depois que uma regra explícita é criada e deve continuar sendo uma ação auditável.

---

# 4. Módulo 0 — Microdados DATASUS dentro do aplicativo

## 4.1 Objetivo de produto

A experiência desejada é o equivalente funcional do fluxo mental:

```r
dados <- fetch_datasus(
  year_start = 2013,
  year_end = 2014,
  uf = "RJ",
  information_system = "SIM-DO"
)
dados <- process_sim(dados)
```

sem exigir R, pacote externo, terminal ou navegação manual no FTP.

Na interface:

```text
Dados oficiais
  → Sistema: SIM
  → Tipo: Declarações de óbito (DO)
  → Período: 2013–2014
  → Território: RJ
  → [Ver disponibilidade]
  → [Baixar e abrir]
  → Preparação: Original / Preparado para análise
```

O nome `{microdatasus}` aqui descreve **o fluxo de aquisição e preparação que queremos tornar acessível**, não uma dependência de runtime e não uma promessa de compatibilidade byte-a-byte com o pacote R.

### Regra arquitetural

- reutilizar `packages/acquisition/src/datasus.ts`;
- não embutir R;
- não depender de serviço privado;
- arquivos oficiais continuam sendo a fonte;
- o proxy continua opcional e restrito às origens oficiais;
- navegador permanece local-first;
- bruto e preparado são camadas distintas;
- toda preparação é versionada e auditável.

## 4.2 O que já existe versus o que falta

### Já existe no produto atual

Segundo o README e os contratos atuais:

- catálogo oficial DATASUS dentro do aplicativo;
- escolha de sistemas/tipos;
- seleção de múltiplos períodos e UFs;
- verificação de disponibilidade no momento da consulta;
- cache local reabrível;
- provenance da aquisição;
- DBC/DBF lido no navegador;
- manifestos de fontes e comparação de manifestos;
- exportação CSV no formato útil para fluxo Microdatasus.

### Falta para completar a ideia discutida

1. **camada `process_*` por sistema**;
2. schema registry versionado;
3. preparação opcional de campos conhecidos;
4. de-para e labels auditáveis;
5. tipos e datas coerentes entre arquivos/anos;
6. combinação multiarquivo com diagnóstico de drift de schema;
7. escolha de variáveis antes/depois da leitura quando tecnicamente possível;
8. separação visual entre “bruto DATASUS” e “preparado”;
9. atualizar uma aquisição salva e mostrar o que mudou;
10. conexão direta aquisição → limpeza → comparação → auditoria;
11. relatório de cobertura dos arquivos pedidos versus encontrados;
12. suporte explícito a grandes séries sem forçar tudo para RAM.

## 4.3 Contrato persistível da aquisição

Adicionar um plano semântico independente da UI:

```ts
export interface DatasusAcquisitionPlanV1 {
  schema: 'tabwin-web.datasus-acquisition';
  version: 1;

  source: 'DATASUS_OFFICIAL';
  system: string;
  fileType: string;

  years: string[];
  months?: string[];
  ufs?: string[];

  variables?: string[];

  availabilityPolicy: 'require-all' | 'allow-partial';
  preparation: {
    mode: 'raw' | 'analysis-ready';
    processorId?: string;
    processorVersion?: string;
    options?: Record<string, unknown>;
  };

  expectedManifestFingerprint?: string;
}
```

O plano **não deve armazenar URLs inferidas manualmente como fonte da verdade** quando elas puderem ser reconstruídas/verificadas pelo catálogo oficial. A execução produz um manifesto observado.

## 4.4 Resultado da aquisição

```ts
export interface DatasusAcquisitionResultV1 {
  plan: DatasusAcquisitionPlanV1;
  sourceManifest: DatasusSourceManifestV1;

  requestedSlots: number;
  availableSlots: number;
  missingSlots: DatasusSearchQuery[];

  files: DatasusAcquiredFile[];
  rawDatasetId: string;
  preparedDatasetId?: string;

  schemaDiagnostics: DatasusSchemaDiagnostics;
  warnings: DatasusAcquisitionWarning[];
}
```

Para cada arquivo:

```ts
export interface DatasusAcquiredFile {
  name: string;
  officialAddress: string;
  catalogQuery: DatasusSearchQuery;

  fetchedAt: string;
  byteLength: number;
  sha256: string;

  rowCount?: number;
  decodeStatus: 'pending' | 'decoded' | 'failed';
  cacheKey?: string;
}
```

A auditoria precisa distinguir:

- “pedido”;
- “disponível no catálogo”;
- “baixado”;
- “decodificado”;
- “incluído na base final”.

Nunca transformar um download parcial em uma série aparentemente completa.

## 4.5 Política de disponibilidade

Dois modos explícitos:

### `require-all`

Se qualquer combinação ano/mês/UF pedida estiver ausente, não construir silenciosamente a base final.

UI:

> 312 competências solicitadas; 310 disponíveis. Faltam AC/2020-04 e RR/2021-02.  
> [Rever seleção] [Continuar como análise parcial]

### `allow-partial`

Permite continuar, mas:

- banner persistente “aquisição parcial”;
- lista exata dos slots faltantes;
- flag na `.twrecipe`;
- exportação e relatório carregam o warning;
- série temporal mostra lacunas em vez de zero.

**Ausência de arquivo nunca vira zero epidemiológico.**

## 4.6 Registro de schemas por sistema

Criar `datasus-schema-registry.ts`.

O registry não deve ser apenas um map de labels. Cada campo conhecido precisa poder declarar:

```ts
export interface DatasusFieldSchema {
  rawName: string;
  canonicalName?: string;
  label: string;

  logicalType: 'string' | 'integer' | 'number' | 'date' | 'category' | 'code';
  physicalVariants?: string[];

  missingCodes?: Array<string | number>;
  notApplicableCodes?: Array<string | number>;

  dictionary?: Record<string, string>;
  normalizerId?: string;

  validFrom?: string;
  validUntil?: string;
  evidence?: DatasusSchemaEvidence[];
}
```

### Por que versionar

Campos, códigos e definições podem mudar ao longo de anos. O programa não pode aplicar um de-para de 2026 retroativamente a 2008 sem evidência de que a codificação é a mesma.

Quando houver mudança:

```text
CLASSI_FIN
2007–2016 → dictionary v1
2017–2025 → dictionary v2
```

O processor seleciona a versão usando origem/período e registra qual regra foi aplicada.

## 4.7 `process_*()` no TabWin Web

Criar processadores pequenos e explícitos, por exemplo:

```ts
export interface DatasusProcessor {
  id: string;
  version: string;
  supports(input: DatasusProcessorInput): boolean;
  describe(): DatasusProcessorDescription;
  prepare(input: AsyncIterable<RecordBatchLike>, options: unknown):
    Promise<DatasusPreparedDataset>;
}
```

Registry inicial conceitual:

```text
process_sim
process_sinasc
process_sih_rd
process_sia_pa
process_cnes_st
process_cnes_pf
process_sinan_<agravo suportado>
```

### O que um processor pode fazer

- atribuir tipos conhecidos;
- preservar zero à esquerda em códigos;
- decodificar categorias com dicionário versionado;
- criar labels sem destruir o código bruto;
- derivar campos canônicos documentados;
- normalizar nomes entre arquivos equivalentes;
- incorporar tabela auxiliar **somente quando a relação foi verificada**;
- marcar códigos desconhecidos;
- emitir warnings de schema drift.

### O que um processor não pode fazer

- filtrar casos porque “normalmente se usa assim”;
- remover ignorados;
- deduplicar pessoas;
- escolher data epidemiológica;
- excluir registros implausíveis;
- alterar definição de caso;
- aplicar decisão científica sem ação do usuário.

Essas decisões pertencem ao pipeline de transformação/análise.

## 4.8 Código bruto + label, nunca label destrutivo

Para variáveis categóricas importantes, preferir representação lógica que preserve ambos:

```text
SEXO_raw     = "1"
SEXO_label   = "Masculino"
```

ou metadata equivalente sem materializar duas colunas quando a engine suportar dictionary encoding.

O objetivo é que:

- exportação bruta continue possível;
- comparação com documentação oficial continue possível;
- label seja reversível;
- códigos novos/desconhecidos não desapareçam.

UI deve permitir alternar **Código / Rótulo / Código + rótulo**.

## 4.9 Códigos sentinela e “Ignorado”

O processor pode reconhecer que determinado sistema/documentação usa códigos sentinela, porém **não deve silenciosamente convertê-los todos para `NA` analítico**.

Exemplo de metadata:

```ts
{
  rawName: 'SEXO',
  missingCodes: ['9', 'I']
}
```

Na visão preparada:

> O dicionário identifica `9` como “Ignorado”.  
> Tratamento analítico: [Manter categoria] [Tratar como ausente] [Configurar depois]

A escolha final entra no `TransformPipeline`, não fica enterrada no processor.

## 4.10 Datas e idade

Processors devem distinguir:

1. **decodificação física**;
2. **semântica epidemiológica**.

Pode converter `DT_NOTIFIC` de string para data válida quando o formato está documentado. Não pode decidir que essa é “a data correta da incidência” para toda pergunta.

Pode decodificar `NU_IDADE_N` segundo regra documental conhecida e preservar:

- valor bruto;
- unidade;
- magnitude;
- idade derivada;
- warning para unidade desconhecida.

Isso permite depois à auditoria estatística abrir a idade exata sem perder rastreabilidade.

## 4.11 Combinação automática de anos/meses/UF

Ao baixar muitos arquivos, o comportamento esperado é equivalente ao `bind_rows`, mas com contrato mais rigoroso.

Antes de combinar, produzir:

```text
Schema compatibility
──────────────────────────────────
Arquivos                   324
Colunas comuns              87
Colunas em alguns arquivos   6
Mudanças de tipo             2
Novas categorias            11
Falhas de leitura             0
```

### Regras

- colunas ausentes → `null`, nunca deslocamento posicional;
- ordem física de colunas não importa;
- mudança string↔número não é convertida silenciosamente;
- divergência deve identificar quais arquivos/períodos;
- adicionar opcionalmente provenance por linha:
  - `_source_file`;
  - `_source_year`;
  - `_source_month`;
  - `_source_uf`;
- provenance por linha pode ser virtual/dictionary encoded para não explodir memória.

## 4.12 Detecção de schema drift

Esse módulo deve alimentar também a auditoria estatística.

Sinais mínimos:

- coluna apareceu/desapareceu;
- tipo mudou;
- largura/formato mudou;
- domínio categórico mudou;
- código antes inexistente apareceu;
- taxa de missing mudou abruptamente;
- arquivo de um período tem contagem de colunas incompatível.

**Schema drift é diferente de anomalia epidemiológica.** Mostrar em categoria própria:

> Estrutura da fonte mudou em 2018.

e não:

> Número de casos mudou em 2018.

## 4.13 Tabelas auxiliares

Tabelas auxiliares são parte crítica do ecossistema DATASUS e não podem ser tratadas como detalhe.

Contrato:

```ts
export interface AuxiliaryTableBinding {
  id: string;
  version: string;
  sourceUrl: string;
  sourceHash: string;
  validFor: {
    systems: string[];
    fileTypes?: string[];
    periods?: string[];
  };
  join: {
    sourceKey: string[];
    auxiliaryKey: string[];
    cardinality: 'N:1' | '1:1';
  };
}
```

Regras:

- relação automática só quando verificada;
- hash da auxiliar registrado;
- cardinalidade validada;
- unmatched count reportado;
- nunca inferir CNES/município/CID por fuzzy matching automático.

## 4.14 UX: “Dados oficiais”

Fluxo principal:

```text
┌ Dados oficiais ─────────────────────────────┐
│ Sistema        [SIH/SUS                  ▾] │
│ Arquivo        [AIH reduzida (RD)         ▾] │
│ Período        [2008] até [2024]             │
│ Meses          [Todos]                        │
│ UF             [Brasil / selecionar UFs]      │
│                                              │
│ Preparação     (•) Preparado para análise     │
│                ( ) Bruto, como publicado      │
│                                              │
│ [Ver disponibilidade]                         │
└──────────────────────────────────────────────┘
```

Após consultar:

```text
2008–2024 · 27 UFs · 12 meses
5.508 slots solicitados
5.506 disponíveis
2 ausentes

Tamanho remoto estimado: ...
Cache já possui: ...
Novo download: ...

[Ver ausências] [Baixar e abrir]
```

Durante execução:

```text
Descobrindo arquivos   ✓
Baixando               782 / 5.506
Decodificando           764 / 5.506
Preparando              751 / 5.506
Construindo dataset     …
```

Permitir cancelar sem corromper cache já concluído.

## 4.15 Seleção de variáveis

Para sistemas muito largos, o usuário pode selecionar campos de interesse.

Princípios:

- presets: “Todas”, “Mínimo para tabulação”, “Selecionar”;
- busca por nome bruto e label;
- mostrar tipo e descrição;
- dependências do processor entram automaticamente e ficam visíveis;
- nunca omitir uma coluna exigida pela transformação salva sem avisar.

Se o decoder permitir descarte precoce seguro, usar para reduzir memória. Caso contrário, deixar claro que a seleção acontece após decodificação.

## 4.16 Cache local

Cache deve ser conteúdo-endereçado quando possível:

```text
sha256(bytes) → blob
source address → metadata → hash
```

Benefícios:

- mesmo arquivo não baixa duas vezes;
- mudança no servidor fica detectável;
- receita pode verificar se está usando os mesmos bytes;
- reabertura offline.

UI mínima:

```text
Cache DATASUS
Arquivo        Sistema  Período   Tamanho  Hash     Último uso
...
```

Ações:

- reabrir;
- verificar disponibilidade atual;
- remover cache;
- exportar manifesto;
- nunca “limpar cache” junto com excluir projeto sem confirmação distinta.

## 4.17 Raw imutável, prepared derivado

Modelo recomendado:

```text
REMOTE OFFICIAL FILE
        ↓
RAW CACHED BYTES
        ↓ decode
RAW DATASET
        ↓ process_*
PREPARED DATASET
        ↓ TransformPipeline
ANALYTIC VIEW
        ↓
TABULATION / COMPARE / AUDIT
```

Cada seta possui versão e provenance.

Isso evita que um “processador atualizado” faça um projeto antigo mudar de resultado silenciosamente.

## 4.18 Atualização/reexecução

Uma aquisição salva deve ter:

**Verificar atualizações**

O app refaz apenas a descoberta do catálogo e compara o novo manifesto com o salvo usando a infraestrutura já existente de diff.

Mostrar:

```text
Desde a aquisição original:
+ 12 arquivos agora disponíveis
- 0 arquivos removidos
~ 324 arquivos continuam iguais por endereço
? 3 arquivos têm conteúdo/hash diferente após novo download
```

O usuário escolhe:

- manter snapshot antigo;
- baixar atualização como nova versão;
- reexecutar receita em nova versão;
- comparar resultado antigo × novo usando **Módulo de Comparação de Tabelas**.

Nunca sobrescrever silenciosamente um snapshot usado em análise.

## 4.19 Integração com comparação de tabelas

A aquisição deve produzir metadata suficiente para a comparação sugerir alinhamentos **sem fazê-los automaticamente**.

Exemplos de semântica:

```text
Dataset A: SIH-RD
  tempo: ANO_CMPT / MES_CMPT
  território: UF_ZI / MUNIC_RES

Dataset B: SIM-DO
  tempo: DTOBITO → ano derivável
  território: CODMUNRES
```

O app pode dizer:

> Há dimensões possivelmente compatíveis: ano e município.  
> [Configurar comparação]

Mas o usuário confirma:

- qual data de cada fonte;
- município de residência versus ocorrência;
- granularidade;
- denominadores;
- agregação.

Isso é essencial: **semântica parecida não significa população comparável.**

## 4.20 Integração com limpeza manual

Depois do download/preparo:

```text
Abrir base preparada
→ Transformar dados
```

O histórico começa com steps de provenance read-only:

```text
✓ Fonte oficial: SIH-RD
✓ 2008–2024
✓ 5.506 arquivos
✓ processor: sih-rd@1.2.0
────────────────────────────
+ Adicionar transformação
```

Transformações do usuário nunca são misturadas com decisões do processor.

## 4.21 Integração com auditoria estatística

Antes de procurar “estranheza epidemiológica”, o orquestrador recebe diagnósticos da aquisição:

- slots ausentes;
- schema drift;
- arquivo incompleto;
- períodos sem cobertura;
- mudança de processor/dicionário;
- categorias novas de origem.

Assim o motor pode impedir falsos alertas como:

> “queda de 100% em abril”

quando, na verdade, o arquivo de abril não foi obtido.

A ordem lógica é:

```text
INTEGRIDADE DA AQUISIÇÃO
→ INTEGRIDADE DO SCHEMA
→ QUALIDADE/LIMPEZA
→ ESTRANHEZA ESTATÍSTICA
→ INTERPRETAÇÃO
```

## 4.22 Escala: SIH/SIA nacionais e séries longas

Não projetar supondo que todos os dados cabem confortavelmente em RAM.

### P0

- streaming do decoder;
- batches;
- filtro/seleção de colunas tão cedo quanto seguro;
- progresso real;
- cancelamento;
- não duplicar dataset inteiro para preview;
- agregações streaming quando possível.

### P1

Para séries grandes:

- persistência em Parquet/Arrow;
- DuckDB-WASM ou engine colunar equivalente para consultas locais;
- partição por sistema/ano/UF/mês;
- predicate pushdown;
- materializar somente resultado/tabulação quando possível.

DuckDB é implementação possível, não semântica pública. A receita deve continuar descrevendo **o que** foi pedido, não SQL interno.

### 4.22.1 Quando Arrow entra em cena

O usuário não deveria precisar “escolher Arrow” para fazer uma análise normal. Arrow é uma decisão de infraestrutura quando o volume/fluxo deixa de ser confortável em objetos JS materializados.

Regra prática de produto:

- base pequena/média: decoder → batches → análise diretamente;
- base grande/reutilizada várias vezes: representação colunar Arrow/Parquet local;
- consultas repetidas/agregações pesadas: DuckDB-WASM sobre Arrow/Parquet pode ser usado;
- exportação para R/Python: oferecer Arrow/Parquet no futuro quando isso melhorar interoperabilidade.

O manual deve explicar em uma frase: **Arrow entra para mover e consultar dados colunares grandes com menos cópia e melhor desempenho; não muda a definição epidemiológica da análise.**

## 4.23 Resiliência de rede

Downloads do DATASUS são infraestrutura externa e podem falhar.

Implementar:

- timeout explícito;
- retry com backoff limitado;
- retomada quando tecnicamente segura;
- fila com concorrência conservadora;
- checksum após conclusão;
- arquivo parcial nunca marcado como completo;
- erros por slot, não apenas “download falhou” global;
- opção de repetir apenas falhas.

Não martelar o servidor oficial com dezenas de requisições simultâneas.

## 4.24 Exportação compatível com ecossistema

Manter e formalizar:

### CSV “Microdatasus-friendly”

- UTF-8;
- nomes de colunas previsíveis;
- subconjunto exato da visão escolhida;
- opção código/label;
- metadata separada;
- nenhuma alteração oculta de decimal/date.

### Manifesto de reprodução

Junto da exportação:

```text
analysis.csv
analysis.source.json
analysis.recipe.twrecipe
```

Opcionalmente:

```text
analysis.schema.json
```

O manifesto deve tornar possível reconstruir **de onde** veio cada pedaço da base mesmo que o usuário depois analise o CSV em R.

## 4.25 Relação com o pacote `{microdatasus}`

Não copiar cegamente todos os defaults do pacote R. Usá-lo como referência de fluxo e interoperabilidade.

O pacote atual documenta a separação entre:

- `fetch_datasus()` — descobre/baixa/combina;
- `process_*()` — prepara campos específicos do sistema.

Essa separação é arquiteturalmente boa e deve existir também no TabWin Web.

Entretanto:

- a fonte primária de schema do nosso app deve ser documentação/tabelas oficiais e testes versionados;
- comportamento divergente relevante deve ser documentado;
- não prometer equivalência com uma versão específica do R sem goldens próprios;
- quando uma exportação for chamada “Microdatasus”, documentar exatamente o contrato que esse nome significa no produto.

## 4.26 Critérios de aceitação — Microdados DATASUS

### Aquisição

- [ ] sistema/tipo/período/UF selecionáveis.
- [ ] múltiplos anos/meses/UF.
- [ ] disponibilidade verificada antes ou durante aquisição.
- [ ] `require-all` e `allow-partial`.
- [ ] slot ausente nunca vira zero.
- [ ] falha parcial é visível.
- [ ] retry apenas do que falhou.
- [ ] cancelamento seguro.

### Provenance

- [ ] URL/endereço oficial por arquivo.
- [ ] data/hora de coleta.
- [ ] hash do conteúdo.
- [ ] query do catálogo que originou o arquivo.
- [ ] processor + versão.
- [ ] dicionário/schema + versão.
- [ ] manifesto exportável.
- [ ] raw não é sobrescrito.

### Preparação

- [ ] código bruto preservado.
- [ ] labels reversíveis.
- [ ] sentinel/missing não é decisão analítica silenciosa.
- [ ] tipos não mudam silenciosamente.
- [ ] schema drift reportado.
- [ ] auxiliary join valida cardinalidade.
- [ ] processador não filtra casos.
- [ ] processador não deduplica pessoas.

### Combinação

- [ ] union por nome, não posição.
- [ ] coluna ausente vira null com diagnóstico.
- [ ] mudança de tipo tem warning/erro explícito.
- [ ] origem por arquivo/período recuperável.
- [ ] contagem de linhas por arquivo verificável.

### Escala

- [ ] streaming onde possível.
- [ ] nenhum preview copia toda a base.
- [ ] UI continua responsiva.
- [ ] séries grandes têm caminho colunar P1.
- [ ] limites de memória produzem mensagem útil, não crash silencioso.

### Integração

- [ ] dataset adquirido abre diretamente em Transformar.
- [ ] dataset adquirido pode ser A/B em Comparar.
- [ ] auditoria conhece lacunas/schema drift antes de detectar anomalias.
- [ ] receita reexecuta aquisição + transformação.
- [ ] atualização cria nova versão/snapshot, não sobrescreve análise anterior.

## 4.27 Testes obrigatórios — Microdados DATASUS

### Unitários

- expansão determinística de seleção ano/mês/UF;
- anual ignora mês com warning correto;
- BR versus UF;
- slot disponível/ausente;
- parse/serialize de manifesto;
- diff de manifesto;
- hash estável;
- processor escolhe schema pela versão/período;
- código desconhecido é preservado;
- sentinel é marcado mas não descartado;
- union de schemas;
- mudança de tipo;
- auxiliary join 1:1/N:1;
- N:N bloqueado.

### Integração com fixtures locais

Não depender do DATASUS ao rodar `npm test`.

Criar arquivos pequenos representativos:

```text
fixtures/datasus/
  sim-do/
    2023_sample.dbc
    expected_raw.json
    expected_prepared.json
  sih-rd/
    2024_sample.dbc
    expected_raw.json
    expected_prepared.json
  schema-drift/
    year_a.dbf
    year_b.dbf
```

### E2E de rede separado

Teste opcional/manual/CI específica:

1. consultar um slot oficial pequeno;
2. salvar manifesto;
3. baixar;
4. verificar hash;
5. abrir offline a partir do cache;
6. repetir descoberta;
7. comparar manifestos.

Não tornar a suite normal dependente da disponibilidade momentânea do DATASUS.

## 4.28 Pré-implementação recomendada para o próximo agente

Como o repo atual já possui `datasus.ts`, a pré-implementação **não deve duplicar fetch/discovery**.

Primeiro patch recomendado:

```text
packages/acquisition/src/
  datasus-schema-registry.ts
  datasus-processing.ts

tests/
  datasus-processing.test.mjs
```

P0 do `datasus-processing.ts`:

1. interface `DatasusProcessor`;
2. `processorRegistry`;
3. preservação raw + label;
4. normalizadores de código/data reutilizáveis;
5. warning de código desconhecido;
6. schema drift report;
7. primeiro processor real pequeno e bem testado;
8. depois expandir sistema por sistema.

A implementação deve começar por **um sistema com golden documental forte**, e não por dez processadores incompletos.

---

# 5. Módulo A — Transformação e limpeza manual

## 5.1 Objetivo

Permitir que o usuário faça pela interface o trabalho comum de preparação que hoje exigiria `dplyr`, pandas ou Excel, mantendo o pipeline legível como português e reproduzível como receita.

## 5.2 Contrato de transformação

Adicionar um plano serializável, conceitualmente:

```ts
export interface TransformPipeline {
  version: 1;
  sourceFingerprint: string;
  steps: TransformStep[];
}

export type TransformStep =
  | SelectColumnsStep
  | FilterRowsStep
  | DeriveColumnStep
  | RecodeStep
  | MissingValuePolicyStep
  | CastTypeStep
  | DatePartStep
  | TextNormalizeStep
  | CodeNormalizeStep
  | DeduplicateStep
  | BindRowsStep
  | JoinDatasetStep
  | GroupSummarizeStep
  | SortStep;
```

Cada etapa deve carregar:

- `id` estável;
- `createdAt` opcional no log, não na semântica;
- configuração completa;
- entrada e saída de contagens;
- warnings;
- preview/diff quando aplicável;
- enabled/disabled para permitir comparação de sensibilidade.

## 5.3 Operações mínimas

### Seleção

- selecionar/remover colunas;
- renomear;
- reordenar.

Equivalente mental: `select()`.

### Filtro de registros

Construtor visual com grupos `AND`/`OR`:

- igual/diferente;
- contém/não contém;
- começa/termina com;
- pertence a lista;
- faixa numérica;
- data antes/depois/entre;
- ausente/não ausente.

Equivalente mental: `filter()`.

### Criar ou alterar variável

- fórmula;
- condicional;
- constante;
- recodificação;
- extração de texto/data.

Equivalente mental: `mutate()`.

### Recodificação/de-para

Suportar:

- valor → valor;
- muitos valores → categoria;
- faixa → categoria;
- regex/prefixo → categoria;
- default explícito: manter / ausente / outra categoria.

O preview deve mostrar contagens antes/depois.

### Ausentes

Separar conceitualmente:

- `null`/vazio técnico;
- códigos sentinela (`9`, `99`, `999`, `I`, “Ignorado”);
- categoria legítima “Não se aplica”.

O sistema **não deve universalizar** que “Ignorado” é NA. Deve permitir configurar por variável e registrar a decisão.

### Tipos

- texto → número;
- texto → data;
- número → texto;
- categorização;
- falha de conversão reportada com N e exemplos.

### Datas

- ano, mês, dia;
- trimestre;
- semana epidemiológica;
- diferença entre datas;
- idade em uma data;
- validação de ordem temporal.

### Texto e códigos

- trim;
- caixa;
- remoção/substituição;
- substring;
- pad left/right;
- normalização de código IBGE;
- opcionalmente validadores de CNS/CNPJ quando metodologicamente consolidados.

### Duplicatas

- detectar por conjunto de chaves escolhido;
- listar grupos duplicados;
- nunca assumir que linhas públicas idênticas = mesma pessoa;
- deduplicação só após política explícita;
- opções de manter primeiro/último só se houver ordenação determinística escolhida.

### Empilhar bases

`bind_rows/rbind`:

- união de colunas;
- diagnóstico de colunas ausentes;
- conversão de tipos nunca silenciosa;
- coluna opcional `FONTE_ORIGEM`.

### Join de microdados

Diferente da comparação de tabelas agregadas. Deve suportar `inner/left/right/full`, mas exigir chave explícita e diagnóstico de cardinalidade:

- 1:1;
- 1:N;
- N:1;
- N:N — bloquear por default e exigir confirmação.

### Agrupar/resumir

- count;
- sum;
- mean;
- median;
- min/max;
- proporção;
- N distintos;
- mais tarde percentis.

Equivalente mental: `group_by() + summarise()`.

## 5.4 Histórico visual

A interface deve mostrar algo como:

```text
Fonte: SINAN 2023–2025
  ↓ Padronizar código IBGE para 6 dígitos
  ↓ Extrair ano_notif de dt_notificacao
  ↓ Recodificar sexo: Ignorado → ausente analítico
  ↓ Filtrar classificação = confirmado
  ↓ Agrupar por região + ano
  ↓ Resumir: N e proporção
```

Cada etapa:

- editar;
- desativar;
- duplicar;
- remover;
- ver diff;
- ver registros afetados.

Esse histórico deve ser parte da `.twrecipe`.

## 5.5 Preview e diff — requisito central, não detalhe de UI

Toda transformação capaz de alterar valores ou cardinalidade deve oferecer **antes de aplicar** um resumo determinístico. Não depender da IA para isso.

Exemplo de padronização de código:

```text
Padronizar municipio_ibge
Regra: texto de 6 dígitos, completar à esquerda com "0"

ANTES        DEPOIS
11001        011001
530010       530010

Linhas examinadas:       31.090
Linhas alteradas:         2.844
Falhas de conversão:          3
Valores distintos antes:  5.571
Valores distintos depois: 5.570
Possíveis colisões:           1  ← exigir inspeção
```

Exemplo de missing:

```text
Recodificar evolucao = "Ignorado" como ausente analítico

Registros afetados: 1.842 / 31.090 (5,92%)
Valor bruto preservado: sim
Contagem de ignorados preservada para relatório: sim
Impacto no próximo cálculo: 1.842 linhas não entram no denominador válido
```

### Diff mínimo por tipo de etapa

- filtro: N antes, N depois, N removido + distribuição dos removidos quando útil;
- recode: tabela de-para + N por transformação + colisões;
- cast: N sucesso, N falha, exemplos de falha;
- join: cardinalidade, matched/unmatched, expansão de linhas;
- deduplicação: grupos, N removido, critério de retenção;
- derive: N calculado, N ausente, N não-finito/erro;
- group/summarise: N de entrada, número de grupos e medidas criadas.

Nenhuma etapa deve ter apenas um botão genérico “Aplicar” sem explicar seu impacto.

## 5.6 “Ver código equivalente” — recurso pedagógico, não runtime

Cada `TransformStep` pode possuir renderizadores opcionais para R (`dplyr`) e Python (`pandas`). O código é **derivado do plano interno** e serve para ensino, revisão e portabilidade. A fonte da verdade continua sendo o contrato do TabWin Web.

Exemplo:

```text
Operação visual
Filtrar CLASSI_FIN = 1
```

Pode renderizar:

```r
base |> dplyr::filter(CLASSI_FIN == 1)
```

```python
base = base.loc[base["CLASSI_FIN"] == 1]
```

Requisitos:

- [ ] código representa exatamente a operação visual;
- [ ] não gerar chamada fictícia quando não há equivalência segura;
- [ ] avisar quando semantics do TabWin Web diferirem de R/pandas;
- [ ] permitir copiar o pipeline inteiro;
- [ ] não executar código arbitrário gerado por IA no navegador.

Isso conecta diretamente o produto ao ensino de epidemiologia computacional: o usuário pode começar sem código e aprender gradualmente o equivalente reprodutível.

## 5.7 Reexecutar pipeline em dados novos

Uma limpeza não deve morrer junto com o arquivo de 2026. Se o source contract for compatível, o usuário deve conseguir aplicar o mesmo pipeline a outra aquisição/período.

Fluxo:

```text
Projeto 2026
  ↓ salvar TransformPipeline
Adicionar 2027
  ↓ verificar schema
  ↓ mostrar mudanças de domínio/schema
  ↓ reexecutar passos compatíveis
  ↓ interromper em passo incompatível
  ↓ usuário revisa
```

Nunca “forçar” uma receita antiga sobre schema diferente. O sistema deve detectar drift e apontar exatamente qual etapa deixou de ser aplicável.

---

# 6. Módulo B — Fórmulas estilo Excel, sem virar Excel

## 6.1 Decisão

Expandir `table-expression.ts` para uma gramática com chamadas de função. Continuar usando nomes semânticos de coluna, não referências A1/B2.

```text
=([Óbitos] / [População]) * 100000
=IF([Casos] < 5, 0, [Casos])
=ROUND([Taxa], 2)
=IFERROR([Óbitos] / [Internações], NA())
```

## 6.2 Funções P0

A primeira versão deve cobrir o subconjunto que pessoas realmente usam para análise epidemiológica/tabular, incluindo funções familiares do Excel que não existiam na lista anterior.

### Agregação/contagem

- `SUM`
- `AVERAGE` / alias `MEAN`
- `MEDIAN`
- `MIN`
- `MAX`
- `COUNT`
- `COUNTA`
- `COUNTIF`

`SUM/AVERAGE/MEDIAN/COUNT` precisam ter semântica clara: em uma fórmula por linha, não podem fingir receber um range A1:A20. Devem operar sobre contexto explicitamente definido (coluna/grupo/tabela) ou permanecer disponíveis apenas no construtor de agregação. **Não copiar a ambiguidade de planilha.**

### Matemática

- `ABS`
- `ROUND`
- `ROUNDUP`
- `ROUNDDOWN`
- `TRUNC`
- `INT`
- `FLOOR`
- `CEILING`
- `SQRT`
- `POWER`
- `EXP`
- `LN`
- `LOG`
- `LOG10`
- `MIN`
- `MAX`

### Lógica e validação

- `IF`
- `IFS`
- `AND`
- `OR`
- `NOT`
- `IFERROR`
- `ISNUMBER`
- `ISBLANK`
- `NA()`

### Epidemiologia/analítica

- `RATE(eventos, populacao, base)`
- `PERCENT(parte, total)`
- `RATIO(a, b)`
- `CHANGE(atual, anterior)`
- `PCTCHANGE(atual, anterior)`
- `LAG(coluna, n)` — somente quando a tabela possuir ordenação explícita
- `ZSCORE(coluna)` — documentar população de referência
- `INDEXBASE(valor, baseline)` — ou operação equivalente para séries com base = 100

### Exemplos que o parser precisa aceitar

```text
=RATE([Óbitos], [População], 100000)
=IF([Casos] < 5, NA(), [Casos])
=ROUND([Taxa], 2)
=IFERROR([Óbitos] / [Internações], NA())
=PCTCHANGE([Taxa], LAG([Taxa], 1))
```

### Semântica de ausentes

- função matemática com argumento ausente → ausente, salvo função documentada em contrário;
- `IFERROR` captura erro de cálculo, não deve transformar missing legítimo em zero sem o usuário pedir;
- `COUNT` e `COUNTA` devem documentar se sentinelas já foram recodificadas como missing no pipeline;
- nenhuma função deve tratar string `"Ignorado"` como ausente por mágica.

## 6.3 Funções que não entram agora

- VBA/macros;
- referências por célula;
- funções financeiras;
- `VLOOKUP/XLOOKUP` como substituto de join (o produto deve ter join explícito e auditável).

## 6.4 Registro de funções

Implementar registry, não `switch` gigante:

```ts
interface FormulaFunctionDefinition {
  name: string;
  aliases?: string[];
  minArgs: number;
  maxArgs: number;
  evaluate(args: number[], context: FormulaContext): number;
  description: string;
  category: 'math' | 'logic' | 'epi' | 'window';
}
```

Isso permite autocomplete na UI e documentação automática.

## 6.5 Editor `fx`

A UI final deve ter um editor de fórmula próprio, não um `prompt()` ou caixa de texto crua.

Requisitos:

- autocomplete de funções;
- autocomplete de colunas com `[` `]`;
- assinatura/descrição da função;
- validação enquanto digita;
- preview das primeiras linhas;
- contador de erros/ausentes gerados;
- ajuda contextual com exemplo;
- botão “Inserir coluna”;
- nomes de coluna continuam semânticos mesmo se a posição mudar.

Fluxo esperado:

```text
fx  Criar coluna
Nome: Taxa por 100 mil
Fórmula: =RATE([Óbitos], [População], 100000)

Preview
2019  12,43
2020  13,10
2021  NA   ← população ausente

[Aplicar]
```

## 6.6 Parser/AST — pré-requisito de engenharia

Não avaliar fórmula com `eval()`/`Function()`.

Estender o AST de `table-expression.ts` com nós explícitos:

```ts
type ExprNode =
  | NumberLiteral
  | ColumnReference
  | UnaryExpression
  | BinaryExpression
  | FunctionCallExpression;

interface FunctionCallExpression {
  type: 'call';
  name: string;
  args: ExprNode[];
}
```

O registry resolve nome, aridade e avaliação. A receita salva a expressão textual e, quando necessário, uma versão normalizada/AST versionado.

## 6.7 Testes obrigatórios de fórmula

- precedência e parênteses;
- função aninhada;
- coluna com acento/espaço;
- divisão por zero;
- `IFERROR`;
- missing;
- log de zero/negativo;
- `LAG` sem ordenação deve falhar;
- rename de coluna referenciada;
- serialização/reexecução da fórmula;
- resultados idênticos em memória e batch/streaming quando a função permitir.

---

# 7. Módulo C — Comparação de tabelas

## 7.1 Problema que o módulo resolve

Hoje `include-table` só funciona quando as linhas já correspondem exatamente. Pesquisa real frequentemente exige:

- tabela A e B com períodos parcialmente sobrepostos;
- municípios presentes em uma e ausentes na outra;
- chaves equivalentes com labels diferentes;
- subconjunto versus total/restante;
- mesma dimensão com medidas diferentes;
- fontes distintas que precisam ser colocadas lado a lado;
- diagnóstico de desalinhamento antes de qualquer razão/diferença.

A comparação deve tornar explícito tudo que hoje seria um `merge/join + mutate + conferência manual`.

## 7.2 Fontes permitidas

Comparar:

- tabela ativa × outra tabela salva;
- `.twtable` × `.twtable`;
- resultado A × resultado B da sessão;
- subconjunto × referência;
- período × período;
- fonte oficial × fonte externa importada;
- qualquer par representável como tabela agregada.

## 7.3 Plano persistível

A pré-implementação já define:

```ts
interface TableComparisonPlan {
  version: 1;
  leftLabel: string;
  rightLabel: string;
  join: 'inner' | 'left' | 'right' | 'full';
  rowMatch: 'key' | 'normalized-label' | 'explicit-map';
  requireMatchingLabelsWhenKeyMatches?: boolean;
  explicitRowMappings?: ExplicitRowMapping[];
  columnPairs: ColumnPairSpec[];
  relativeDifferenceDenominator?: 'left' | 'right';
}
```

Esse plano deve entrar em receita/auditoria.

## 7.4 Matching de linhas

### Default obrigatório: chave exata

Se `row.key` corresponde, alinhar.

### Sugestão por label

A UI pode sugerir correspondência por label normalizado, mas nunca aplicar silenciosamente.

Mostrar:

```text
Possível correspondência
5300108 — Brasília
↔
530010 — Brasília

[Confirmar mapeamento] [Não corresponder]
```

### Mapeamento explícito

Usuário pode construir uma tabela de equivalência.

### Duplicidade

Duplicata da chave de comparação = erro. Não agregar automaticamente.

## 7.5 Join

UI em português:

- **Somente correspondentes** (`inner`)
- **Manter tudo de A** (`left`)
- **Manter tudo de B** (`right`)
- **Manter tudo de ambas** (`full`)

O termo técnico pode aparecer na ajuda.

## 7.6 Diagnóstico obrigatório antes do resultado

Exemplo de painel:

```text
Compatibilidade da comparação
A: 5.570 linhas
B: 5.565 linhas
Correspondentes: 5.552
Somente A: 18
Somente B: 13
Cobertura A: 99,68%
Cobertura B: 99,77%
Labels divergentes em chaves iguais: 4
Chaves duplicadas: 0
```

O usuário deve conseguir clicar nos não correspondentes.

## 7.7 Métricas por par de colunas

Para cada medida A/B:

- valor A;
- valor B;
- `B - A`;
- diferença absoluta;
- diferença relativa `%` com denominador declarado;
- razão `B/A`;
- opcionalmente índice `A = 100` ou `B = 100`;
- log-ratio quando ambos positivos.

**Divisão por zero:** resultado `NA/null`, nunca zero inventado.

## 7.8 Resumo da comparação

Quando unidades forem comparáveis:

- MAE;
- RMSE;
- MAPE, omitido onde A=0;
- Pearson;
- Spearman em fase posterior;
- concordância/ICC somente quando metodologicamente justificado.

Correlação alta não significa concordância. A UI deve dizer isso.

## 7.9 Granularidade

Se A está por município e B por UF, bloquear a comparação célula a célula e oferecer:

- agregar A para UF;
- abrir B para município se possível;
- escolher outra chave.

Não realizar “matching inteligente” destrutivo.

## 7.10 Comparação de subconjunto contra referência

Atalho importante:

```text
Comparar
  A = filtro atual
  B = restante dos registros
```

ou

```text
A = hospital selecionado
B = todos os demais hospitais
```

Isso transforma análises de influência/concentração em fluxo normal da ferramenta.

## 7.11 Saída

Três modos:

1. **Tabela lado a lado**;
2. **Diferenças/razões**;
3. **Diagnóstico estatístico**, que envia o par para o módulo de auditoria.

O resultado deve ser exportável como CSV/XLSX/JSON e salvar o plano de alinhamento.

## 7.12 Comparação longitudinal — operações que devem existir sem planilha externa

Quando a chave possui ordenação temporal explícita (`ano`, `competência`, `mês` etc.), a comparação deve oferecer, por série:

- diferença absoluta;
- razão;
- variação percentual;
- `lag` configurável;
- índice com primeiro período = 100;
- normalização por denominador externo (por 1.000, 10.000, 100.000 etc.);
- correlação entre séries;
- diferença de tendência;
- detecção de períodos de maior divergência;
- opcionalmente regressão de tendência por lado.

Exemplo de fluxo que deve ser possível sem exportação:

```text
SIH — internações B57 por ano
      ×
SIM — óbitos B57 por ano
      ↓
Alinhar ANO
      ↓
Adicionar população/denominadores, se aplicável
      ↓
Taxa por 100 mil
      ↓
Índice 2008 = 100
      ↓
Comparar trajetória / razão / diferença
      ↓
Enviar divergências para auditoria
```

O produto deve avisar que contagem de internações e contagem de óbitos são **medidas diferentes**; colocá-las lado a lado é permitido, mas não torna os números diretamente intercambiáveis.

## 7.13 Alinhamento semântico entre fontes diferentes

Sugestões de correspondência podem usar nome, metadado e schema registry, porém toda decisão que altere o significado da comparação precisa de confirmação humana.

Exemplos de ambiguidades que a UI deve revelar:

```text
SIH: ANO_CMPT
SIM: ano(DTOBITO)
→ ambos são temporais, mas representam eventos diferentes
```

```text
SIH: MUNIC_RES
SIM: CODMUNRES
→ possível dimensão: município de residência
```

```text
SIH: UF_ZI
SIM: UF de ocorrência
→ NÃO tratar como equivalente apenas porque ambos têm UF
```

A sugestão deve apresentar:

- campo A;
- campo B;
- label/metadado de ambos;
- transformações necessárias;
- confiança apenas como ajuda de UI;
- botão confirmar/rejeitar.

Nunca fazer join “inteligente” escondido.

## 7.14 Provenance por coluna comparada

Toda coluna de saída derivada da comparação deve saber:

- tabela/source fingerprint A;
- tabela/source fingerprint B;
- measure A/B;
- chave de alinhamento;
- transformação/normalização;
- denominador;
- política de unmatched;
- fórmula da métrica derivada.

Ao exportar uma tabela comparativa, incluir manifesto ou metadata lateral capaz de reconstruir isso.

## 7.15 N-way — extensão posterior sem comprometer o P0

P0 compara dois lados por vez porque isso torna alinhamento e diagnóstico auditáveis. P1 pode permitir 3+ tabelas como matriz/painel, mas internamente deve decompor a operação em contratos pareados ou um `MultiTableComparisonPlan` explícito. Não lançar uma grade de 5 fontes sem provenance ou diagnóstico de cobertura.

---

# 8. Módulo D — Auditoria estatística automática de estranheza

## 8.1 Objetivo preciso

Responder automaticamente perguntas como:

- Existem valores extremos que não seguem a distribuição da variável?
- Alguma categoria é rara de forma relevante?
- Um subconjunto tem distribuição temporal/geográfica diferente do restante?
- Houve salto ou quebra na série?
- A ausência de informação mudou de repente?
- Uma categoria clínica aparentemente estranha é específica do grupo ou aparece de forma semelhante em toda a base?
- Uma combinação de campos é muito menos frequente do que seria esperado?
- Um sinal está concentrado em um município/UF/estabelecimento ou é difuso?
- Uma tabela/subgrupo difere estatisticamente de sua referência?

O motor **não precisa conhecer sífilis, gestação, internação ou qualquer paper** para responder isso. Ele recebe variáveis, estruturas e grupos e procura padrões.

## 8.2 Separar três conceitos

### A. Anomalia estatística

Padrão improvável/incomum sob um modelo ou referência estatística.

### B. Inconsistência lógica

Regra declarada pelo usuário envolvendo campos. Já representada por `CrossFieldRuleSpec`.

### C. Valor impossível por domínio

Exige conhecimento externo/preset documentado. Não deve nascer do detector estatístico.

Os três podem apontar para os mesmos registros, mas são evidências diferentes e devem aparecer separadamente.

---

## 8.3 Modelo de saída

A pré-implementação define:

```ts
interface StatisticalSignal {
  id: string;
  kind:
    | 'numeric-outlier'
    | 'temporal-outlier'
    | 'rare-category'
    | 'distribution-shift'
    | 'subgroup-divergence'
    | 'geographic-concentration'
    | 'missingness-shift';
  severity: 'info' | 'review' | 'strong';
  score: number;        // força da evidência, NÃO probabilidade de erro
  fields: string[];
  label: string;
  explanation: string;
  evidence: StatisticalEvidence[];
  automaticAction: 'none';
}
```

O score é somente uma ordenação de revisão. **Nunca mostrar “87% de chance de ser erro”.**

---

# 9. Detectores estatísticos — especificação

## 9.1 Detector numérico robusto

### Métodos

Executar em paralelo:

1. cercas de Tukey: `Q1 - 1,5*IQR`, `Q3 + 1,5*IQR`;
2. modified z-score baseado em MAD:

```text
z_robusto = 0,67448975 * (x - mediana) / MAD
```

Default para revisão: `|z_robusto| >= 3,5`.

Se MAD=0, usar escala robusta via `IQR / 1,349`. Se ambos zero, não fabricar score.

### Por que os dois

IQR é simples e já existe no projeto. MAD é mais resistente quando há caudas ou muitos extremos. Concordância entre ambos aumenta a força do sinal.

### Saída

- valor;
- posição/registro;
- mediana;
- IQR;
- MAD;
- z robusto;
- distância da cerca;
- N afetado;
- distribuição por tempo/local opcional.

### Não fazer

Não remover outliers automaticamente e não usar z-score clássico como único método em dados claramente assimétricos.

---

## 9.2 Detector temporal robusto

### P0: Hampel local

Para séries de contagem não negativas, default `log1p(count)` para reduzir dominância de escala.

Janela recomendada inicial: ±3 períodos. Limiar: `|z robusto| >= 3,5`.

Ele detecta:

- pico;
- queda abrupta;
- valor isolado incompatível com vizinhança.

### P1: mudança de regime

Adicionar depois:

- CUSUM;
- change-point por custo robusto;
- Poisson/NegBin quando a variável é contagem e houver exposição/offset;
- regressão segmentada quando o usuário escolher um ponto conhecido de mudança.

Nunca executar automaticamente regressão segmentada escolhendo o breakpoint que “dá melhor resultado” sem explicitar seleção e penalização.

### Saída

- período;
- observado;
- mediana local/esperado;
- desvio robusto;
- magnitude relativa;
- persistência após o ponto;
- “isolado” versus “novo patamar”.

---

## 9.3 Detector de raridade categórica

Raridade sozinha **não é erro**. O motor pode ranquear categorias por:

- N;
- share;
- `-log10(share)` como medida de surpresa descritiva;
- número de períodos presentes;
- número de territórios presentes.

Mas uma categoria rara só sobe de severidade se houver **evidência adicional**, como:

- concentração extrema;
- aparecimento súbito;
- associação cross-field forte;
- divergência em relação ao grupo de referência.

Isso evita marcar automaticamente doenças raras, municípios pequenos ou categorias legítimas como “problema”.

---

## 9.4 Detector de distribuição diferente

Este é um dos componentes principais.

Dado um grupo A e referência B, comparar a distribuição de qualquer variável categórica ou discretizada.

### Métricas P0

- Jensen–Shannon divergence (JSD), base 2, entre 0 e 1;
- total variation distance (TVD), entre 0 e 1;
- maior diferença absoluta de share;
- `log2(lift)` por categoria.

A pré-implementação já calcula as quatro.

### Interpretação

JSD/TVD são tamanhos de efeito distribucionais. Não dependem de N enorme para “ficar significantes”.

### Inferência P1

Acrescentar:

- qui-quadrado;
- Fisher quando células pequenas;
- resíduos padronizados por célula;
- Cramér's V;
- ajuste Benjamini–Hochberg ao vasculhar muitas categorias.

**Se p/q é pequeno e efeito é minúsculo, mostrar como informação, não “forte”.**

---

## 9.5 Detector de concentração geográfica

Não existe “concentração estranha” apenas porque um grupo tem muitos registros em São Paulo. É preciso comparar com o padrão de referência.

Para grupo A e base/referência B, calcular:

- share da maior unidade;
- HHI (`sum(p_i²)`);
- entropia normalizada;
- JSD A × B;
- TVD A × B;
- cobertura: N de UFs/municípios/estabelecimentos com registro;
- persistência territorial no tempo.

Um sinal forte deve exigir diferença **relativa à distribuição de referência**, não apenas HHI alto.

Exemplo genérico de interpretação:

```text
Grupo investigado aparece em 4 municípios e 90% está em um único território.
Na base de referência, o mesmo campo está distribuído em 741 municípios.
JSD = ...; TVD = ...
→ forte concentração relativa; revisar origem/codificação/local de notificação.
```

O texto não declara fraude ou erro.

---

## 9.6 Detector de persistência e difusão

Para grupos raros, produzir uma “assinatura” com:

- N total;
- anos/períodos com ocorrência;
- proporção dos períodos disponíveis;
- UFs com ocorrência;
- municípios com ocorrência;
- top-1/top-5 shares;
- entropia/HHI;
- completude de campos escolhidos.

Essa assinatura é comparável entre grupos.

É um mecanismo generalizável para distinguir:

- evento raro, persistente e difuso;
- erro concentrado em um local/período;
- mudança sistêmica presente em toda a base;
- problema de preenchimento específico de um subconjunto.

---

## 9.7 Detector de divergência de proporção

Para uma categoria binária ou “categoria X versus restante”:

Calcular:

- proporção A e B;
- IC95% de Wilson;
- diferença absoluta de risco;
- razão de riscos;
- odds ratio quando definida;
- teste de duas proporções / Fisher conforme N;
- q-value quando múltiplas comparações.

A pré-implementação já contém Wilson, risk difference, RR, OR e p de triagem por duas proporções.

### Regra de severidade

P-valor sozinho não aumenta para `strong`. Exigir efeito.

Sugestão P1: usar **Cohen's h** como gate genérico para proporções:

```text
h = 2*asin(sqrt(p1)) - 2*asin(sqrt(p2))
```

Mostrar h, não esconder o critério.

---

## 9.8 Detector de completude/missingness

Ausência é uma variável analítica.

Para cada campo:

- taxa global de missing;
- taxa por ano;
- taxa por território;
- taxa por grupo;
- mudança abrupta;
- comparação A × referência;
- IC e diferença de proporção.

Distinguir:

- vazio técnico;
- código sentinela tratado como ausente;
- “não se aplica”.

A escolha da política de missing vem do pipeline de limpeza e deve estar registrada.

---

## 9.9 Detector de associação cross-field automática

Hoje o projeto consegue contar combinações raras e o usuário cria regra. A evolução estatística deve procurar **associações inesperadas** entre campos, sem semântica clínica.

P1:

- contingency table para pares categóricos de cardinalidade limitada;
- qui-quadrado/Fisher;
- Cramér's V;
- resíduos padronizados por célula;
- lift observado/esperado;
- BH sobre o conjunto de células/pares.

Exemplo abstrato:

```text
Campo A = categoria 3 e Campo B = categoria X
observado: 412
esperado sob independência: 61
lift: 6,75x
resíduo padronizado: ...
q: ...
```

A saída é “associação incomum”, não “combinação impossível”.

### Controle de explosão combinatória

Não testar automaticamente todos os pares de milhares de campos/categorias.

Aplicar:

- limite de cardinalidade;
- mínimo de N;
- seleção do usuário ou shortlist por perfil;
- orçamento máximo de testes;
- mostrar quantos testes foram feitos.

---

## 9.10 Detector de mudança de distribuição ao longo do tempo

Para cada ano/período, comparar a distribuição de uma variável com baseline móvel ou período de referência:

- JSD por período;
- TVD;
- mudanças na categoria dominante;
- missingness;
- entropia.

Isso detecta mudança de codificação, definição, formulário ou prática de preenchimento sem precisar saber previamente em que ano houve alteração normativa.

A interpretação final pode depois ser enriquecida com conhecimento externo.

---

## 9.11 Detector de valores discretos suspeitos e arredondamento

Para variáveis numéricas que deveriam ter granularidade contínua ou ampla:

- heaping em múltiplos de 5/10/100;
- excesso de valores específicos;
- mudança de número de casas decimais;
- mudança de comprimento/formato ao longo dos anos.

**Não ligar por default em códigos administrativos**, pois código numérico não é medida quantitativa.

A inferência de “variável medida” versus “código” deve usar metadados/tipo e confirmação do usuário.

---

## 9.12 O que NÃO usar no núcleo automático inicial

### Isolation Forest / modelos opacos

Podem entrar no futuro como detector opcional exploratório, mas não são P0. Um produto de auditoria científica deve começar por métodos transparentes e reproduzíveis.

### Benford genérico

Não aplicar por default a dados de saúde. Muitas variáveis legítimas não satisfazem as condições do método.

### Imputação automática

Continua fora do fluxo de “limpeza”.

### Presets clínicos sem fonte

Continuam proibidos.

---

# 10. Orquestrador de auditoria

Criar `anomaly-orchestrator.ts` para executar detectores sem misturar estatística com UI.

Contrato sugerido:

```ts
interface AuditScanPlan {
  version: 1;
  fields: string[];
  timeField?: string;
  geographyFields?: string[];
  group?: FilterSpec[];
  reference?: 'all-other-records' | FilterSpec[];
  detectors: DetectorConfig[];
  multipleTesting: 'benjamini-hochberg';
}

interface AuditScanResult {
  plan: AuditScanPlan;
  scannedRecords: number;
  signals: StatisticalSignal[];
  diagnostics: {
    testsPerformed: number;
    truncatedSearches: string[];
    warnings: string[];
  };
}
```

## 10.1 Modos de execução

### Rápido

- perfil univariado;
- missingness;
- categorias raras;
- numeric robust;
- séries apenas se timeField escolhido.

### Completo

- distribuições A/B;
- geografia;
- tempo;
- cross-field em campos selecionados;
- correção de múltiplos testes.

### Focado

Usuário seleciona um grupo/categoria e pede “Investigar este sinal”.

Esse modo deve produzir a assinatura mais rica e é o caminho para pesquisa exploratória.

---

# 11. Score de estranheza

## 11.1 Não é probabilidade

O score 0–100 só ordena a fila de revisão.

Mostrar explicitamente:

> “Score de revisão: combinação ponderada de tamanhos de efeito. Não representa probabilidade de erro.”

## 11.2 Componentes

Para distribuição, por exemplo:

- JSD;
- TVD;
- maior delta de share;
- concentração relativa;
- persistência;
- robustez temporal.

P-valor/q-value atua como evidência auxiliar, não como componente dominante.

## 11.3 Severidade

- `info`: padrão digno de contexto, sem força suficiente;
- `review`: investigar;
- `strong`: efeito grande e consistente em mais de um critério.

Os limites devem ficar em config e receita.

---

# 12. UI da auditoria

Criar uma área própria **Auditar dados**.

## 12.1 Tela inicial

```text
Auditar dados

Escopo
  ○ Base inteira
  ● Subconjunto atual
  Referência: [restante da base ▼]

Dimensões auxiliares
  Tempo: [ANO_NOTIF ▼]
  Geografia: [UF ▼] [MUNICIPIO ▼]

Detecção
  ☑ Valores numéricos extremos
  ☑ Mudanças temporais
  ☑ Categorias raras
  ☑ Mudança de distribuição
  ☑ Missingness
  ☑ Concentração geográfica
  ☐ Associações entre campos (mais pesado)

[Executar auditoria]
```

## 12.2 Resultado: fila de sinais

Cada card precisa responder **por que** foi marcado.

```text
FORTE · concentração geográfica
Campo/grupo: ...

90,0% dos registros do grupo estão em uma única UF.
Na referência, a maior UF representa 16,2%.
JSD = 0,41 · TVD = 0,57
Ocorrência em 4/5.570 municípios.

[Abrir registros] [Comparar distribuição] [Criar regra] [Adicionar ao relatório]
```

## 12.3 Drill-down

Tabs:

- Distribuição;
- Tempo;
- Geografia;
- Completude;
- Campos associados;
- Registros;
- Método.

“Metodo” mostra fórmula/limiar/N, não apenas nome do teste.

## 12.4 Marcar como esperado

Usuário pode marcar um sinal como esperado no projeto. Isso não apaga o achado; adiciona uma anotação auditável para evitar ruído em reexecuções.

---

# 13. “Explodir agrupamento”

Capacidade importante para auditoria.

Quando uma categoria agregada vem de CNV/faixa:

```text
10–14
[Ver valores originais]
```

Abrir:

```text
10  n=...
11  n=...
12  n=...
13  n=...
14  n=...
```

O mesmo para `80+`, faixas de renda, dias de permanência, etc.

Requisitos:

- nunca alterar a tabela original;
- mostrar se os valores vieram de raw ou conversão;
- permitir “criar nova dimensão exata” para análise;
- registrar a operação.

---

# 14. Integração entre comparação de tabela e auditoria

Esses módulos não devem ser ilhas.

Toda comparação pode oferecer:

**“Investigar diferenças estatisticamente”**.

Fluxo:

```text
Tabela A + Tabela B
  ↓ alinhamento e diagnóstico
  ↓ pares correspondentes
  ↓ diferenças/razões
  ↓ auditoria
      - séries divergentes
      - distribuição diferente
      - linhas extremas
      - cobertura/missing keys
      - concentração dos deltas
```

E toda auditoria focada deve poder gerar uma comparação:

```text
Sinal encontrado
  ↓ Comparar grupo com referência
  ↓ TableComparisonPlan / DistributionComparison
```

---

# 15. Validação metodológica usando casos reais sem hardcode

O paper de sífilis pode ser usado como **fixture de validação**, não como regra embutida.

O artigo analisou 804.888 registros e é útil porque contém **dois tipos diferentes de “estranheza”** que um bom auditor estatístico precisa separar:

1. **extremos etários raros e territorialmente concentrados**, que se comportam como artefatos muito diferentes do grupo de interesse;
2. **uma classificação clínica aparentemente estranha, porém sistematicamente parecida em várias idades**, que aponta mais para problema de classificação/estadiamento do banco do que para peculiaridade exclusiva do subgrupo.

Valores esperados para o fixture de validação, extraídos do estudo:

```text
Base total: 804.888 registros

Idade 0:
  n = 18
  anos com registro = 8
  UF = 1
  município = 1

Idade 10–13:
  n = 2.058
  anos com registro = 19
  UF = 27
  municípios = 741

Idade >=80:
  n = 10
  anos com registro = 7
  UF = 2
  municípios = 4
  9/10 no Rio de Janeiro
  máximo observado = 129 anos

Classificação terciária:
  10–13: 9,3%
  14:    9,2%
  15–19: 8,8%
  20–49: 8,4%
  global 10–49 na figura: ~8,46%
```

A feature **não deve saber que esses números são de sífilis**. O fixture apenas verifica se os métodos gerais de raridade, persistência, dispersão, concentração e comparação proporcional conseguem reproduzir a assinatura que um pesquisador enxergaria manualmente.

O teste do produto deve ser:

> Se fornecermos ao motor os mesmos campos e grupos, ele consegue produzir os componentes estatísticos que levariam um pesquisador a enxergar esses padrões **sem conhecer a conclusão do artigo**?

Fixture ideal:

1. Perfil de idade exata detecta extremos numéricos/raridade.
2. Assinatura geográfica/temporal mostra diferença entre grupo difuso e grupo concentrado.
3. Comparação de proporções mostra quando uma categoria do grupo é semelhante à referência.
4. O motor não rotula nenhum dos dois como “erro”.
5. O usuário consegue transformar um achado em regra explícita se desejar.

Esse fixture é muito mais valioso que codificar “gestante >80 = inválido”, porque testa o mecanismo geral.

---

# 16. Estatística inferencial a adicionar ao `statistics.ts`

Prioridade alinhada à bancada epidemiológica:

## P0/P1

- Wilson IC para proporção;
- RR + IC;
- OR + IC;
- qui-quadrado;
- Fisher exato 2x2;
- Cramér's V;
- Spearman;
- Benjamini–Hochberg;
- Cohen's h;
- diferença padronizada para contínuas/categóricas;
- Poisson para tendência com offset quando denominador disponível.

## P2

- regressão logística múltipla;
- regressão linear múltipla;
- NegBin se sobredispersão for tratada de forma explícita;
- padronização direta/indireta.

Não implementar 40 testes só por completude. O critério é uso epidemiológico e auditabilidade.

---

# 17. Performance

## 17.1 Não materializar tudo quando não precisa

A arquitetura existente já usa accumulators. Os novos detectores devem seguir o mesmo princípio.

### Streaming natural

Podem ser streaming:

- N/missing;
- frequência categórica;
- tabelas de contingência;
- séries agregadas;
- distribuição geográfica;
- comparação de grupos;
- primeira passagem para estatísticas.

### Requer retenção ou segunda passagem

- quantis/MAD exatos;
- alguns detectores multivariados.

Para grandes bases:

- usar DuckDB/columnar cache quando disponível;
- nunca usar amostra silenciosa;
- se amostrar, declarar método, seed e N;
- preferir algoritmo exato ou segunda passagem quando viável.

## 17.2 Orçamento de busca

Auditoria “Completa” deve mostrar:

```text
Campos analisados: 42
Pares cross-field testados: 180
Categorias testadas: 1.842
Testes inferenciais: 2.113
Ajuste: Benjamini–Hochberg
Busca truncada: não
```

Se truncar por limite, dizer exatamente o quê.

---

# 18. Proveniência e reprodução

Todo achado exportado deve conter:

- fingerprints das fontes;
- filtros/subconjunto;
- referência;
- campos;
- versão do detector;
- parâmetros;
- N;
- método estatístico;
- resultado bruto;
- score/severidade;
- data/hora apenas como metadata;
- versão do app.

Formato sugerido:

```ts
interface AuditArtifact {
  version: 1;
  plan: AuditScanPlan;
  signals: StatisticalSignal[];
  sourceFingerprints: SourceFingerprint[];
  engineVersion: string;
}
```

A análise deve poder ser reexecutada sem depender de texto gerado por IA.

---

# 19. Papel da IA

IA é interface auxiliar, não motor de verdade.

Pode:

- explicar um achado;
- sugerir uma transformação;
- sugerir campos para comparar;
- propor regra explícita;
- gerar rótulo amigável;
- ajudar a interpretar documentação.

Não pode:

- alterar dado sem diff;
- inventar limite clínico;
- substituir cálculo estatístico determinístico;
- ocultar parâmetros;
- afirmar causalidade;
- decidir excluir registros.

Se a IA sugerir limpeza:

1. gerar TransformStep determinístico;
2. mostrar diff;
3. usuário aprova;
4. pipeline registra.

---

# 20. Critérios de aceitação — auditoria estatística

A feature **não está pronta** enquanto não cumprir todos:

### Estatística

- [ ] Numeric outlier usa método robusto e mostra método/limiar.
- [ ] Temporal detector não depende de média/desvio clássicos apenas.
- [ ] Distribuição A/B usa pelo menos JSD + TVD.
- [ ] Concentração é comparada contra referência, não julgada isoladamente.
- [ ] Proporções têm IC95%.
- [ ] Múltiplos testes usam correção declarada.
- [ ] P-valor pequeno sem efeito relevante não vira alerta forte.
- [ ] Missingness é analisável como desfecho.
- [ ] Cross-field automático tem limite de cardinalidade e orçamento.

### Segurança metodológica

- [ ] Nenhum detector apaga registros.
- [ ] Nenhum detector contém conhecimento clínico hardcoded.
- [ ] Score nunca é descrito como chance de erro.
- [ ] Sinal pode ser marcado como esperado sem desaparecer do log.
- [ ] Usuário pode abrir os registros que sustentam um achado.

### Reprodução

- [ ] Plano é serializável.
- [ ] Parâmetros aparecem no relatório.
- [ ] Reexecução do mesmo plano/dado produz o mesmo resultado.
- [ ] Limites/truncamentos aparecem como warnings.

### UX

- [ ] Um usuário não estatístico entende por que o sinal apareceu.
- [ ] Um usuário avançado consegue ver os números/método completos.
- [ ] Sinal → filtro/regra/comparação exige poucos cliques.

---

# 21. Critérios de aceitação — comparação de tabelas

- [ ] inner/left/right/full.
- [ ] chave exata como default.
- [ ] matching por label só explícito.
- [ ] mapeamento manual persistível.
- [ ] duplicata de chave falha alto.
- [ ] unmatched rows nunca somem sem diagnóstico.
- [ ] cobertura A/B reportada.
- [ ] labels diferentes em mesma chave reportados.
- [ ] diferença, %, razão e NA em divisão por zero.
- [ ] múltiplos pares de medidas.
- [ ] MAE/RMSE/correlação quando aplicáveis.
- [ ] comparação é exportável.
- [ ] plano entra na receita.
- [ ] “subconjunto versus restante” disponível.
- [ ] integração com auditoria estatística.

---

# 22. Critérios de aceitação — limpeza/transformação

- [ ] raw imutável.
- [ ] pipeline visual.
- [ ] select/filter/mutate/group/summarise/count equivalentes.
- [ ] recode/de-para.
- [ ] política de missing explícita.
- [ ] datas e códigos.
- [ ] deduplicação por chave escolhida.
- [ ] bind rows.
- [ ] join com diagnóstico de cardinalidade.
- [ ] diff por etapa.
- [ ] undo/desativar etapa.
- [ ] pipeline serializável/reexecutável.
- [ ] IA só propõe TransformStep e nunca escreve direto na base.

---

# 23. Testes obrigatórios

## 23.1 Unitários — anomaly

- numeric: cauda extrema;
- numeric: MAD=0;
- numeric: IQR=0;
- numeric: missing/NaN;
- temporal: pico isolado;
- temporal: mudança persistente não confundida com vários outliers independentes;
- JSD igual a zero para distribuições idênticas;
- JSD alto para concentrada versus difusa;
- HHI/entropia;
- Wilson;
- comparação de proporções;
- BH monotônico e limitado [0,1].

## 23.2 Unitários — table comparison

- exact key inner;
- full outer;
- left/right only;
- label mismatch;
- duplicate keys;
- normalized label ambíguo;
- explicit map;
- multiple column pairs;
- zero denominator;
- correlation constant series;
- deterministic row order.

## 23.3 Golden analítico sintético

Criar datasets sintéticos conhecidos:

### `audit_diffuse_vs_concentrated`

- grupo A distribuído em 100 municípios;
- grupo B 95% em um município;
- esperado: forte diferença de concentração, sem “erro”.

### `audit_systematic_category`

- categoria aparentemente estranha em 9% do grupo A;
- referência também ~9%;
- esperado: baixa divergência, conclusão “não específica do grupo”.

### `audit_local_spike`

- série estável com um pico 10x;
- esperado: Hampel marca período.

### `audit_definition_shift`

- distribuição muda de forma persistente após ano X;
- esperado: detector de shift, não apenas outlier isolado.

### `compare_partial_overlap`

- períodos 2010–2020 versus 2015–2025;
- esperado: 6 matches, 5 left-only, 5 right-only.

## 23.4 Caso de validação real

Usar o material de sífilis apenas como teste de generalização. O código não deve conhecer os limiares/idades clinicamente; o fixture fornece os grupos e verifica se as estatísticas reproduzem a assinatura.

---

# 24. Pré-implementação entregue

## 24.1 `statistical-anomaly.ts`

Implementado:

- sumário robusto;
- IQR;
- MAD;
- modified z-score;
- fallback robusto quando MAD=0;
- scanner temporal Hampel;
- JSD;
- TVD;
- log2 lift;
- HHI;
- entropia normalizada;
- Wilson 95%;
- risk difference;
- RR;
- OR;
- p de triagem de duas proporções;
- Benjamini–Hochberg;
- score distribucional explicitamente não probabilístico.

## 24.2 `table-comparison.ts`

Implementado:

- plano v1;
- inner/left/right/full;
- exact key;
- normalized label explícito;
- explicit mapping;
- detecção de chave duplicada;
- label mismatch;
- pares de colunas;
- diferença;
- diferença absoluta;
- diferença relativa;
- razão;
- NA explícito em divisão por zero;
- coverage diagnostics;
- MAE;
- RMSE;
- MAPE;
- Pearson;
- warnings determinísticos.

## 24.3 Testes

Pré-implementação verificada localmente:

```text
8 tests
8 passed
0 failed
```

Isso é **starter code**, não feature integrada. Antes de merge:

1. revisar contratos com `model.ts` atual;
2. decidir exports públicos;
3. integrar `recipe.ts`;
4. conectar ao Worker quando necessário;
5. construir UI;
6. ampliar bateria de testes;
7. rodar `npm run check` no repositório real.

---

# 25. Ordem de implementação recomendada

## R11.A — Fechar “MicrodataSUS dentro do app”

A aquisição básica já existe; não reescrever.

1. formalizar `DatasusAcquisitionPlanV1`;
2. implementar schema registry;
3. implementar primeiro `process_*` real e testado;
4. raw/prepared separados;
5. schema drift;
6. integrar provenance à `.twrecipe`;
7. garantir que aquisição parcial seja conhecida por auditoria;
8. gate de escala/streaming.

**Gate:** aquisição reproduzível sem R/FTP manual, com raw preservado, manifestos e preparação versionada.

## R11.0 — Contratos e núcleo

1. adicionar `statistical-anomaly.ts`;
2. adicionar `table-comparison.ts`;
3. testes;
4. exports;
5. nenhum UI grande ainda.

**Gate:** `npm run check` verde.

## R11.1 — Comparação de tabelas

1. seletor A/B;
2. diagnóstico de chaves;
3. mapping;
4. resultado lado a lado;
5. métricas;
6. export;
7. persistência.

Comparação vem cedo porque também serve de infraestrutura para auditoria A × referência.

## R11.2 — Auditoria estatística P0

1. numeric robust;
2. missingness;
3. temporal Hampel;
4. assinatura de persistência;
5. distribuição A/B;
6. concentração geográfica;
7. cards + drill-down;
8. “criar regra a partir do sinal”.

## R11.3 — Estatística inferencial de auditoria

1. Fisher/chi-square;
2. Cramér's V;
3. Spearman;
4. Cohen's h;
5. BH no orquestrador;
6. resíduos de contingência.

## R11.4 — Transformações manuais

1. pipeline;
2. select/filter/recode/cast/date/text;
3. missing policy;
4. dedup;
5. bind rows;
6. join;
7. group/summarise;
8. preview/diff obrigatório;
9. reexecução contra novos dados com schema check;
10. renderizador opcional de código equivalente R/pandas.

## R11.5 — Fórmulas

1. function AST;
2. registry;
3. operadores e erros normalizados;
4. P0 functions matemáticas/lógicas/agregadoras/epidemiológicas;
5. editor `fx` com autocomplete;
6. preview e diagnóstico de missing/non-finite;
7. documentação gerada do registry.

## R11.6 — Integração e reprodução

1. `.twrecipe`;
2. auditoria/export;
3. reexecução;
4. e2e;
5. fixtures reais e sintéticos.

## Pré-R11 — Faxina estrutural

Antes da grande passada visual:

1. arquivar checkpoints/handoffs históricos conforme §1.2;
2. revisar `TEST_STATUS.md`;
3. preservar memória viva e goldens;
4. corrigir links;
5. rodar `npm run check` + E2E.

## R11.7 — Gate de mapas e apresentação analítica

1. garantir que mapa dinâmico atual não regrediu;
2. integrar resultado de comparação A/B com mapa de delta/razão quando geográfico;
3. integrar sinal territorial da auditoria ao mapa;
4. validar legenda, missing, filtro espacial e export.

## Depois: UI final

A correção visual definitiva deve acontecer **depois** que comparação, auditoria, transformação, fórmulas e seus contratos de mapa tiverem fluxos principais definidos. Caso contrário, a UI será redesenhada duas vezes.

A UI final é acabamento de um modelo já estável, não o momento de decidir a semântica das features.

## Último passo: manual

Depois do freeze visual e dos fluxos E2E, escrever/atualizar o manual descrito no §28 a partir da interface real, evitando screenshots/instruções de telas que ainda vão mudar.

---

# 26. Handoff para Claude/Codex

## Missão

Implementar estes módulos sem degradar COMPAT e sem transformar heurística estatística em regra clínica.

## Restrições

- preservar goldens TabWin;
- alterações novas são `INOVAÇÃO`;
- raw imutável;
- nenhuma exclusão automática;
- matching de tabelas nunca silencioso;
- defaults visíveis;
- p-value com efeito + correção;
- resultados determinísticos;
- browser/local-first;
- evitar dependência pesada sem justificativa.

## Primeiro passo

Copiar os dois arquivos pré-implementados e seus testes para um branch de trabalho. Adaptar apenas o necessário para o repo atual. Rodar `npm run check` antes de tocar UI.

## Perguntas que o agente deve responder no handoff

1. Quais contratos foram adicionados ao core?
2. Qual código é streaming e qual retém valores?
3. Quais thresholds existem e onde são visíveis?
4. Como múltiplos testes são controlados?
5. Como o usuário abre os registros por trás de um sinal?
6. Como o matching A/B é auditado?
7. O que acontece com chaves duplicadas?
8. O que acontece com zero no denominador?
9. A receita reproduz o resultado?
10. Alguma feature pode alterar raw silenciosamente? A resposta deve ser “não”.
11. O fluxo de Dados oficiais usa `datasus.ts` existente ou criou duplicação indevida?
12. Qual processor/schema versionou cada campo preparado?
13. Aquisição parcial pode gerar zero falso? A resposta deve ser “não”.
14. É possível reabrir o raw e reproduzir a preparação?
15. A auditoria sabe diferenciar lacuna de aquisição de queda epidemiológica?

---

# 27. Definição de “bem feito” para esta parte

Esta feature não será considerada completa só porque existe um botão “Encontrar outliers”.

Ela está bem feita quando um pesquisador consegue:

1. abrir uma base grande do SUS;
2. pedir uma auditoria sem fornecer uma hipótese específica;
3. receber uma fila pequena e explicável de padrões estatísticos incomuns;
4. entender se o sinal é numérico, temporal, geográfico, de missingness, de distribuição ou de associação;
5. comparar o grupo com uma referência adequada;
6. ver tamanho de efeito e incerteza, não apenas p-value;
7. abrir os registros que geraram o sinal;
8. transformar um achado em filtro/regra somente se decidir fazê-lo;
9. salvar todo o procedimento em receita;
10. repetir a auditoria em dados novos e verificar se o padrão persiste.

E está especialmente bem feita quando o sistema consegue revelar tanto:

- **um grupo raro que realmente tem assinatura diferente do ruído/erro**, quanto
- **um valor aparentemente absurdo que na verdade é um padrão sistemático da base inteira**.

Esse é o ponto em que o TabWin Web deixa de ser somente uma reimplementação moderna do TabWin e vira uma bancada de investigação epidemiológica auditável.



---

# 28. Manual final do usuário — requisito de produto

O manual não é um README estendido. Ele deve ser escrito para duas populações simultaneamente:

1. pessoa que nunca usou TabWin/R e precisa obter um resultado correto rapidamente;
2. pesquisador/epidemiologista que precisa saber exatamente o que cada operação faz, quais defaults existem e como reproduzir o resultado.

O manual fecha **depois da UI final**, mas sua estrutura deve ser decidida agora para que cada feature exponha metadados suficientes para ser documentável.

## 28.1 Estrutura obrigatória

```text
docs/manual/
  README.md                         # índice
  00_COMECE_EM_5_MINUTOS.md
  01_DADOS_OFICIAIS_DATASUS.md
  02_IMPORTAR_ARQUIVOS.md
  03_TABULAR.md
  04_FILTRAR_E_TRANSFORMAR.md
  05_FORMULAS_E_CALCULOS.md
  06_COMPARAR_TABELAS.md
  07_AUDITAR_DADOS.md
  08_MAPAS_E_GRAFICOS.md
  09_EXPORTAR_E_REPRODUZIR.md
  10_TABWIN_CLASSICO_PARA_WEB.md
  11_ERROS_COMUNS.md
  12_LIMITACOES_E_METODOLOGIA.md
  13_REFERENCIA_DE_FUNCOES.md
  14_REFERENCIA_DE_PROCESSORS_DATASUS.md
```

Pode haver versão única navegável na aplicação, mas os tópicos precisam existir como conteúdo versionável no repo.

## 28.2 “Comece em 5 minutos”

O quickstart deve produzir uma tabulação real sem exigir conhecimento prévio.

Roteiro:

```text
1. Abrir TabWin Web
2. Dados oficiais
3. Escolher sistema + período + território
4. Baixar/abrir
5. Escolher linha, coluna e medida
6. Tabular
7. Aplicar um filtro
8. Salvar/exportar
```

Depois mostrar onde ficam:

- transformar;
- fórmula;
- comparar;
- auditar;
- mapa.

Não despejar teoria antes do primeiro resultado.

## 28.3 “TabWin clássico → TabWin Web”

Tabela de tradução baseada em fluxos, não só nomes de menus:

| No TabWin clássico | No TabWin Web | Observação |
|---|---|---|
| abrir `.DEF`/DBC | Importar / Dados oficiais | indicar compatibilidade validada |
| linha/coluna/conteúdo | Tabular | preservar semântica COMPAT |
| filtro | Filtros | explicar AND/OR |
| operação de tabela | Calcular/Transformar | distinguir compat de inovação |
| mapa | Mapa | explicar seleção espacial → filtro |
| salvar tabela | Exportar `.twtable`/CSV/XLSX | indicar o que preserva provenance |

A tabela deve ser completada com base no TabWin 4.15 realmente validado pelos goldens, sem inventar equivalência.

## 28.4 “Limpeza de dados sem R”

Esta seção deve espelhar o fluxo pedagógico discutido:

```text
select       → escolher colunas
filter       → filtrar registros
mutate       → criar/alterar variável
group_by + summarise → agrupar/resumir
count        → contar categorias
bind_rows    → empilhar arquivos
join         → juntar bases
```

Incluir exemplos de:

- código IBGE e zero à esquerda;
- datas diferentes no mesmo sistema;
- “Ignorado” versus ausência;
- recodificação/de-para;
- schema drift;
- duplicatas;
- preview/diff.

Cada exemplo deve mostrar **o que muda no denominador** quando houver missing/exclusão.

## 28.5 Fórmulas

Gerar a referência de funções a partir do registry sempre que possível.

Para cada função:

- assinatura;
- categoria;
- descrição;
- exemplo;
- comportamento com missing;
- erros;
- necessidade de ordenação/agrupamento;
- versão em que entrou.

Exemplo:

```text
RATE(eventos, populacao, base)

Retorna eventos / população × base.
Se população = 0 ou ausente → NA.
Não busca população automaticamente.
```

## 28.6 Comparação de tabelas

O manual deve ensinar explicitamente:

- quando usar `inner/left/right/full`;
- como ler cobertura de matching;
- como tratar linhas não correspondentes;
- por que município de residência ≠ ocorrência;
- por que correlação ≠ concordância;
- diferença entre contagem, proporção e taxa;
- como usar índice base 100;
- como comparar filtro atual × restante;
- como comparar períodos/fontes;
- como exportar o diagnóstico de alinhamento.

## 28.7 Auditoria estatística

O manual deve dizer em destaque:

> “Sinal estatístico não é prova de erro.”

Explicar de forma curta e rigorosa:

- IQR/MAD;
- Hampel;
- raridade categórica;
- JSD/TVD;
- concentração HHI/entropia;
- missingness;
- comparação de proporções e IC;
- associações cross-field;
- múltiplos testes/BH;
- score de revisão.

Separar sempre:

- anomalia estatística;
- inconsistência lógica;
- regra de domínio.

## 28.8 Mapas

Explicar:

- escolher medida;
- classes/cortes;
- quantis versus intervalos iguais versus manual;
- missing;
- clicar/selecionar;
- aplicar seleção como filtro;
- usar mapa de delta/razão em comparação;
- limitações: não é um GIS geral.

## 28.9 Reprodutibilidade

Explicar arquivos do projeto:

- raw/cache;
- `.twrecipe`;
- `.twtable`;
- manifestos de origem;
- hashes;
- exportação;
- atualização de dados;
- como reexecutar uma receita.

## 28.10 Troubleshooting

Incluir pelo menos:

- download oficial indisponível/parcial;
- arquivo DBC/DBF inválido;
- schema inesperado;
- código IBGE não casa;
- tabela A/B com granularidade diferente;
- chave duplicada;
- divisão por zero;
- fórmula inválida;
- mapa sem correspondência territorial;
- memória insuficiente/base grande;
- por que um detector não rodou (N pequeno/cardinalidade alta/orçamento).

## 28.11 Manual vivo e testes

- links do manual devem ser checados em CI;
- exemplos devem usar fixtures públicas/estáveis;
- screenshots só depois do freeze de UI;
- nomes de funções/processors devem ser gerados ou conferidos contra registry/schema;
- toda nova feature pública exige atualização correspondente no manual.

---

# 29. Sequência final do projeto antes de chamar a versão de “final”

A ordem consolidada desta conversa é:

```text
1. Faxina do repo
2. Fechar aquisição/preparação MicrodataSUS-like
3. Transformação/limpeza manual + diff
4. Fórmulas/engine fx
5. Comparação de tabelas
6. Auditoria estatística automática
7. Integração comparação ↔ auditoria ↔ mapa
8. Reprodutibilidade/recipes/provenance
9. Testes unitários + goldens + E2E
10. Passada final de UI
11. Manual final
12. Auditoria final de release
```

Não inverter 9 e 10 para “deixar bonito logo”. Não escrever o manual definitivo antes de 10. Não deixar comparação/auditoria para depois da UI, porque elas alteram navegação e layout.

## 29.1 Definição de release aceitável

Para o escopo desta conversa, a release só é considerada madura se for possível fazer o seguinte sem sair para R/Excel por necessidade estrutural:

```text
Dados oficiais DATASUS
→ baixar vários períodos
→ preparar campos
→ limpar/recodificar manualmente
→ ver diff
→ tabular
→ criar taxa/fórmula
→ comparar com outra tabela/subconjunto/fonte
→ investigar divergências estatisticamente
→ abrir o sinal no tempo/território/mapa
→ exportar resultado + provenance
→ salvar receita
→ reexecutar em dados atualizados
```

R/Python/Excel continuam excelentes ferramentas e podem receber exportações/código equivalente, mas deixam de ser **obrigatórios para realizar essas operações básicas de investigação**.

## 29.2 O que este documento deliberadamente não promete

- substituir R/Python em modelagem estatística geral;
- ser Excel completo;
- ser QGIS completo;
- inferir causalidade;
- validar clinicamente registros sozinho;
- fazer linkage individual sem identificadores adequados;
- transformar coincidência estatística em conclusão epidemiológica;
- garantir equivalência com TabWin em fluxo sem golden.

A ambição é mais específica e mais útil: **uma bancada local-first de tabulação, transformação, comparação e auditoria epidemiológica que seja transparente, reproduzível e utilizável sem código, preservando a compatibilidade validada com o TabWin onde ela existe.**

---

# 30. Checklist final de completude desta conversa

Antes de entregar este MD a outro agente, confirmar:

- [x] faxina pré-UI está especificada;
- [x] manual final está especificado;
- [x] mapas dinâmicos estão reconhecidos e protegidos contra regressão;
- [x] operações matemáticas atuais e erros estão formalizados;
- [x] funções estilo Excel foram ampliadas para além dos exemplos iniciais;
- [x] comparação de tabelas está tratada como feature própria;
- [x] comparação longitudinal, normalização e subconjunto × referência estão incluídos;
- [x] SIH × SIM exige alinhamento semântico explícito;
- [x] fluxo tipo MicrodataSUS inclui aquisição **e** `process_*`;
- [x] combinação de anos/UF/competências e schema drift estão incluídos;
- [x] limpeza manual equivalente a `dplyr` está incluída;
- [x] código IBGE, datas e “Ignorado” estão formalizados;
- [x] IA de limpeza é opcional e passa por diff/aprovação;
- [x] “ver código equivalente” R/pandas está incluído;
- [x] Arrow/DuckDB entram como infraestrutura de escala, não semântica;
- [x] auditoria de estranheza é estatística e genérica, não paper-driven;
- [x] métodos robustos, distribuição, tempo, território, missingness e cross-field estão incluídos;
- [x] paper de sífilis é fixture de validação sem hardcode;
- [x] “explodir agrupamento” está incluído;
- [x] comparação ↔ auditoria ↔ mapa está integrada;
- [x] provenance/recipe/reexecução estão incluídos;
- [x] UI final foi colocada depois dos contratos e testes;
- [x] pré-implementação existente de `statistical-anomaly.ts` e `table-comparison.ts` foi preservada como starter code, não vendida como feature completa.

Se qualquer item acima for removido em uma revisão futura, o handoff precisa justificar explicitamente o motivo.
