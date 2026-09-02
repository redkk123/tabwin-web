# Comparar com o microdatasus

Como medir o TabWin Web contra o `microdatasus` sem produzir um número que não
quer dizer nada.

## A assimetria que precisa ficar explícita

O `microdatasus` fala **FTP**. O TabWin Web roda num navegador, e navegador não
fala FTP desde 2021 — o Chrome removeu o suporte. Por isso o caminho aqui é
outro: pedir ao portal do DATASUS que **monte um `.zip`** com o arquivo, esperar
essa montagem, baixar o pacote e abri-lo.

Medido em 2026-09-02 com o `DNBR2025.dbc` (108 MB), a montagem levou de 11,1 a
12,3 segundos, consistente em dez tentativas. Esse tempo **não existe** do lado
do R.

Não é um detalhe de implementação que dê para otimizar: é consequência de onde
cada ferramenta roda. Some ou não some essa fase conforme a pergunta:

- **"Quanto tempo até eu ter o dado na mão?"** — some. É o que a pessoa espera.
- **"Qual descomprime mais rápido?"** — não some. Compare só a leitura do DBC.

## Rodando os dois lados

No Debian do Android:

```bash
Rscript scripts/bench-microdatasus.R 2023 BR
```

O script separa download, leitura e tabulação, e imprime tamanho do arquivo,
registros e campos para conferir que os dois lados leram a mesma coisa.

No TabWin Web, abra o mesmo arquivo pelo **Buscar no DATASUS** e vá à aba
**Auditoria**. O campo `temposDaAquisicao` traz as mesmas fases:

```
"temposDaAquisicao": [
  "preparo no DATASUS: 11.42s (33%)",
  "download: 21.87s (63%)",
  "impressão SHA-256: 0.14s (0%)",
  "leitura do DBC: 1.31s (4%)"
]
```

## O que confere se a comparação é válida

Antes de comparar tempos, compare o que foi lido. Se estes três não baterem, os
tempos não são comparáveis:

- **registros** — o R imprime `nrow`; o app mostra nas estatísticas do arquivo;
- **campos** — `ncol` contra o mesmo número no app;
- **tamanho do arquivo** — o `.dbc` tem de ter os mesmos bytes dos dois lados.

O app também mostra o **SHA-256** do arquivo aberto. Se você quiser rigor,
compare com `sha256sum` do `.dbc` que o R baixou: hashes iguais provam que os
dois abriram exatamente o mesmo arquivo, e não duas versões do mesmo nome.

## Onde cada um deve ganhar

Uma previsão honesta, para o resultado não ser lido como torcida:

- **Download**: o R deve ganhar, porque não paga a montagem do pacote. O app
  compensa parte disso com quatro conexões paralelas — o DATASUS limita por
  conexão, e isso rendeu 1,85x sobre uma conexão só (medido; acima de quatro
  não melhora e começa a falhar).
- **Leitura do DBC**: aqui a disputa é real. O `read.dbc` é C compilado; este
  aplicativo é TypeScript num worker. Se o TypeScript ficar perto, é um bom
  resultado; se ficar muito atrás, é um alvo de otimização legítimo.
- **Tabulação**: comparar `table()` do R com a tabulação daqui mede coisas
  diferentes — a daqui produz rótulos, totais e regras de compatibilidade com o
  TabWin 4.15. Trate como referência, não como empate técnico.

## O que o número não mede

O `microdatasus` precisa de R instalado, dos pacotes e de um ambiente que fale
FTP. Num celular isso significou instalar o Debian. O TabWin Web precisa de uma
aba. Isso não aparece em nenhum cronômetro e é, para a maior parte de quem usa
DATASUS, a diferença que decide.
