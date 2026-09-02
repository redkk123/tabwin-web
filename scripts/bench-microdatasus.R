#!/usr/bin/env Rscript
# Mede o microdatasus nas mesmas fases que o TabWin Web relata, para que a
# comparação seja de fases equivalentes e não de números soltos.
#
# As fases:
#   1. download    — trazer o .dbc do FTP do DATASUS
#   2. leitura     — .dbc para data.frame (descompressão + parse do DBF)
#   3. tabulação   — uma tabela cruzada simples sobre o resultado
#
# O TabWin Web tem uma quarta fase que o microdatasus não tem: o DATASUS monta
# um pacote .zip antes de liberar o download, porque navegador não fala FTP
# desde 2021. Esse custo aparece separado no relatório do aplicativo e não deve
# ser somado à conta do microdatasus, que fala FTP direto.
#
# Uso:  Rscript bench-microdatasus.R [ano] [uf]
# Ex.:  Rscript bench-microdatasus.R 2023 BR

args <- commandArgs(trailingOnly = TRUE)
ano <- as.integer(if (length(args) >= 1) args[1] else 2023)
uf <- if (length(args) >= 2) args[2] else "BR"

for (pacote in c("microdatasus", "read.dbc")) {
  if (!requireNamespace(pacote, quietly = TRUE)) {
    stop(sprintf("faltando o pacote %s. Instale com install.packages('%s')", pacote, pacote))
  }
}

cronometrar <- function(rotulo, expressao) {
  inicio <- Sys.time()
  valor <- force(expressao)
  segundos <- as.numeric(difftime(Sys.time(), inicio, units = "secs"))
  cat(sprintf("  %-12s %7.2fs\n", rotulo, segundos))
  list(valor = valor, segundos = segundos)
}

cat(sprintf("microdatasus · SINASC DN · %d · %s\n", ano, uf))
cat(sprintf("R %s · %s\n\n", getRversion(), Sys.info()[["machine"]]))

# fetch_datasus faz download e leitura juntos; separar exige baixar à mão.
# Vale a pena, porque é a separação que torna a comparação honesta.
caminho <- file.path(tempdir(), sprintf("DN%s%d.dbc", uf, ano))
endereco <- sprintf(
  "ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/1996_/Dados/DNRES/DN%s%d.dbc",
  uf, ano
)

baixado <- cronometrar("download", {
  utils::download.file(endereco, caminho, mode = "wb", quiet = TRUE)
  file.info(caminho)$size
})

lido <- cronometrar("leitura", read.dbc::read.dbc(caminho, as.is = TRUE))
dados <- lido$valor

tabulado <- cronometrar("tabulação", {
  table(dados$SEXO, dados$RACACOR)
})

total <- baixado$segundos + lido$segundos + tabulado$segundos
cat(sprintf("\n  arquivo      %.1f MB\n", baixado$valor / 1048576))
cat(sprintf("  registros    %s\n", format(nrow(dados), big.mark = ".")))
cat(sprintf("  campos       %d\n", ncol(dados)))
cat(sprintf("  total        %7.2fs\n", total))
cat(sprintf("\n  células da tabela: %d\n", length(tabulado$valor)))
