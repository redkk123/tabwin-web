# Segunda bateria de captura — G006 a G023, todos os números prestados

**Status:** PRONTO PARA CAPTURA — 2026-08-29
**Quem executa:** você, no TabWin 4.15 real. Eu monto os fixtures depois.

Leia primeiro `G001_CAPTURE_PROTOCOL.md` — as regras comuns (critério de
aprovação, classificação de falha, hashing) não são repetidas aqui.

Esta bateria só foi possível porque em 2026-08-29 foram baixados, pelo fluxo
oficial: o **bundle auxiliar do SIH** (865 CNVs, 16 DEFs, 267 DBFs de
lookup), o **RDAC2402.dbc** (segundo mês) e o **SPAC2401.dbc** (serviços
profissionais). Antes disso, **oito** destes casos eram impossíveis por falta
de arquivo real — não por falta de esforço.

---

## 1. Prestação de contas: G006 a G023, sem furos

| # | Semântica | Situação |
| --- | --- | --- |
| G006 | não classificados | **CAPTURAR** — destravado por `BR_PNDR.CNV` |
| **G007** | precedência de CNV curto | ✅ **já provado, não capturar** — ver §2 |
| G008 | CNV literal (`L`) | **CAPTURAR** — `BR_CAPITAL.CNV` |
| G009 | faixas numéricas (`F`) | **CAPTURAR** — destravado por `PERM.CNV` + `AIH_MA.DEF` |
| G010 | hierarquia de subtotal | **CAPTURAR — prioridade máxima** |
| **G011** | linha não totalizável (`#`) | ⛔ **bloqueado** — zero ocorrências de `#` nas 865 CNVs |
| G012 | formato novo `N` | **CAPTURAR** (sem previsão) — `NATJUR.CNV` |
| **G013** | deslocamento de campo | ⛔ **bloqueado** — ver §3, testado e degenerado |
| G014 | diretiva `G` (freq. ponderada) | **CAPTURAR** — destravado por `SPAC2401.dbc` |
| G015 | rótulo vindo de DBF externo | **CAPTURAR** (sem previsão) — `TCNESAC.DBF` |
| **G016** | rodapé/título enviados ao R | ⛔ **bloqueado** — precisa de sessão R real |
| G017 | múltiplos incrementos | **TENTAR** — pode não existir na interface |
| G018 | duas seleções simultâneas | **CAPTURAR** |
| G019 | diretiva `T` (variável tripla) | **OPCIONAL** — ver §4, valor baixo |
| **G020** | tipos de total | 🚫 **fora de escopo por decisão** — ver §5 |
| G021 | múltiplos meses combinados | **CAPTURAR** — destravado por `RDAC2402.dbc` |
| **G022** | encoding / acentuação | ✅ **já provado, não capturar** — ver §2 |
| G023 | `.TAB` salvar/reabrir | **CAPTURAR** — um clique a mais, ver §6 |

**10 para capturar.** Não precisa ser tudo de uma vez — cada um é
independente. Se puder fazer só alguns, siga a ordem da §7.

---

## 2. Os dois que já estão provados (G007 e G022)

Não capture. Registrado aqui para a fila não ficar com furo.

**G007 — precedência de CNV curto.** O `COMPLEX2.CNV` já faz exatamente
isso: declara o fallback `00-99` na **primeira** linha e os códigos
`01`/`02`/`03` depois, e a regra específica vence. G001 e G005 passam com
tolerância zero em cima disso. Foi essa mesma estrutura que fez aparecer o
bug de precedência no editor de CNV em 2026-08-29 (linhas ordenadas por
sequência em vez de ordem de regra). Semântica exercitada e provada.

**G022 — encoding/acentuação.** `Atenção Básica`, `Média complexidade`,
`Urgência`, `São Paulo` fazem round-trip byte a byte nos cinco goldens já
aprovados, em Windows-1252. Provado.

---

## 3. G013 — bloqueado, e por quê (foi testado, não presumido)

Nenhuma opção do `RD2008.DEF` usa posição inicial ≠ 1. Procurei nos outros
15 DEFs do bundle e testei as duas candidatas reais contra o nosso DBC:

- `RD.DEF` → "Ano/mês processam", `ANO_CMPT` posição 3, `ANOMES.CNV`.
  `ANO_CMPT` neste arquivo vale `"2024"`; a partir da posição 3 sobra `"24"`,
  que a CNV não reconhece. **0 registros classificados.**
- `AIH_MA.DEF` → "Mês Intern", `DT_INTER` posição 3, `MESES.CNV`.
  `DT_INTER` vale `"20240118"`; a partir da posição 3 sobra `"24"`, que não é
  mês. **4.315 registros, todos em "Ignorado"** — uma linha só.

