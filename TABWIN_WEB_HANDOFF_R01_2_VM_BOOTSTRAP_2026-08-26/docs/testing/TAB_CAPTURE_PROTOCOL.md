# Protocolo de captura de `.TAB` — o que travar a Faixa 4.5

**Para:** quem tem o TabWin 4.15 aberto.
**Objetivo:** produzir pares controlados de `.TAB` para que o inspector isole o
formato campo a campo, **sem ninguém inventar offset**.

Mesma disciplina dos goldens: uma mudança por captura, tudo com hash, e o
arquivo é a verdade — nunca se ajusta o esperado para o código passar.

## Antes de começar

Use exatamente o mesmo conjunto do G001, que já está em
`tabwin-private/oracle/tabwin415/app/G001`:

- DBC: `RDAC2401.dbc`
- DEF: `RD2008.DEF`

Assim tudo que aparecer no `.TAB` pode ser cruzado com uma tabulação que já
sabemos reproduzir célula a célula.

Crie uma pasta `TAB_CAPTURES` e salve tudo lá.

## As capturas

Faça **na ordem**. Cada passo muda **uma coisa** em relação ao anterior.

| # | Arquivo | O que fazer |
| --- | --- | --- |
| T01 | `T01_base.tab` | Tabular `RD2008.DEF` com **Linha = Complexidade**, coluna "Não ativa", medida Frequência. Salvar como `.tab`. |
| T02 | `T02_titulo.tab` | Do T01, mudar **só o título** da tabela para `TITULO_TESTE_1`. Salvar. |
| T03 | `T03_coluna.tab` | Do T01, acrescentar **Coluna = Caráter atendimento**. Salvar. |
| T04 | `T04_filtro.tab` | Do T03, aplicar **seleção Caráter atendimento = Eletivo**. Salvar. |
| T05 | `T05_supressao.tab` | Do T01, ligar **Suprimir linhas zeradas**. Salvar. |
| T06 | `T06_decimais.tab` | Do T01, mudar as **casas decimais** para 2. Salvar. |
| T07 | `T07_incremento.tab` | Do T01, trocar a medida para **Valor Total** (incremento do DEF). Salvar. |
| T08 | `T08_mapa.tab` | Tabular por **Município**, abrir um mapa, e salvar com o **mapa incluído**. |
| T09 | `T09_acento.tab` | Do T01, pôr no título `Acentuação: ção ÁÉÍ` e salvar. Isso decide o encoding. |
| T10 | `T10_aspas.tab` | Do T01, pôr no título `Ele disse "oi"` e salvar. O `HISTORIA.TXT` registra um defeito antigo exatamente aqui. |

Se alguma opção não existir com esse nome na sua tela, **anote o que você
realmente fez** em vez de forçar — o registro do que foi feito vale mais que o
roteiro.

## Depois de salvar

1. Reabra **cada** `.tab` no próprio TabWin e confirme que a tabela volta igual.
   Se algum não voltar, anote qual e o que mudou; isso também é resultado.
2. Gere os hashes:

```bash
sha256sum TAB_CAPTURES/*.tab > TAB_CAPTURES/SHA256SUMS.txt
```

3. Mande a pasta inteira num zip.

## O que eu faço com isso

- `inspectLegacyTab` em cada arquivo, para container, strings e referências;
- `diffLegacyTabInspections(T01, Tnn)` par a par — como só uma propriedade mudou,
  o que o diff mostrar **é** aquele campo;
- T09 decide o encoding, T10 decide a regra de aspas, T08 decide se o mapa é
  bloco embutido ou referência a arquivo;
- só então os campos isolados viram especificação, teste e parser.

## O que eu não vou fazer

Escrever um parser de `.TAB` por analogia com `.PRN` porque a evidência do
binário aponta nessa direção. `FORTEMENTE INDICADO` não é `PROVADO`, e o
`RE_000_METHOD_MAP.md` mantém a diferença explícita.
