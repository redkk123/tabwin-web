# R10.1 — handoff de sessão (2026-08-29, Claude → próxima sessão)

Contexto chegando no limite. Este documento é o estado completo para retomar
sem perder nada — por Claude numa próxima sessão, ou por GPT/Codex, que o
usuário está trazendo de volta a partir de 2026-09-01 (ver
`PROTOCOLO_VM_COMPARTILHADA.md`).

## 1. Onde o código está agora

`origin/main`, limpo, sem trabalho pendente não commitado. Último commit:
`54788db`. Gate: **220/220** (`npm run check`). G001 imutável, inalterado
durante toda a sessão.

Faixa 1, 2 e 3 do roadmap (`docs/product/ROADMAP_POR_COMPLEXIDADE.md`)
**inteiras concluídas**. Faixa 4 em andamento: 5 goldens capturados e
aprovados (G001–G005), segunda bateria de 10 casos com protocolo publicado e
aguardando captura do usuário.

Ambiente: Node portátil em
`C:\Users\angelogabriel860\tools\node-v24.19.0-win-x64\` — **não está no
PATH** de sessões novas de shell, precisa prefixar:
```powershell
$env:PATH = "C:\Users\angelogabriel860\tools\node-v24.19.0-win-x64;" + $env:PATH
```
Servidor dev (`npm run web:dev`) faz **reload completo de página**, não HMR
real — qualquer estado de app (dataset aberto, CNV carregada) se perde a
cada edição de `main.ts` salva. Backup script
(`C:\projetos\scripts\backup-tabwin.ps1`) funciona mas a etapa de retenção
(manter últimos 10) falha há dias num backup específico travado por lock
externo (`2026-08-28_232845_...`); não afeta os backups novos, que sempre
saem íntegros com hash conferido. Ignorável, ou destravável manualmente por
quem tiver acesso ao processo que segura o lock.

## 2. O que foi feito nesta sessão, em ordem

1. **Faixa 3.4** — diff entre execuções de tabulação (commit `5e3f9cb`)
2. **Faixa 3.3** — import de mapa via GeoJSON (commit `b02da17`)
3. **Faixa 3.2** — editor de CNV + inspetor de DEF (commit `e4e6f43`). Achou
   e corrigiu um bug real de precedência durante a própria verificação:
   categorias exibidas por sequência em vez de ordem real de regra invertia
   qual regra vence quando o fallback vem primeiro no arquivo.
4. **G002–G005** capturados pelo usuário, comparados e aprovados com
   tolerância zero (commit `3adf832`). O G003 achou dois bugs reais:
   rótulo da coluna de soma (agora vem do incremento do DEF) e 1 ULP de
   deriva de ponto flutuante numa soma de 4.153 valores (resolvido
   comparando na precisão que o próprio campo declara no DBF — não uma
   tolerância afrouxada).
5. **Bundle auxiliar oficial do SIH baixado** sem FTP nem AWS (commit
   `6c3829c`) — ver §3. Achou e corrigiu outro bug real: 53 das 865 CNVs
   oficiais eram rejeitadas por não tolerar o marcador de fim de arquivo do
   MS-DOS (`0x1A`), incluindo `UF.CNV`, `REGIAO.CNV`, `CAPITAL.CNV`.
6. **Protocolo da segunda bateria** escrito e corrigido (commits `8ba9217`,
   `193e53f`, `54788db`) — ver §4.

Cada item tem relatório de evidência em `docs/handoffs/R09_*` e `R10_0_*`.

## 3. Como baixar arquivo oficial do DATASUS sem FTP

Achado importante desta sessão, reutilizável sempre: `ftp.datasus.gov.br`
está **bloqueado** nesta VM (testado, confirmado), mas o fluxo oficial de
transferência **nunca pede que o cliente fale FTP** — ele posta em
`datasus.saude.gov.br` (que a VM alcança normalmente), o próprio DATASUS
busca no FTP dele e devolve um ZIP preparado por HTTPS.

Dois scripts prontos, reusando os parsers já verificados do repositório:

```bash
node scripts/fetch-auxiliary-bundle.mjs SIHSUS <pasta-destino>
node scripts/fetch-datasus-file.mjs SIHSUS RD 2024 02 AC <pasta-destino>
```

Validado por conferência cruzada: o `TAB_SIH.zip` baixado por este script é
**byte a byte idêntico** ao que o usuário baixou pela página web em
paralelo (SHA-256 `714ed980…`).

Resultado colhido, fora do repo em
`C:\projetos\tabwin-private\oracle\aux-sih\extracted\`: **865 CNVs únicas,
16 DEFs, 267 DBFs de lookup**. Também baixados: `RDAC2402.dbc` (segundo mês,
em `oracle/g021-assets/`) e `SPAC2401.dbc` (serviços profissionais, em
`oracle/g014-assets/`).

## 4. Segunda bateria de goldens — estado exato

Protocolo completo: `docs/testing/G006_G023_CAPTURE_PROTOCOL.md` (também
copiado para `C:\projetos\tabwin-private\oracle\COMO_CAPTURAR.md`, ao lado
das pastas de captura). Todo o número de G006 a G023 tem status explícito —
nenhum furo:

- **10 capturáveis agora**, com ativo real e hash já na instalação do
  TabWin: G006, G008, G009, G010, G012, G014, G015, G017 (condicional),
  G018, G021, G023 (basta salvar `.TAB` em qualquer um dos outros).
- **2 já provados, não precisam de captura**: G007 (precedência de CNV
  curto — já exercitado por G001/G005) e G022 (acentuação — já provado nos
  5 goldens aprovados).
- **5 seguem bloqueados, com motivo testado, não presumido**: G011 (`#`
  não ocorre em nenhuma das 865 CNVs), G013 (testei as duas candidatas
  reais de deslocamento contra o DBC; ambas produzem tabela degenerada),
  G016 (precisa de sessão R real), G019 (baixo valor, `T` já tem teste
  unitário), G020 (fora de escopo por decisão — é operação pós-tabela
  moderna, não comportamento do TabWin 4.15 legado).

