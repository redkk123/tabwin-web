# RE-000 — Mapa de métodos publicados do TabWin 4.15

**Data:** 2026-08-30
**Binário:** `TabWin415.exe`, PE32 i386, 1.927.680 bytes,
SHA-256 `0E29A44DE78D164CE13FAA73EC74B76C77041FCF3D8BF6374A893B5E6A713F02`.
**Ferramenta:** `scripts/inspect-delphi-methods.mjs` (deste repositório).
**O binário não está e não entra no repositório.** Ele é ativo privado do
oráculo, como todo o resto de `tabwin-private`.

## Por que este relatório existe antes do RE-001

O guia `TABWIN_IDR_GHIDRA_RE_GUIDE.md` divide o trabalho assim: uma passada
humana no IDR recupera **classe, método, endereço**, e só depois o Ghidra abre
esses endereços. O guia chama isso de gargalo.

Não é. O TabWin 4.15 é Delphi/VCL 32-bit e **as tabelas de métodos publicados
estão intactas no arquivo**. Uma entrada tem forma fixa:

```text
Word        tamanho da entrada, incluindo este campo
Pointer     endereço de código do método
ShortString nome (1 byte de comprimento + caracteres)
```

Então, para um nome que começa no offset `N` com comprimento `L` guardado em
`N-1`, o endereço está no dword little-endian em `N-5` e o tamanho em `N-7`. O
script exige `tamanho == 2 + 4 + 1 + L` **e** que o endereço caia dentro de uma
seção mapeada do PE. Essas duas checagens são o que mantém string comum fora do
resultado.

Resultado: **469 métodos publicados em 40 tabelas**, com endereço virtual, sem
IDR, sem Java e sem Ghidra. Reprodutível:

```bash
node scripts/inspect-delphi-methods.mjs <caminho>/TabWin415.exe Salvar1Click
```

`imageBase = 0x400000`.

## Alvos do guia, localizados

### `TTabula` — tabela em 0x15DB20, 102 métodos

O maior formulário do programa, e o que interessa para RE-001 e RE-003.

| Método | Endereço |
| --- | --- |
| `Abrir1Click` | `0x00564988` |
| `Salvar1Click` | `0x00564D94` |
| `Tabula1Click` | `0x00567C30` |
| `Grafico1Click` | `0x00566EA0` |
| `Graficovazio1Click` | `0x0056D41C` |
| `Mapa1Click` | `0x00566FA4` |
| `IncluiPRN1Click` | `0x00566A14` |
| `SupLinhas1Click` | `0x00567654` |
| `EditarLog1Click` | `0x0056E690` |
| `Ordenar1Click` | `0x00564EFC` |
| `Acumula1Click` | `0x00564F44` |
| `percentagem1Click` | `0x005651CC` |
| `Total1Click` | `0x005661F0` |
| `Decimais1Click` | `0x00566368` |
| `Fator1Click` | `0x005661D0` |

### `TMapa` — tabela em 0x13F67F, 56 métodos

| Método | Endereço |
| --- | --- |
| `IntervalosIguais1Click` | `0x0054CEB4` |
| `IgualFrequencia1Click` | `0x0054CEF8` |
| `PegaLegendaDoMapa1Click` | `0x0054CF64` |
| `PoeCamadaClick` | `0x00546258` |
| `BLegendaClick` | `0x0054622C` |
| `ImportaShapeFile` | `0x0054BF60` |
| `ImportaBNAClick` | `0x00549168` |
| `ImportaE00Click` | `0x0054B510` |
| `ImportaMIFClick` | `0x005498C8` |
| `ImportaGarminWaypoint` | `0x00548204` |
| `GravarClick` | `0x00547498` |

`IntervalosIguais1Click` e `IgualFrequencia1Click` são as duas classificações
que já implementamos como `equal-interval` e `quantile`. `PoeCamadaClick` é
camada, que a 4.3 acabou de entregar como contorno de referência.

### CNV — tabela em 0x12C9D2, 4 métodos

| Método | Endereço |
| --- | --- |
| `bCNVClick` | `0x0052D668` |
| `bEditarCNVClick` | `0x0052D7C4` |
| `rColunaClick` | `0x0052D720` |
| `rgContaClick` | `0x0052D7A8` |

Alvo do RE-002. `rgContaClick` é provavelmente o seletor de modo de contagem —
relevante para a semântica de total que o G012 expôs.

### Outras classes nomeadas no guia

`TAbreDEF` (0x12C1BA), `TFFazDef` (0x11AE72), `TRGrafico` (0x125DB7) e
`TfLigaCNV` (0x11A45D) aparecem como nomes de classe; as tabelas de métodos
delas estão no dump completo do script.

## RE-001 preliminar — o `.TAB` é texto

Ainda **sem** decompilador, três evidências independentes apontam para a mesma
conclusão.

**1. Tabela de despacho por extensão em 0x15ED29**, dentro da mesma unidade em
que mora `Salvar1Click`:

```text
0x15ED29  ".PRN"
0x15ED31  ".PDB"
0x15ED39  ".CSV"
0x15ED41  ".TAB"
0x15ED49  ".XML"
0x15ED51  ".HTM"
0x15ED59  ".DBF"
```

**2. Filtros de diálogo** tratam `.tab` como texto, ao lado de `.prn` e `.csv`:

```text
"*.tab;*.prn;*.csv"
"Textos separado por vírgulas |*.prn|Tabela do TabWin|*.tab|Arquivos dBase III+|*.dbf|Comma Separated Values|*.csv"
```

**3. `HISTORIA.TXT`**, do próprio pacote 4.15, descreve dois defeitos que só
fazem sentido num formato textual delimitado com aspas:

> "Alterada a leitura do arquivo .tab e .prn para preservar os brancos a
> esquerda do título das linhas."

> "Ocorrência do caractere '"' na última posição da descrição da linha fazia com
> que houvesse perda de linhas na recuperação do arquivo salvo."

E, sobre o conteúdo:

> "a partir de um arquivo '.tab', recuperar todas as seleções que foram
> utilizadas na sua tabulação"

> "A leitura de um arquivo .TAB que tivesse mapa incluído..."

### Classificação da evidência

| Conclusão | Grau |
| --- | --- |
| `.TAB` é lido e escrito pelo mesmo caminho de código que `.PRN` | **FORTEMENTE INDICADO** |
| `.TAB` é textual e delimitado, com aspas em campos de texto | **FORTEMENTE INDICADO** |
| Um `.TAB` carrega, além da tabela, as seleções da tabulação | **PROVADO** (documentação oficial do 4.15) |
| Um `.TAB` pode conter um mapa embutido | **PROVADO** (documentação oficial) |
| Ordem dos campos, offsets e delimitador exato | **DESCONHECIDO** |
| Encoding do bloco textual | **DESCONHECIDO** (Windows-1252 é a hipótese óbvia, não testada) |

Nada disso vira especificação sem um `.TAB` real. O protocolo de captura está em
`docs/testing/TAB_CAPTURE_PROTOCOL.md`.

## Próximo passo

1. Capturar os pares `.TAB` do protocolo, uma propriedade por vez.
2. Rodar `inspectLegacyTab` e `diffLegacyTabInspections` sobre eles.
3. Só então nomear campos, e só os que o diff isolar.
4. Ghidra em `0x00564D94` (`Salvar1Click`) para confirmar o que o diff sugerir —
   confirmação, não fonte primária.
