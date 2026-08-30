# R11.4.5 — Empilhar bases (bind_rows)

**Data:** 2026-08-30
**Estado:** concluída. Gate **384/384**, E2E **23/23**.

## Por que, e o que é diferente

`bind_rows` é a primeira operação do pipeline que combina **duas fontes** de
dados — é o "Juntar bases" que o ChatGPT destacou na conversa de 2026-08-30
(`den22 + den23 + den24 → Juntar bases`). Todas as etapas anteriores operavam
sobre um único dataset; esta empilha um segundo abaixo do atual.

**O que já existia e não bastava:** "Combinar DBC/DBF" (append pelo Worker)
já empilha arquivos binários **do mesmo esquema**. `bind-rows` é a versão que
une esquemas **diferentes**: colunas de um lado que o outro não tem, e uma
coluna de origem opcional. São coisas complementares.

## A segunda fonte vem embutida no passo

`BindRowsStep.source` é um `PipelineSource` (`{ label, fields, records }`)
carregado **inline** no passo, não referenciado — o pipeline continua
autocontido. A UI carrega um segundo arquivo CSV/TSV, parseia na thread
principal (`parseDelimited`) e embute no passo ao adicioná-lo.

**Primeiro corte: segunda fonte só CSV/TSV.** DBC/DBF como segunda fonte
precisaria do Worker (decodificação binária não roda barato na thread
principal), o que é um passo à parte; para o caso comum de empilhar tabelas
já preparadas, CSV/TSV cobre. Dito na própria interface, que também aponta o
"Combinar" para o caso binário do mesmo esquema.

## Semântica

- **União de colunas.** O resultado tem as colunas atuais primeiro, depois as
  colunas que só a fonte tem, depois a coluna de origem (se pedida). Nada é
  descartado de nenhum lado.
- **Coluna só de um lado fica ausente do outro** — `null`, "—" na tabela,
  nunca um valor inventado.
- **Sem conversão de tipo silenciosa.** Os valores entram como estão; uma
  coluna que é número numa base e texto na outra fica com os dois como estão,
  e o passo `converter tipo` resolve explicitamente se o autor quiser.
- **Coluna de origem opcional** marca cada registro com o rótulo da sua base
  (`FONTE_ORIGEM`), com rótulo configurável para a base atual.

## O prerequisito que também melhorou o resto: síntese de tipo por inspeção

Uma coluna que só a segunda base tem não tem origem no dataset primário, então
o Worker precisa inferir a forma DBF dela. Antes, todo campo criado pelo
pipeline (derive-column, partes de data, agregações) era sintetizado como
numérico fixo `N/20/6` — o que estava certo para os que eram, mas quebraria
uma coluna de texto vinda de uma segunda base. Agora o Worker **inspeciona os
valores reais**: numérico quando todo valor presente parseia como número (aí
é oferecido como medida e perfilado como numérico), caractere caso contrário,
largo o suficiente para o maior valor. Melhora também os campos derivados
existentes: um texto que uma fórmula produzisse agora é reconhecido como
texto, não forçado a numérico.

## Verificação

- `npm run check`: **384/384** (6 testes novos de bind-rows: empilhar
  unindo colunas, coluna só de um lado virando null, coluna de origem,
  empilhar vários anos como o exemplo do GPT, um passo posterior enxergando o
  esquema unido, e validação de forma).
- `npm run e2e`: **23/23**, com um caso novo que carrega a base A pela entrada
  principal, a base B pela entrada própria do passo, empilha com coluna de
  origem, e confere pela tabela que o esquema unido tem as colunas dos dois
  lados, que a origem marca cada registro, e que somar OBITOS (só da base A)
  por origem dá 30 na base A e **nenhuma linha** para a base B — um null, não
  um zero fabricado.
- Verificação manual no navegador com duas bases de esquemas diferentes antes
  do E2E.

## O que continua fora

`join` de microdados (chave explícita, `inner`/`left`/`right`/`full`,
diagnóstico de cardinalidade) — a próxima e última costura do pipeline
(R11.4.6). E DBC/DBF como segunda fonte de um bind/join, que precisa do
Worker.
