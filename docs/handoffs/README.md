# Handoffs

Relatório de cada corte de trabalho substantivo do projeto, na ordem em que
aconteceu. Isso é rastreabilidade, não lixo: cada afirmação de compatibilidade
ou cada defeito corrigido tem um relatório aqui que explica a evidência.

## `current/`

Os cinco handoffs mais recentes — a Faixa 4.3 até a 4.9/Microdatasus,
2026-08-30. Refletem o estado do código hoje.

## `archive/`

Histórico completo, agrupado por época:

- `r01-r05/` — bootstrap, workbench inicial, primeiro golden exato (G001),
  operações de tabela, exports, catálogo DATASUS.
- `r06-r09/` — seleção de dimensões, Worker dedicado ao dataset, qualidade de
  dados, tabela virtualizada, cache L3, diff de tabulação, importação GeoJSON.
- `r10/` — segunda bateria de goldens (G002–G023), G017 múltiplas medidas,
  G012 e G009 resolvidos, auditoria round 1 do ChatGPT.
- `misc/` — relatórios da era anterior à numeração `R0x` (auditorias Codex,
  catálogo nacional, limpeza assistida).

Nada aqui é deletado quando fica velho. Um handoff descreve o que era verdade
quando foi escrito; reescrevê-lo depois falsificaria o registro. Quando um
handoff descreve algo que uma revisão posterior corrigiu, a correção vive em
outro handoff, não numa edição do antigo.
