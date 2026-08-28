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

## LACUNA REAL ENCONTRADA

O script oficial declara 18 fontes:

```text
CIH CIHA CNES ESUSNOTIFICA ESUSNOTIFICA_p IBGE PCE PO RESP
SIASUS SIHSUS SIM SINAN SINAN_P SINASC SISCOLO SISMAMA SISPRENATAL
```

O aplicativo implementa 16. Faltam as duas variantes **preliminares**:

- `SINAN_P` — dados preliminares do SINAN, com seus próprios **58 tipos**;
- `ESUSNOTIFICA_p` — dados preliminares do e-SUS Notifica.

Isso não é um erro da lista de finais auditada acima: são fontes irmãs que
nunca foram modeladas. Um usuário que precise do ano corrente do SINAN só
encontra o dado em `SINAN_P`, porque a base final ainda não foi fechada.

### Antes de implementar

Preliminar e final não são intercambiáveis. A distinção precisa aparecer na
proveniência e na auditoria do plano, nunca ser silenciosamente misturada numa
mesma tabulação. Enquanto isso não estiver decidido, `SINAN_P` permanece
registrado como lacuna conhecida e não como suporte parcial.

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
