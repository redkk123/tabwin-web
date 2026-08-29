# G006, G008, G010, G012, G015, G017, G018 — segunda bateria de captura

**Status:** PRONTO PARA CAPTURA — 2026-08-29
**Para quem executa:** você, no TabWin 4.15 real. Eu monto os fixtures depois.

Leia primeiro `G001_CAPTURE_PROTOCOL.md` — as regras comuns (critério de
aprovação, classificação de falha, hashing, formato normalizado) não são
repetidas aqui.

Esta bateria só existiu porque o bundle auxiliar oficial do SIH foi baixado
em 2026-08-29 (865 CNVs, 267 DBFs de lookup). Antes dele, **cinco destes sete
casos eram impossíveis** por falta de arquivo real — não por falta de
esforço. Ver `OPERACOES_LOG.md` da mesma data.

---

## 0. Antes de começar

Tudo já está no lugar. **Feche e reabra o TabWin 4.15** para ele reler a pasta
`CNV\`, senão as tabelas novas não aparecem na lista.

- Arquivo de dados: `C:\projetos\tabwin-private\oracle\tabwin415\app\G001\RDAC2401.dbc`
- Definição: `RD2008.DEF` (mesma pasta)

Ativos, com hash conferido:

| Arquivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `RDAC2401.dbc` | 313.213 | `41B7AD58932CD56D6C60455CBF67E7995F5FD2E64375D0CC440631A191638429` |
| `RD2008.DEF` | 33.581 | `15376FB2E56917B4122FA475B15F1E270E9DAA4238F518D75E6BB6044372C652` |
| `CNV\COMPLEX2.CNV` | 265 | `680EB03BD06964CF4DAE4B571BC757990688279ADB164B54D5253009D8A3975F` |
| `CNV\CARATEND.CNV` | 389 | `E57C08CD045E6EAB1403013D96C7782C963D17BDDF4864840A964B99155D27F8` |
| `CNV\BR_PNDR.CNV` | 79.173 | `8390C187AFD4DB9314250D7DE8385F1876C5D33B372D1BFC4154B80D55E5DCA5` |
| `CNV\BR_CAPITAL.CNV` | 1.927 | `C7C0A847FB7D4E35308D7CFD971681C4B570FBBB9C3D3161E2E30B7AE0095FF4` |
| `CNV\BR_REGIAOUF.CNV` | 2.186 | `D1C9C9B3FB9E715F60BE00CEEC7C0DBF1F98208A57C68CC483EE4CE5E9036EDE` |
| `CNV\NATJUR.CNV` | 10.663 | `11016C1A9821D27FB5F5341F68366FE2A49A1913265C1E1A7D39BEAA1EB871EE` |
| `DBF\TCNESAC.DBF` | 4.364 | `F6B94CDE41B1184DFA1A32A34FCF027C98B26CEA7BC496634EA455061ABEB78F` |

**Os números "previstos" não são o golden.** O golden é o que o TabWin 4.15
mostrar. As previsões existem só para você conferir na hora e para que uma
divergência apareça imediatamente, em vez de depois da normalização.

---

## 1. Ordem sugerida

Comece pelo **G010** — é o de maior valor e o único onde eu já suspeito de um
bug nosso. Depois os outros em qualquer ordem. Cada caso é independente: se um
travar, manda os outros mesmo assim.

| Caso | Semântica isolada | Tenho previsão? |
| --- | --- | --- |
| G010 | hierarquia de subtotal em CNV | sim, **menos o Total** |
| G006 | valores não classificados pela CNV | sim |
| G008 | CNV de código literal (modo `L`) | sim |
| G018 | duas seleções simultâneas | sim |
| G012 | formato novo `N` de CNV | **não** — captura para descobrir |
| G015 | rótulo vindo de DBF externo | **não** — captura para descobrir |
| G017 | múltiplos incrementos | **não** — e pode nem existir na interface |

---

## G010 — hierarquia de subtotal *(prioridade máxima)*

**Semântica:** uma CNV onde categorias-pai agregam categorias-filhas. No
`BR_REGIAOUF.CNV`, as regiões têm código `XX` — que **nunca** casa com um
código de UF real. O valor da região não vem de registro nenhum: vem da
soma dos filhos. É exatamente isso que este caso testa.

**Configuração:**

- Linha: **Região/UF de Residência**
- Coluna: nenhuma · Incremento: Frequência · Seleções: nenhuma
- Suprimir linhas zeradas: **ligado**

**Previsto — 16 linhas:**

```text
Região Norte              4303
.. Rondônia                 42
.. Acre                   4113
.. Amazonas                147
.. Amapá                     1
Região Nordeste              1
.. Rio Grande do Norte       1
Região Sudeste               3
.. Minas Gerais              1
.. Rio de Janeiro            1
.. São Paulo                 1
Região Centro-Oeste          8
.. Mato Grosso do Sul        1
.. Mato Grosso               4
.. Goiás                     2
.. Distrito Federal          1
```

### ⚠️ O ponto do caso: anote o Total com atenção

Cada registro aparece **duas vezes** na tabela — uma na UF, outra na região.
Somando todas as linhas dá **8.630**, que é exatamente 2 × 4.315.

Hoje o nosso motor mostraria **8.630**. **Suspeito que o TabWin mostre 4.315**,
excluindo as linhas de subtotal do total. Se mostrar 4.315, achamos um bug
real nosso — e este caso terá se pagado sozinho.

**Anote o número exato, seja qual for.** Não conserte nada, não mude
configuração para "melhorar" o resultado.

---

## G006 — valores não classificados

**Semântica:** um valor que existe no dado mas **não é coberto** por nenhuma
regra da CNV aplicada.

Este caso estava adiado desde a primeira bateria: nenhum campo do
`RDAC2401.dbc` produzia um valor fora da cobertura das CNVs que tínhamos. O
`BR_PNDR.CNV` cobre só parte dos municípios brasileiros, então finalmente
existe um caso real.

**Configuração:**

- Linha: **Mesorregião PNDR de Resid.**
- Coluna: nenhuma · Incremento: Frequência · Seleções: nenhuma
- **"Não classificados": LIGADO**
- Suprimir linhas zeradas: **ligado**

**Previsto:**

```text
002 Alto Solimões                          13
008 Vales do Jequitinhonha e do Mucuri       1
010 Vale do Rio Acre                     2598
Não classificados                        1703
Total                                    4315
```

O **1.703** é o número que nunca conseguimos produzir antes. Se o TabWin
chamar essa linha de outra coisa ("Não class.", "Outros", ou deixar em
branco), **anote o texto exato, caractere por caractere** — o rótulo faz
parte do golden.

---

## G008 — CNV de código literal (modo `L`)

**Semântica:** modo `L`, onde a **primeira** regra que casa vence — oposto do
código curto dos G001–G005, onde a última vence. Nenhum caso anterior
exercitou isso.

**Configuração:**

- Linha: **Capital de Residência**
- Coluna: nenhuma · Incremento: Frequência · Seleções: nenhuma
- **"Não classificados": DESLIGADO**
- Suprimir linhas zeradas: **ligado**

**Previsto — 9 linhas:**

```text
110020 Porto Velho        35
120040 Rio Branco       1789
130260 Manaus              5
160030 Macapá              1
240810 Natal               1
330455 Rio de Janeiro      1
510340 Cuiabá              1
520870 Goiânia             1
530010 Brasília            1
Total                    1835
```

Total **1.835**, não 4.315 — quem não mora em capital fica de fora quando
"Não classificados" está desligado. Confirme que o TabWin faz o mesmo.

---

## G018 — duas seleções simultâneas

**Semântica:** dois filtros ao mesmo tempo se **intersectam** (E lógico), não
se somam.

**Configuração:**

- Linha: **Complexidade do Procedimento** (a mesma de G001–G005)
- Coluna: nenhuma · Incremento: Frequência
- **Seleção 1:** Caráter atendimento → marcar só **"01 Eletivo"**
- **Seleção 2:** Complexidade do Procedimento → marcar só **"Alta complexidade"**
- Suprimir zeros: **desligado**

**Previsto:**

```text
Atenção Básica          0
Média complexidade      0
Alta complexidade     124
Não se aplica           0
Total                 124
```

O **124** é o número decisivo. Cada filtro sozinho daria 2.092 (só Eletivo) ou
162 (só Alta). Só a interseção dá 124 — e esse valor já está confirmado de
forma independente na matriz do G002 (linha Alta × coluna Eletivo = 124).

**Se der 2.254** (= 2.092 + 162), o TabWin soma em vez de intersectar, e isso
seria uma divergência semântica enorme. Anote e me avise.

---

## G012 — formato novo `N` de CNV *(sem previsão)*

**Semântica:** o layout de colunas largas que o TabWin 3.7a+ introduziu,
marcado por `N` no cabeçalho da CNV.

**Nosso parser se recusa a ler este formato** — de propósito: os offsets nunca
foram confirmados, e adivinhar seria inventar semântica. O bundle oficial tem
**89 arquivos reais** nesse formato, e o `NATJUR.CNV` é um deles.

**Configuração:**

- Linha: **Natureza Jurídica**
- Coluna: nenhuma · Incremento: Frequência · Seleções: nenhuma
- Suprimir zeros: **ligado**

**Não tenho previsão.** O objetivo é revelar como o TabWin lê esse layout.

Além do `result.xls`, mande **uma captura de tela** deste caso — a
correspondência entre rótulo e código na tela é a evidência que permite
decifrar os offsets.

---

## G015 — rótulo vindo de DBF externo *(sem previsão)*

**Semântica:** uma opção do DEF cujo rótulo não vem de CNV, e sim de outro
DBF (`DBF\TCNESAC.DBF`, campo `NOMEFANT`). Nunca exercitado, não implementado
no nosso motor.

**Configuração:**

- Linha: **Hospital AC (CNES)**
- Coluna: nenhuma · Incremento: Frequência · Seleções: nenhuma
- Suprimir zeros: **ligado**

**Não tenho previsão.** Como o DBF é do Acre e o dado também, devem aparecer
nomes de hospital de verdade. Se aparecer só código sem nome, isso também é
resultado válido — anote.

---

## G017 — múltiplos incrementos *(pode não existir)*

**Semântica:** mais de um incremento na mesma tabulação (ex.: Frequência +
Valor Total + Óbitos), cada um virando sua própria coluna.

**Antes de tentar:** na lista de Incremento, veja se dá para marcar **mais de
um**. **Se só permitir um, pule este caso e me avise** — eu risco o item da
fila. Não force nada.

Se permitir:

- Linha: **Complexidade do Procedimento**
- Coluna: nenhuma
- Incrementos: **Frequência + Valor Total + Óbitos**
- Suprimir zeros: **desligado**

**Não tenho previsão** — nosso motor só suporta uma medida por tabulação. É
justamente o oráculo que o projeto está esperando (item
`r06-1-multiple-increment-layout-and-totals-await-oracle`) para saber a ordem
das colunas e o que acontece com o Total antes de implementar.

---

## 2. O que salvar

Para cada caso, em
`C:\projetos\tabwin-private\oracle\g0XX-capture\reference-tabwin415\`
(as pastas `g006`, `g008`, `g010`, `g012`, `g015`, `g017`, `g018` já existem):

| Arquivo | Obrigatório? | O quê |
| --- | --- | --- |
| `result.xls` | **sim** | a exportação do TabWin, mesmo formato dos anteriores. É o oráculo. |
| `recipe.txt` | sim | texto simples: linha, coluna, incremento, seleções, estado de cada caixa |
| `capture-notes.md` | sim | o que te surpreendeu, diálogo que apareceu, número que não bateu |
| `screenshot.png` | **G012 sim**, resto opcional | |
| `result.tab` | opcional | alimenta a arqueologia do `.TAB` depois |

Pode zipar tudo junto e mandar, como fez da última vez.

---

## 3. As três regras que importam

1. **Não edite nem reordene linhas** antes de exportar.
2. **Se um número não bater com a previsão, não conserte — me avise.** O
   número do TabWin é o certo por definição; o meu é que está sob teste.
   Divergência é evidência, não erro. Foi assim que o G003 achou dois bugs
   reais na primeira bateria.
3. **Se alguma opção não existir na interface como descrevi, pare e me fale**
   em vez de improvisar um substituto. Foi assim que descobrimos que o
   `Caráter atendimento` não tinha caminho sem CNV.

---

## 4. O que continua bloqueado, e por quê

Não tente estes — não há arquivo real que os sustente:

| Caso | Falta |
| --- | --- |
| G009 faixas numéricas (`F`) | o único CNV de faixa do bundle (`PERM.CNV`) **não é referenciado** pelo `RD2008.DEF` |
| G011 linha não totalizável (`#`) | **zero** ocorrências de `#` nas 865 CNVs do bundle |
| G014 diretiva `G` | zero diretivas `G` no `RD2008.DEF` |
| G019 diretiva `T` | zero diretivas `T` no `RD2008.DEF` |
| G013 deslocamento de campo | zero opções com posição inicial ≠ 1 |
| G021 múltiplos meses | falta um segundo DBC do mesmo esquema |
| G016 integração com R | precisa de sessão R real |

Um item sem ativo real não pode virar golden por suposição — a regra vale para
a fila inteira (`GOLDEN_CORPUS_QUEUE.md` §5).
