# R10.13 — Faixa 4.7: armazenamento colunar e cache L2, medidos

**Data:** 2026-08-30
**Estado:** armazenamento e cache concluídos e medidos. Executor vetorizado
direto continua deliberadamente fora. Gate **289/289**.

## O que veio do ChatGPT

`packages/core/src/columnar-cache.ts`, aplicado sem alteração:

- builder em lotes, com chunks de tamanho fixo;
- dicionário por coluna, com chave que **distingue tipo**: `null`, `undefined`,
  `''`, `'null'`, `0`, `false`, `'false'` e uma `Date` são sete valores
  diferentes, não um `String()` colapsado;
- índice `Uint16` até 65.536 distintos, `Uint32` acima;
- `recordAt`, iterador e `select()` que reaproveita os mesmos buffers;
- cache L2 LRU por fonte + conjunto normalizado de campos, servindo um pedido
  mais estreito a partir do **menor superset** já guardado;
- `executeColumnarProjection`, que reconstrói e chama o executor de referência.

A decisão de não escrever um executor vetorizado agora está certa e fica: seria
um segundo motor com a semântica duplicada, que é exatamente o erro que a 4.6
recusa em SQL.

## O que foi acrescentado

### Três casos de borda

O corte tinha três testes. Faltavam as bordas onde um codificador de dicionário
erra:

1. **O limite do `Uint16`.** 65.536 valores distintos ainda indexam em
   `Uint16` (0..65535); 65.537 não. Um erro de um aqui corromperia silenciosamente
   a coluna inteira. O teste constrói as duas projeções e verifica largura de
   índice e valor recuperado nos dois lados.
2. **A fronteira de chunk.** `recordAt` divide por `chunkRows` para achar o
   chunk; um erro de um lê do chunk vizinho e devolve um valor **plausível e
   errado**, que é o pior tipo. O teste percorre 600 linhas com chunks de 256 e
   confere as linhas 0, 255, 256, 511, 512, 598 e 599.
3. **Tipos que viram o mesmo texto.** Oito valores que um dicionário ingênuo
   colapsaria em menos.

### Medição, que era a pendência declarada

O ChatGPT escreveu que o cache "pode ser medido" e deixou a medição para depois.
`scripts/measure-columnar-cache.mjs` (`npm run bench:columnar`) mede, em cima de
um DBC real:

```text
RDAC2401.dbc · 4.315 linhas · PROC_REA, MUNIC_RES, VAL_TOT, DIAS_PERM, CGC_HOSP

projeção colunar:                   0,07 MiB
objetos equivalentes (estimativa):  0,64 MiB
razão:                              9,54x

  CGC_HOSP     25 distintos · índice 2 bytes ·  9 KiB
  DIAS_PERM    57 distintos · índice 2 bytes ·  9 KiB
  MUNIC_RES    51 distintos · índice 2 bytes ·  9 KiB
  PROC_REA    393 distintos · índice 2 bytes · 16 KiB
  VAL_TOT   2.216 distintos · índice 2 bytes · 26 KiB

tabulação por PROC_REA: objetos 52 ms · colunar 47 ms
resultados idênticos: sim
cache L2: pedido estreito servido pelo superset: sim
```

**9,5x** menos memória, com resultado idêntico. O tempo de tabulação é
praticamente o mesmo, e tem que ser: o caminho colunar **reconstrói os
registros** e chama o mesmo executor. Ganho de tempo só viria do executor
vetorizado, que é justamente o que não foi feito.

O script imprime medição, não assertiva: os números mudam com a máquina e com o
arquivo, e ele não entra no gate.

## O que continua fora, e por quê

**Executor vetorizado direto sobre os índices.** Duplicaria `resolvePlanRecord`
e a semântica de CNV, lookup, `startPosition` e unclassified — tudo que o G003,
o G009 e o G012 custaram para acertar uma vez. Se entrar, entra do mesmo jeito
que o caminho SQL da 4.6: com portão de paridade contra os goldens, e sem
substituir o caminho de referência antes de passar.

## Verificação

- `npm run check`: **289/289** (eram 283).
- 3 testes do ChatGPT: PASS, sem alteração.
- 3 casos de borda novos: PASS.
- `npm run bench:columnar` sobre `RDAC2401.dbc`: resultados idênticos.