Os dois produzem tabela degenerada, que não prova nada sobre deslocamento e
ainda poderia mascarar erro. Fica bloqueado até aparecer um DEF cujo
deslocamento case com o layout real de algum campo deste DBC.

---

## 4. G019 — opcional, valor baixo

O `AIH_MA.DEF` tem 14 diretivas `T` (mesma declaração serve linha, coluna e
seleção). Nós já parseamos `T` e expandimos para os três papéis, e isso já
tem teste unitário. Um golden aqui provaria pouco além do que já se sabe.

Se quiser fazer mesmo assim, é barato: com o `AIH_MA.DEF` carregado, tabule
**Sexo** como linha e depois **Sexo** como coluna, e confirme que a mesma
entrada aparece nas duas listas. Baixa prioridade.

---

## 5. G020 — fora de escopo por decisão

Tipos de total (soma/produto/média/inicial/final/mín/máx) **não são
comportamento do TabWin 4.15 legado** — são a suíte moderna de operações
pós-tabela que já existe e já tem testes unitários próprios. Um golden aqui
provaria que o TabWin antigo fazia isso, o que ninguém afirmou. Só entra na
fila se aparecer evidência de que o 4.15 tinha essas mesmas políticas.

---

## 6. G023 — um clique a mais em qualquer caso

**Correção:** eu tinha deduzido que você já tinha `.TAB` salvos, porque o
cabeçalho dos exports da primeira bateria mostra
`TabWin:C:\...\gol\g002.tab`. Isso era só o TabWin ecoando um nome de
trabalho, não prova de arquivo gravado. Dedução minha, errada.

Então: em **qualquer um** dos casos abaixo, depois de gerar a tabela, use
**Salvar** e escolha o formato `.TAB`, além do `result.xls` normal. Um só já
serve para começar.

Por que vale: o formato do container é desconhecido e a arqueologia começa
por leitura. Ter o `.TAB` de um caso cujo resultado eu já conheço número por
número é o melhor material possível para decifrá-lo — eu sei o que tem
dentro antes de abrir.

Se der trabalho ou o diálogo não oferecer `.TAB`, deixa pra lá e me avisa —
é o item de menor prioridade da lista.

---

## 7. Ordem sugerida

1. **G010** — maior valor, único onde já suspeito de bug nosso
2. **G014** — segundo maior, e o total tem conferência cruzada com o G001
3. **G021** — barato, e cobre combinação de arquivos
4. **G006**, **G008**, **G009**, **G018** — todos com previsão fechada
5. **G012**, **G015** — sem previsão, captura para descobrir
6. **G017** — só se a interface permitir
7. **G019** — se sobrar vontade

---

## 8. Antes de começar

