# ADR-0005 — Aquisição DATASUS resiliente e local-first

**Estado:** aceito em 2026-08-31.

## Decisão

A aquisição oficial é dividida em quatro responsabilidades testáveis:

1. **resolver** uma consulta em um endereço oficial;
2. **transportar** formulário/ZIP com tentativas limitadas;
3. **validar** a assinatura do ZIP antes de cache ou extração;
4. **orquestrar** o lote sem perder sucessos anteriores.

Uma falha transitória em um item é tentada no máximo três vezes no total. Se
continuar falhando, recebe `LOOKUP_FAILED`, `DOWNLOAD_FAILED` ou
`INVALID_FILE`, fica no manifesto e o item seguinte é tentado. Somente
`CANCELLED`, provocado pelo usuário, interrompe os próximos itens.

`NOT_PUBLISHED` significa apenas que uma consulta válida retornou uma lista
vazia. Não é erro, não recebe retry automático e não afirma que o arquivo nunca
existiu.

## Resolução redundante

O resolvedor principal continua sendo o formulário oficial do DATASUS. Um
fallback `microdatasus-compatible` só é acionado quando o principal falha —
nunca para toda consulta e nunca após uma ausência confirmada.

O fallback deriva candidatos exclusivamente do registro publicado no código do
microdatasus para SIH, SIA, CNES e subconjuntos explícitos de SIM, SINASC e
SINAN. A combinação sem regra conhecida não gera URL: fica como falha de lookup
com “fallback seguro indisponível”. O candidato continua restrito a
`ftp.datasus.gov.br` e é verificado pelo endpoint oficial de preparação.

Isso absorve a política operacional madura do microdatasus sem colocar R ou
Python no caminho de rede. Pyodide/webR pertencem ao futuro Laboratório
científico, não ao downloader.

## Lotes, cache e evidência

- execução sequencial (`concorrência = 1`) para limitar memória e pressão no
  serviço público;
- DEF/CNV verificados são resolvidos uma vez por lote; uma Promise rejeitada é
  removida do cache e pode ser tentada de novo;
- cada operação pode salvar um manifesto `tabwin-web.datasus-batch` com todos os
  pedidos, resolver, tentativas, status e erro;
- “Retentar somente falhas” seleciona apenas `LOOKUP_FAILED`,
  `DOWNLOAD_FAILED` e `INVALID_FILE`;
- ZIP vazio, HTML/XML com HTTP 200 ou bytes sem assinatura PKZIP são rejeitados
  antes do IndexedDB;
- o Worker continua sendo allowlist, não um proxy aberto.

## Limites conhecidos

- o fallback não cobre todos os tipos do catálogo oficial; expandi-lo exige
  evidência de caminho e nomenclatura, nunca extrapolação;
- a disponibilidade real do serviço não é testável de modo determinístico no
  CI; os testes cobrem política e formatos com transporte simulado;
- a UI mantém execução sequencial. Concorrência maior só deve entrar após
  medição em tablet e limites explícitos.

## Evidência

Os testes em `tests/datasus-resilience.test.mjs` cobrem sucesso total, falha no
meio com continuação, retry recuperado, ausência, candidato de fallback,
cancelamento, HTML inválido, cache de auxiliares e manifesto completo.

Referência primária consultada: código-fonte de `fetch_datasus()` e
`datasus_download_helpers.R` do projeto microdatasus:
<https://github.com/rfsaldanha/microdatasus>.
