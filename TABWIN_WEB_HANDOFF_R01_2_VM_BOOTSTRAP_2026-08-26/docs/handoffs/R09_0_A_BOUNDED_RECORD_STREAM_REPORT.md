# R09.0-A — leitura de registros em blocos limitados

**Data:** 2026-08-28
**Status:** COMPLETO para a camada de montagem de registros; a agregação no
Worker e a ligação com a interface continuam pendentes.

## STATUS

O passo 1 do próximo passo obrigatório do handoff está feito e provado: existe
uma camada que consome os blocos do `implode-stream.ts` através de fronteiras
arbitrárias de registro DBF e entrega lotes limitados, sem materializar o DBF
decodificado nem acumular todos os registros.

Isto **ainda não abre o `DENGBR25.dbc`**. Nada na interface mudou.

## O QUE FOI ADICIONADO

`packages/acquisition/src/dbf-record-stream.ts`:

- `streamRecordsFromChunks(header, produce, consume, options)` — o motor de
  montagem, sobre qualquer produtor de blocos;
- `streamDbcRecords(dbc, consume, options)` — envelope DBC, sem materializar o DBF;
- `streamDbfRecords(dbf, consume, options)` — DBF já decodificado.

Custo de pico: a entrada comprimida, uma cópia de bloco, **um** buffer do
tamanho de um registro e **um** lote de registros decodificados.

O cabeçalho DBF fica descomprimido no início do envelope DBC, então o schema é
conhecido antes de qualquer byte de registro ser decodificado.

## EQUIVALÊNCIA COM O LEITOR PUBLICADO

A decodificação de campo espelha `readDbfRecords` do
`@precisa-saude/datasus-dbc`. Essa equivalência não é assumida.

### Fixtures sintéticas — `tests/dbf-record-stream.test.mjs`, 9 casos

250 registros de 40 bytes cobrindo C, N, D, L e I, incluindo texto vazio,
numéricos em branco, data inválida, lógico em branco, acentuação
Windows-1252, os extremos de int32 e três registros marcados como excluídos.

Comparação `deepEqual` contra o leitor publicado com blocos de **1, 2, 3, 5, 7,
39, 40, 41 e 4096 bytes**. Blocos de 1 a 7 partem registros no meio de um
campo; 39/40/41 caem em cima da própria fronteira de registro; 4096 é a janela
que o decodificador DCL realmente emite.

### Arquivo oficial real — `npm run verify:record-stream`

Contra o `RDAC2401.dbc` verdadeiro:

```json
{
  "declared": { "recordCount": 4315, "recordSize": 702, "headerSize": 3649 },
  "reference": { "materializedDbfBytes": 3032779, "records": 4315 },
  "streamed": {
    "records": 4315, "bytesDecoded": 3029130, "chunkCount": 740,
    "maxChunkBytes": 4096, "trailingBytes": 0, "batches": 3, "peakBatchRecords": 2000
  },
  "equalRecords": 4315,
  "divergentRecords": 0,
  "pass": true
}
```

Os 4.315 registros são idênticos campo a campo aos do leitor materializado.
O DBC oficial não é redistribuído no repositório; o script recebe o caminho do
oracle privado.

## MEMÓRIA MEDIDA, NÃO AFIRMADA

`npm run bench:record-stream -- <registros> <modo>`, cada modo em seu próprio
processo, toda amostra depois de GC forçado:

| Registros | Materializado | Em blocos | Razão |
| --- | --- | --- | --- |
| 400.000 | 126,8 MiB | 2,1 MiB | 60× |
| 1.200.000 | 376,5 MiB | 2,1 MiB | 179× |

O pico do caminho materializado cresce com o arquivo; o do caminho em blocos
**não se move**. Essa é exatamente a propriedade que faltava.

Escopo honesto da medição: ela isola o custo dos **objetos de registro**, com
os bytes do DBF já residentes nos dois caminhos. No caminho DBC o ganho é
maior ainda, porque o fluxo em blocos também evita materializar o DBF
decodificado — cerca de 511 MiB no caso do `DENGBR25.dbc`. Esse acréscimo não
foi medido: sintetizar um DBC grande exigiria um codificador DCL, que não
existe no projeto.

Uma primeira medição foi descartada por ser inválida: amostrar sem GC contava
lixo ainda não coletado e a coleta prematura do array materializado reportava
0,4 MiB de pico. Ambos os defeitos estão corrigidos no script versionado.

## CANCELAMENTO

`shouldCancel` é consultado na fronteira de cada lote. Cancelar encerra o
fluxo sem lançar erro, marca `cancelled: true` e dispensa a exigência de ler
todos os registros declarados.

Limite declarado com franqueza: um Worker bloqueado neste laço síncrono **não
recebe mensagens**. `shouldCancel` serve para quem controla o laço; para
interromper uma decodificação já em andamento a partir da thread principal o
caminho é `worker.terminate()`, com a limpeza do workspace parcial feita do
lado de fora. Isso está documentado no próprio módulo para que ninguém suponha
uma garantia que não existe.

## GUARDAS

- tamanho de lote inválido é rejeitado;
- geometria inutilizável no cabeçalho é rejeitada;
- desacordo entre envelope DBC e cabeçalho DBF é rejeitado;
- registro partido no fim do fluxo é reportado como registro incompleto;
- contagem menor que a declarada é reportada com os dois números;
- o byte final opcional de EOF é aceito; qualquer excedente maior que ele é erro.

## GATE

`npm run check`: **121/121** testes (eram 112), build do núcleo, typecheck web
e build Vite aprovados. `fixtures/golden/G001` inalterado. `npm run verify:g001`
continua `pass: true` com tolerância zero.

## PRÓXIMO PASSO

1. Agregar no Worker sobre os lotes, sem devolver registros à thread principal.
   A agregação é síncrona e limitada, o que combina com este laço; é o caminho
   preferível à persistência de lotes em IndexedDB, que reintroduziria trabalho
   assíncrono dentro de um produtor síncrono.
2. Progresso e limpeza de workspace parcial.
3. Só então ligar o caminho em blocos à interface e tentar o `DENGBR25.dbc`.

## NÃO REGREDIR

O caminho materializado e o guarda de 256 MiB continuam válidos e em uso. Esta
entrega adiciona um caminho paralelo; não remove o diagnóstico honesto de
capacidade nem afrouxa qualquer limite existente.