Prioridade sugerida ao usuário: **G010 primeiro** — é o único onde já
suspeito de bug nosso. `BR_REGIAOUF.CNV` tem linhas de região com código
`XX` (nunca casa com UF real; o valor vem só do rollup dos filhos via
`subtotalTarget`). Cada registro aparece duas vezes na tabela hoje, e nosso
`calculateColumnTotal` (`packages/analysis/src/table-operations.ts:278`)
só exclui linhas marcadas com `#` — que não existe em nenhuma CNV real do
bundle. Suspeito que o TabWin exclua linhas de subtotal do total por outro
critério (talvez `subtotalTarget !== undefined`). **Não mexi no código
ainda** — é para o resultado da captura decidir, não suposição.

**Quando os arquivos chegarem** (o usuário disse que vai mandar para
GPT/Codex, não necessariamente para esta mesma sessão): montar os fixtures
seguindo exatamente o padrão de `scripts/verify-goldens-local.mjs` e
`gen-fixtures.mjs` desta sessão (o segundo não foi commitado, era um
descartável — recriar do zero seguindo a estrutura de
`fixtures/golden/G002` como referência é mais seguro que tentar reconstruir
o script exato). Normalizar cada `result.xls` com `parseTabWinBiffExport`,
nunca confiar cegamente no golden gerado — sempre comparar contra o
executor real via `compileQueryPlan`/`executeInMemory` antes de commitar.

## 5. Duas ideias do usuário, ainda não trabalhadas

Registradas aqui exatamente como recebidas, para não se perderem.

### 5.1 "microdatasus baixável e filtrável pelo nosso app"

Referência ao pacote R `microdatasus`, que baixa microdados do DATASUS já
decodificados e com colunas traduzidas para nome legível. **Boa parte disso
já existe no app** — catálogo por sistema/tipo/ano/mês/UF, download oficial,
decodificação DBC→DBF, aplicação de CNV/DEF, e agora os dois scripts de
aquisição sem FTP (§3). O que meu chute é que ficou faltando, mas **não
confirmei com o usuário**:

- baixar e **combinar** múltiplos períodos/UFs de uma vez como um dataset
  único filtrável, não tabulado — hoje dá para abrir vários DBC juntos
  (`combine-compatible-files`), mas não há um fluxo de "baixe SIH-RD de
  todo o AC em 2024 inteiro, filtrado por X, exportado como linhas" numa
  única ação;
- exportar **registro a registro** (não agregado) com os rótulos de CNV já
  aplicados como colunas legíveis — hoje `Extrair DBF original`/`Salvar
  seleção em DBF` exportam o dado bruto, não decodificado.

Antes de implementar qualquer coisa: **perguntar ao usuário o que
especificamente ele quer** — o parágrafo acima é minha leitura, pode estar
errada ou incompleta.

### 5.2 A segunda ideia — perdida, não anotada a tempo

O usuário disse "esqueci a outra" e não voltou a mencionar. **Não inventar
o que era.** Perguntar diretamente na próxima sessão: *"você tinha
mencionado uma segunda ideia (além do microdatasus) que esqueceu na hora —
lembrou depois?"*

## 6. Arquivos e pastas fora do repositório (não versionados)

Tudo em `C:\projetos\tabwin-private\`, nunca commitado (grande, sujeito a
redistribuição):

- `oracle/g001-assets/` — RDAC2401.dbc, RD2008.DEF, 4 CNVs do G001, hashes
  em `acquisition-manifest.json`
- `oracle/aux-sih/extracted/` — bundle auxiliar oficial completo (865 CNV /
  16 DEF / 267 DBF)
- `oracle/g021-assets/RDAC2402.dbc`, `oracle/g014-assets/SPAC2401.dbc`
- `oracle/g0XX-capture/reference-tabwin415/` — uma pasta por caso golden,
  destino onde o usuário salva `result.xls`/`recipe.txt`/`capture-notes.md`
- `oracle/tabwin415/app/G001/` — a instalação real do TabWin 4.15 que o
  usuário opera, com todos os DEF/CNV/DBF desta sessão já copiados para
  dentro (`CNV\`, `DBF\`, raiz)
- `COMO_CAPTURAR.md` — cópia do protocolo, ao lado das pastas de captura

## 7. Protocolo de convivência com GPT/Codex

`C:\projetos\LOCK.md` está **livre** (nenhum arquivo travado no momento).
`C:\projetos\OPERACOES_LOG.md` está em dia até este commit. Ver
`PROTOCOLO_VM_COMPARTILHADA.md` para as regras completas — resumo: travar
antes de mexer, backup antes de commit de risco, log sempre, nunca forçar
push, sincronizar (`git fetch`) antes de qualquer commit.