**Feche e reabra o TabWin 4.15** para ele reler a pasta. Tudo já está em
`C:\projetos\tabwin-private\oracle\tabwin415\app\G001\`:

| Arquivo | Bytes | SHA-256 (32 primeiros) |
| --- | ---: | --- |
| `RDAC2401.dbc` | 313.213 | `41B7AD58932CD56D6C60455CBF67E799` |
| `RDAC2402.dbc` | 316.988 | `7FB69A40C85B69FAF9493E3D11010B4D` |
| `SPAC2401.dbc` | 914.039 | `DA880DC9A57E6201CE78519074741697` |
| `RD2008.DEF` | 33.581 | `15376FB2E56917B4122FA475B15F1E27` |
| `AIH_MA.DEF` | 3.845 | `C05E368467C40EDDE3A58C6EF4D490C2` |
| `SP2008.DEF` | 19.376 | `7744873B2324ED37CC281AD87AB51EA9` |
| `CNV\COMPLEX2.CNV` | 265 | `680EB03BD06964CF4DAE4B571BC75799` |
| `CNV\BR_PNDR.CNV` | 79.173 | `8390C187AFD4DB9314250D7DE8385F18` |
| `CNV\BR_CAPITAL.CNV` | 1.927 | `C7C0A847FB7D4E35308D7CFD971681C4` |
| `CNV\BR_REGIAOUF.CNV` | 2.186 | `D1C9C9B3FB9E715F60BE00CEEC7C0DBF` |
| `CNV\NATJUR.CNV` | 10.663 | `11016C1A9821D27FB5F5341F68366FE2` |
| `CNV\PERM.CNV` | 800 | `6DA4C99C15E1261BCFCD5CE0E4D2260A` |
| `CNV\CID10CAP.CNV` | 1.680 | `A8D276B6EFE96E84A805A789C384CBA7` |
| `DBF\TCNESAC.DBF` | 4.364 | `F6B94CDE41B1184DFA1A32A34FCF0279` |

**As previsões não são o golden.** O golden é o que o TabWin mostrar. Elas
existem só para você conferir na hora e para uma divergência aparecer na
mesma hora, em vez de depois.

---

# OS CASOS

## G010 — hierarquia de subtotal ⭐ prioridade máxima

**Arquivo:** `RDAC2401.dbc` · **DEF:** `RD2008.DEF`

No `BR_REGIAOUF.CNV` as regiões têm código `XX`, que **nunca** casa com UF
real. O valor da região não vem de registro: vem da soma dos filhos.

- Linha: **Região/UF de Residência** · sem coluna · Frequência · sem seleção
- Suprimir linhas zeradas: **ligado**

Previsto — 16 linhas:

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

### ⚠️ Anote o Total com atenção especial

Cada registro aparece **duas vezes** (na UF e na região). Somando tudo dá
**8.630** = 2 × 4.315. **Hoje o nosso motor mostraria 8.630. Suspeito que o
TabWin mostre 4.315.** Se mostrar, achamos um bug real nosso e este caso se
pagou sozinho. Anote o número exato, seja qual for, e não mude nada.

---

## G014 — diretiva `G`, frequência ponderada ⭐

**Arquivo:** `SPAC2401.dbc` *(o de serviços profissionais, não o RD)*
**DEF:** `SP2008.DEF`

O `SP2008.DEF` declara `G SP_U_AIH`: cada registro contribui com o valor
desse campo em vez de 1. O arquivo tem 49.338 registros de procedimento, mas
`SP_U_AIH` só vale 1 uma vez por AIH — então a soma é o número de AIH.

- Linha: **Diagnóstico CID10 (capítulo)** · sem coluna · Frequência
- Suprimir linhas zeradas: **ligado**

Previsto — 20 linhas, **Total 4.315**:

```text
I.   Algumas doenças infecciosas e parasitárias      274
II.  Neoplasias (tumores)                            180
III. Doenças sangue órgãos hemat e transt imunitár     65
IV.  Doenças endócrinas nutricionais e metabólicas     85
V.   Transtornos mentais e comportamentais           127
VI.  Doenças do sistema nervoso                       79
VII. Doenças do olho e anexos                          9
VIII.Doenças do ouvido e da apófise mastóide           7
IX.  Doenças do aparelho circulatório                307
X.   Doenças do aparelho respiratório                291
XI.  Doenças do aparelho digestivo                   559
XII. Doenças da pele e do tecido subcutâneo          117
XIII.Doenças sist osteomuscular e tec conjuntivo       69
XIV. Doenças do aparelho geniturinário               323
XV.  Gravidez parto e puerpério                     1019
XVI. Algumas afec originadas no período perinatal      75
XVII.Malf cong deformid e anomalias cromossômicas      42
XVIII.Sint sinais e achad anorm ex clín e laborat     138
XIX. Lesões enven e alg out conseq causas externas    463
XXI. Contatos com serviços de saúde                   86
Total                                               4315
```

**O Total 4.315 é a prova:** é exatamente o total do G001, vindo de um
arquivo completamente diferente com 49.338 registros. Se o TabWin mostrar
**49.338**, ele está ignorando a diretiva `G` — anote.

---

## G021 — dois meses combinados

**Arquivos:** `RDAC2401.dbc` **+** `RDAC2402.dbc` · **DEF:** `RD2008.DEF`

Abra os dois juntos (na tela de seleção de arquivos do TabWin, marque os
dois).

- Linha: **Complexidade do Procedimento** · sem coluna · Frequência
- Suprimir zeros: **ligado**

Previsto:

```text
Média complexidade    8297
Alta complexidade      334
Total                 8631
```

Confira também, se for fácil, os dois separados — janeiro dá 4.153/162
(= G001) e fevereiro dá 4.144/172. A soma tem que fechar exatamente.

---

## G006 — valores não classificados

**Arquivo:** `RDAC2401.dbc` · **DEF:** `RD2008.DEF`

O `BR_PNDR.CNV` cobre só parte dos municípios — finalmente existe um caso
real de valor fora da cobertura da CNV.

- Linha: **Mesorregião PNDR de Resid.** · sem coluna · Frequência
- **"Não classificados": LIGADO** · Suprimir zeros: **ligado**

```text
002 Alto Solimões                          13
008 Vales do Jequitinhonha e do Mucuri       1
010 Vale do Rio Acre                     2598
Não classificados                        1703
Total                                    4315
```

Se o TabWin chamar essa linha de outra coisa ("Não class.", "Outros", ou
deixar em branco), **anote o texto exato** — o rótulo faz parte do golden.

---

## G008 — CNV de código literal (`L`)

**Arquivo:** `RDAC2401.dbc` · **DEF:** `RD2008.DEF`

Modo `L`: a **primeira** regra que casa vence — oposto do código curto dos
G001–G005, onde a última vence.

- Linha: **Capital de Residência** · sem coluna · Frequência
- **"Não classificados": DESLIGADO** · Suprimir zeros: **ligado**

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

Total **1.835**, não 4.315 — quem não mora em capital fica de fora.

---

## G009 — faixas numéricas (`F`)

**Arquivo:** `RDAC2401.dbc` · **DEF:** `AIH_MA.DEF` *(troque o DEF)*

O `PERM.CNV` classifica por **intervalo numérico** com limite superior
inclusivo, não por código.

- Linha: **Permanência** · sem coluna · Frequência
- Suprimir zeros: **ligado**

```text
0 dias        3932
1 dia           70
2 dias          57
3 dias          65
4 dias          55
5 dias          36
6 dias          29
7 dias          26
8-14 dias       43
29 dias e +      2
Total         4315
```

**Ponto de atenção:** o DEF declara posição inicial 2 para este campo, mas em
modo faixa nós ignoramos a posição e usamos o valor numérico inteiro. Se os
números do TabWin não baterem, é provável que ele aplique o deslocamento
antes de comparar — seria uma divergência real e valiosa. Anote.

---

## G018 — duas seleções simultâneas

**Arquivo:** `RDAC2401.dbc` · **DEF:** `RD2008.DEF`

- Linha: **Complexidade do Procedimento** · sem coluna · Frequência
- **Seleção 1:** Caráter atendimento → só **"01 Eletivo"**
- **Seleção 2:** Complexidade do Procedimento → só **"Alta complexidade"**
- Suprimir zeros: **desligado**

```text
Atenção Básica          0
Média complexidade      0
Alta complexidade     124
Não se aplica           0
Total                 124
```

O **124** é decisivo: cada filtro sozinho daria 2.092 ou 162. Só a
interseção dá 124 — valor já confirmado de forma independente na matriz do
G002 (Alta × Eletivo). **Se der 2.254**, o TabWin soma em vez de
intersectar: divergência enorme, me avise na hora.

---

## G012 — formato novo `N` de CNV *(sem previsão)*

**Arquivo:** `RDAC2401.dbc` · **DEF:** `RD2008.DEF`

Nosso parser **se recusa** a ler esse layout, de propósito: os offsets nunca
foram confirmados e adivinhar seria inventar semântica. O bundle tem 89
arquivos reais nesse formato.

- Linha: **Natureza Jurídica** · sem coluna · Frequência · suprimir zeros ligado

**Mande também uma captura de tela** — a correspondência entre rótulo e
código na tela é o que permite decifrar os offsets.

---

## G015 — rótulo vindo de DBF externo *(sem previsão)*

**Arquivo:** `RDAC2401.dbc` · **DEF:** `RD2008.DEF`

Rótulo não vem de CNV, vem de outro DBF (`DBF\TCNESAC.DBF`, campo
`NOMEFANT`). Não implementado no nosso motor.

- Linha: **Hospital AC (CNES)** · sem coluna · Frequência · suprimir zeros ligado

Como o DBF é do Acre e o dado também, devem aparecer nomes de hospital
reais. Se aparecer só código sem nome, isso também é resultado válido.

---

## G017 — múltiplos incrementos *(pode não existir)*

**Antes de tentar:** veja se a lista de Incremento deixa marcar **mais de
um**. **Se só permitir um, pule e me avise** — eu risco o item. Não force.

Se permitir: linha **Complexidade do Procedimento**, sem coluna, incrementos
**Frequência + Valor Total + Óbitos**, suprimir zeros desligado.

Sem previsão — nosso motor só suporta uma medida. É o oráculo que o projeto
espera para saber a ordem das colunas e o que acontece com o Total.

---

## 9. O que salvar

Para cada caso, em
`C:\projetos\tabwin-private\oracle\g0XX-capture\reference-tabwin415\`
(as pastas de todos os casos já existem):

| Arquivo | Obrigatório? |
| --- | --- |
| `result.xls` | **sim** — é o oráculo |
| `recipe.txt` — linha, coluna, incremento, seleções, estado de cada caixa | sim |
| `capture-notes.md` — o que surpreendeu, número que não bateu, diálogo que apareceu | sim |
| `screenshot.png` | **G012 sim**, resto opcional |
| `result.tab` | opcional — **um só, em qualquer caso**, já resolve o G023 (§6) |

Pode zipar tudo junto, como da última vez.

---

## 10. As três regras que importam

1. **Não edite nem reordene linhas** antes de exportar.
2. **Se um número não bater, não conserte — me avise.** O número do TabWin é
   o certo por definição; o meu é que está sob teste. Divergência é
   evidência. Foi assim que o G003 achou dois bugs reais na primeira bateria.
3. **Se alguma opção não existir como descrevi, pare e me fale** em vez de
   improvisar. Foi assim que descobrimos que o `Caráter atendimento` não
   tinha caminho sem CNV.
