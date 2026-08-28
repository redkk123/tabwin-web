# R09.0-C — o conjunto de dados passa a morar no Worker

**Data:** 2026-08-28
**Status:** completo e verificado em navegador real.

## O QUE MUDOU

A thread principal não guarda mais registro nenhum. O `main.ts` mantinha
`let records: DbfRecord[]` e **seis** consumidores liam esse array: tabulação,
perfil numérico de qualidade, lista de valores do filtro, exportação de
registros selecionados, combinação de arquivos e a contagem das estatísticas.

Enquanto esses seis lessem um array residente, o app continuava materializando
tudo, e o caminho em blocos serviria apenas para arquivo grande — solução de
caso particular. Agora existe **um caminho só**.

`apps/web/src/dataset-worker.ts` é dono das fontes abertas e responde a cinco
pedidos: `open`, `append`, `tabulate`, `profile-numeric`, `distinct` e
`selected-dbf`. Cada pedido percorre as fontes retidas em lotes limitados e
**decodifica somente os campos de que precisa**.

Não há limiar de tamanho em lugar nenhum. O mesmo código serve um SIH de
300 KiB e o Dengue nacional de 63 MiB.

## DETALHES QUE IMPORTAM

- **Combinar arquivos não concatena nada.** As fontes ficam na lista do Worker
  e são percorridas em sequência para dentro do mesmo acumulador, o que é mais
  barato e mais próximo do que combinar significa. O Worker valida o esquema
  contra o conjunto aberto.
- **CSV também é fonte.** Um delimitado analisado vira uma fonte do tipo
  `records`, então o mesmo Worker responde por ele e esta thread também não
  guarda seus registros.
- **A exportação não projeta campos**: o DBF exportado precisa carregar todos os
  campos declarados. A aceitação continua decidida por `resolvePlanRecord`, a
  mesma fronteira da tabulação, então a seleção exportada não pode discordar da
  contagem aceita.
- **Cancelar encerra o Worker.** Ele roda um laço síncrono e não processa
  mensagens enquanto decodifica, então `terminate()` é o mecanismo honesto, e
  está documentado no cliente e no `dbf-record-stream.ts`.

## VERIFICADO EM NAVEGADOR REAL

Servidor de desenvolvimento, `RDAC2401.dbc` verdadeiro carregado pelo seletor
de arquivos da própria interface:

- estatísticas do conjunto: **4.315 registros, 113 campos**, SHA-256
  `41b7ad5893`;
- tabela renderizada: `MUNIC_RES` por `Freqüência`, **51 linhas**, com
  `Ji-Paraná (110012) 2`, `Porto Velho (110020) 35` e as demais;
- perfil de qualidade de `IDADE`: 4.315 numéricos, 0 ausentes, 0 inválidos,
  faixa 0–98, mediana 33;
- valores do filtro de `IDENT` populados pelo Worker.

O protocolo do Worker foi exercitado diretamente no navegador antes disso:
`open` (4.315/113), `tabulate` (4.315 vistos e aceitos), `profile-numeric`
(mediana 33), `distinct` e `selected-dbf` (3.032.780 bytes gerados).

### Limitação do ambiente de teste, não do produto

O painel de pré-visualização desta VM não compõe quadros, então
`requestAnimationFrame` não dispara sozinho, e `runAnalysis` espera por um.
Esse `await` é código pré-existente, anterior a esta entrega. Um screenshot
força o quadro e a análise completa normalmente, como registrado acima. Em
navegador comum não há sintoma; ainda assim, vale trocar essa espera por
`setTimeout` de zero para não depender de composição.

## GATE

`npm run check`: **148/148** testes, typecheck do núcleo, typecheck web e build
Vite. `fixtures/golden/G001` inalterado e `npm run verify:g001` continua `pass`
com tolerância zero.

## AINDA NÃO FEITO

O `DENGBR25.dbc` **não foi aberto numa sessão real de navegador**. O caminho
está pronto e medido fora do navegador (13,2 s para tabular), mas a prova em
navegador com esse arquivo continua pendente.
