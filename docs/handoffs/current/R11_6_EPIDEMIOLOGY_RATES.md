# R11.6 — Taxas epidemiológicas e padronização por idade

**Data:** 2026-08-30
**Estado:** primeiro corte concluído. Gate **403/403**, E2E **25/25** (CI).

## O escopo, e a decisão de não inventar números

A trilha de epidemiologia da seção do roadmap pede denominadores IBGE, taxas,
IC e padronização. O usuário deixou a decisão comigo ("faz o que achar
melhor"). A decisão, guiada pela regra dura do projeto de **nunca inventar
número**:

- **Construí o mecanismo** — IC de taxa bruta (Byar/Poisson) e padronização
  direta por idade, com a matemática verificável e testada.
- **Não embuti nenhuma população-padrão.** A World Standard da OMS e as
  distribuições do censo IBGE são públicas, mas reproduzir os pesos exatos por
  faixa de memória arriscaria fabricar dado de referência. A população-padrão
  é **entrada**: o usuário a traz como uma coluna — na prática, juntando a
  tabela oficial com o `join` que a faixa anterior (R11.4.6) acabou de
  entregar. A matemática é o que mora aqui.

## `packages/analysis/src/epidemiology.ts`

- **`crudeRateInterval(events, population, per)`** — taxa bruta e IC 95% pela
  aproximação de Byar aos limites exatos de Poisson (erro bem abaixo de 1%
  para `events >= 1`; é o método que a OMS e ferramentas próximas do DATASUS
  usam para taxas baseadas em contagem). Para zero eventos, limite inferior 0
  e superior exato de Poisson (`-ln(0,025) = 3,6889` eventos esperados).
  Denominador zero devolve `null` — nunca uma taxa zero ou infinita.
- **`directlyStandardizedRate(strata, per)`** — DSR = `Σ(wᵢ·rᵢ)/Σwᵢ`, com
  variância `Σ(wᵢ²·eventosᵢ/popᵢ²)/(Σwᵢ)²` e IC 95% por aproximação normal
  (adequada quando a contagem total não é minúscula; para contagens muito
  pequenas um IC gama/Dobson seria mais justo, e isso é dito, não assumido em
  silêncio). Um estrato sem população ou sem peso-padrão é **pulado e
  contado**, nunca tratado como zero.

Propriedade ancorada em teste: padronizar um grupo pela sua **própria**
população reproduz exatamente a taxa bruta.

## UI: nova operação "Taxas e padronização" no painel Estatística

Sobre a tabela atual (uma linha por estrato — tipicamente faixa etária):
escolhe-se a coluna de **eventos**, a de **população**, opcionalmente a de
**população-padrão**, e a escala (`por 1.000 / 10.000 / 100.000`). Mostra:

- cartões de **taxa bruta** e, se houver padrão, **taxa padronizada**, cada
  uma com IC 95%;
- uma **tabela por estrato** com eventos, população e taxa (IC);
- nota dizendo a origem do IC (Byar) e que a padronização direta espera a
  população-padrão como coluna (junte a tabela oficial OMS/IBGE por "Juntar
  outra base"). Se algum valor de evento não era inteiro, avisa que foi
  arredondado para o IC de contagem.

Denominador zero mostra "—", nunca uma taxa inventada.

## Verificação

- `npm run check`: **403/403** (11 testes novos: taxa bruta, IC de Byar
  batendo com o Poisson exato para 10 eventos, zero eventos com limite
  superior exato, denominador zero → null, o IC estreitando com N maior,
  entradas inválidas recusadas, DSR reponderando os estratos, a identidade
  DSR = bruta quando o padrão é a própria população, estrato sem
  população/padrão pulado, nenhum estrato usável → null, e validação).
- `npm run e2e`: **25/25**, com um caso novo que monta uma tabela com faixa
  etária nas linhas e eventos/população/padrão em três colunas (medidas
  adicionais), e confere no painel: taxa bruta 16,67, padronizada 22,5, a
  taxa por estrato do grupo idoso (40) com IC de Byar, e que remover o padrão
  deixa só a taxa bruta.
- Verificação manual no navegador reproduzindo os mesmos números antes do E2E.

## O que continua fora

Populações-padrão embutidas (não fabrico os números; o usuário traz a oficial
por join). IC gama/Dobson para contagens pequenas (a aproximação normal está
adequada e o limite está dito). Razão de taxas padronizadas (SRR) e
padronização indireta (SMR) — extensões naturais do mesmo módulo, não deste
primeiro corte.
