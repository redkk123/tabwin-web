# Auditoria do catálogo SINAN contra a fonte oficial

**Data:** 2026-08-28
**Motivo:** dúvida sobre se a ampliação do catálogo SINAN foi conferida contra
o DATASUS, e não apenas escrita.

## STATUS

O catálogo SINAN do aplicativo confere **exatamente** com a lista oficial de
Transferência de Arquivos: 58 tipos, diferença zero nos dois sentidos. Duas
fontes oficiais irmãs continuam ausentes e estão registradas abaixo.

## MÉTODO

A lista oficial não está no HTML da página; o seletor é montado em tempo de
execução. A fonte auditável é o script que a página carrega:

```text
https://datasus.saude.gov.br/wp-content/transferencia.js
```

Cada entrada tem a forma `{ fonte, sigla_arquivo, desc_arquivo, abrangencia }`.
Foram extraídas as entradas com `fonte: "SINAN"` e comparadas com
`DATASUS_FILE_TYPES` em `packages/acquisition/src/datasus.ts`.

## RESULTADO

| Comparação | Resultado |
| --- | --- |
| Tipos com `fonte: "SINAN"` no oficial | 58 |
| Tipos `system: 'SINAN'` no aplicativo | 58 |
| No oficial e faltando no aplicativo | nenhum |
| No aplicativo e ausente do oficial | nenhum |

A regressão `tests/datasus.test.mjs` fixa a contagem, a unicidade, a cobertura
nacional e a data da observação. Ela permanece uma foto datada: uma inclusão
futura do DATASUS exige nova observação, não inferência.

## O SELETOR DO TABNET NÃO É ESTA LISTA

A confusão que motivou a auditoria vem de duas superfícies oficiais distintas
com listas diferentes:

| Superfície | O que entrega | Exemplo de divergência |
| --- | --- | --- |
| Transferência de Arquivos | arquivos `.dbc` que o TabWin Web baixa e abre | um único `DENG` |
| TabNet (`deftohtm.exe?sinannet/cnv/...`) | tabulação on-line pronta | `Dengue até 2013` e `Dengue de 2014 em diante` separados |

Dois exemplos concretos observados na página do TabNet:

- **Febre Amarela** aparece lá, mas aponta para
  `dadosabertos.saude.gov.br/dataset/febre-amarela-em-humanos-e-primatas-nao-humanos`.
  É um conjunto de dados abertos, não um `.dbc` do SINAN. Não existe tipo
  correspondente na Transferência de Arquivos e por isso não deve existir no
  seletor de download.
- **A divisão da Dengue** (`cnv/dengue` até 2013 e `cnv/dengueb` de 2014 em
  diante) é uma distinção de DEF/CNV do TabNet, não de arquivo. Continua
  deferida: `explicitly_partial_or_unsupported` já registra que interpretações
  históricas da Dengue não representadas na lista de códigos atual não são
  inventadas.

Ausência de um agravo no seletor de download portanto **não** é defeito do
catálogo quando o DATASUS não publica arquivo para ele.

## SINAN_P NÃO É UMA LACUNA — CORREÇÃO

Uma versão anterior deste documento afirmou que `SINAN_P` e `ESUSNOTIFICA_p`
eram fontes ausentes que precisavam ser implementadas. **Isso estava errado** e
fica registrado aqui em vez de ser apagado.

O script oficial declara 18 fontes e o aplicativo modela 16, mas as duas
restantes são apelidos, não conteúdo novo. Observado no endpoint oficial em
2026-08-28, `fonte=SINAN` e `fonte=SINAN_P` devolvem resposta **idêntica**:

| Consulta | Arquivo | Modalidade retornada | Endereço |
| --- | --- | --- | --- |
| `SINAN` / DENG / 2024 | `DENGBR24.dbc` | Dados - Finais | `/SINAN/DADOS/FINAIS/` |
| `SINAN_P` / DENG / 2024 | `DENGBR24.dbc` | Dados - Finais | `/SINAN/DADOS/FINAIS/` |
| `SINAN` / DENG / 2026 | `DENGBR26.dbc` | Dados - Preliminares | `/SINAN/DADOS/PRELIM/` |
| `SINAN_P` / DENG / 2026 | `DENGBR26.dbc` | Dados - Preliminares | `/SINAN/DADOS/PRELIM/` |

O serviço resolve preliminar contra final **pelo ano consultado**, não pela
fonte escolhida, e responde sempre com `fonte: "SINAN_p"`. Acrescentar
`SINAN_P` ao seletor criaria uma entrada duplicada que devolve exatamente o
mesmo arquivo — ruído de interface, não capacidade nova.

A distinção que de fato importa já chega ao aplicativo: `parseSearchResponse`
guarda `modality`, a lista do catálogo a exibe junto da fonte, e ela viaja com
a origem do arquivo em cache. Um arquivo do ano corrente aparece como
`Dados - Preliminares`.

Trabalho remanescente sobre isso, agora corretamente descrito: garantir que a
modalidade preliminar apareça também na auditoria do plano e na receita, e não
apenas no momento da escolha. Não é fonte faltando; é proveniência a propagar.

## EVIDÊNCIA REPRODUZÍVEL

```bash
curl -s https://datasus.saude.gov.br/wp-content/transferencia.js -o transferencia.js
```

Depois extraia as entradas `fonte: "SINAN"` e compare com `fileTypesForSystem('SINAN')`.

## OBSERVAÇÃO SOBRE O SITE PUBLICADO

A versão em GitHub Pages ainda mostra os dez tipos representativos antigos. O
catálogo de 58 existe no código desde o working tree restaurado e agora está no
commit `5f9cc8a`; o site público continua atrás até que um deploy seja
autorizado.
