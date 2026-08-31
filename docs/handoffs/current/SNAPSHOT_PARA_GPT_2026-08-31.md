# TabWin Web — snapshot de estado (2026-08-31)

Documento de contexto para consulta externa. Descreve **onde o projeto está**,
não o que ele pretende ser.

## O que é

Reimplementação local-first, no navegador, do TabWin 4.15 do DATASUS. Nenhum
dado sai da máquina do usuário: DBC/DBF, DEF e CNV são lidos no cliente.
Monorepo TypeScript, sem framework de UI.

- `packages/core` — modelo, plano normalizado, execução da tabulação, receitas
- `packages/formats` — DEF, CNV, `.TAB`, Windows-1252, mapas, BIFF
- `packages/analysis` — estatística, epidemiologia, pipeline de transformação,
  fórmulas estilo Excel, auditoria de anomalias
- `packages/acquisition` — DATASUS (proxy CORS próprio), microdatasus
- `packages/export`, `packages/visualization`
- `apps/web` — a aplicação; `apps/datasus-proxy` — Worker Cloudflare

Regra de camadas: `analysis → core`. `core` **nunca** importa `analysis`.

**Estado do gate:** 442/442 testes unitários, 29/29 E2E, typecheck e build web
limpos. `origin/main` em `452d29e`.

## Corpus de goldens — a segunda bateria FECHOU

16 goldens capturados do TabWin 4.15 real e verificados com tolerância zero:
G001–G006, G008, G009, G010, G012, G014, G015, G017, G018, G021, **G023**.

Os demais do intervalo G001–G023 **não são pendência**:

| | situação |
| --- | --- |
| G007, G022 | já provados por outro caminho (G007 é implícito no G001; G022 pelo texto acentuado do `RDAC2401.dbc`) |
| G011 | bloqueado — **zero** ocorrências de `#` nas 865 CNVs disponíveis |
| G013 | bloqueado — foi testado, não presumido; o caso real degenera |
| G016 | bloqueado — precisa de sessão R real |
| G019 | opcional, valor baixo |
| G020 | fora de escopo por decisão — é operação pós-tabela moderna, não comportamento do TabWin legado |

### Achado mais recente (G023, 31/08): o `.TAB` não é binário

O primeiro artefato `.TAB` real do corpus **corrige uma suposição de trabalho**
em vez de confirmá-la. O formato é:

- texto **Windows-1252**, CRLF, **sem BOM**;
- abre na linha literal `NEW`;
- preâmbulo `chave=valor` (`Titulo2=`), depois seções `[Opções]` e `[Arquivos]`;
- `[Opções]`: `DEF`, `PATH`, `Linha`, `Coluna`, `Incremento`,
  `Suprime_Linhas_Zeradas`, `Suprime_Colunas_Zeradas`, `Não_Classificados`;
- `[Arquivos]`: nomes de arquivo soltos + `Registros_Processados=` +
  `Tempo_Decorrido=`;
- depois uma matriz `;`-separada com aspas, com as linhas/colunas de Total do
  próprio TabWin.

`legacy-tab.ts` tinha sido escrito como reconhecimento **binário** justamente
porque não havia arquivo real — ele nunca afirmou saber reproduzir o painel, e
já listava `plain-text` entre as hipóteses que sabia relatar. Agora existe
amostra, e o leitor real (`packages/formats/src/tab-file.ts`) entrou por cima.

**Por que a prova é forte:** o `.TAB` foi salvo na mesma execução que gerou o
G002, cujo resultado já era conhecido célula por célula por um caminho de
exportação independente (o BIFF `result.xls`). O leitor não foi validado contra
a própria leitura de um arquivo desconhecido — foi conferido contra golden
anterior e separado. Bate exatamente, incluindo os totais do TabWin
(`[2092,2223,0,0,0,0]`) e o total geral 4315 = `Registros_Processados`.

**O que deliberadamente não foi inventado:** o marcador `NEW` (uma amostra não
distingue token de versão de literal fixo), o código `Não_Classificados=0`, o
`Titulo1` que este arquivo não traz, e formatação decimal — todas as células
aqui são inteiras. Escrever `.TAB` segue fora de escopo: exige campos provados
estáveis em vários artefatos, e um não são vários.

## Capacidades entregues (R06–R12)

- **Tabulação compatível**: plano normalizado, perfil `tabwin-4.15`, DEF/CNV
  executáveis, múltiplos incrementos, múltiplas seleções, supressão de zeros,
  política de não classificados, múltiplos arquivos/períodos
- **Pipeline de transformação** (11 verbos, estilo dplyr): recode, normalização
  de texto, marcação de ausentes, filtro, dedupe, drop, campo calculado,
  group-summarize, bind-rows, join, partes de data / semana epidemiológica.
  Inclui **"ver código equivalente"** em dplyr e pandas, sem executar nada
- **Fórmulas estilo Excel** — registro fechado de 32 funções, que é a fronteira
  de segurança: nome fora do registro é recusado no parse
- **Epidemiologia** — taxas brutas com IC de Byar, padronização direta (DSR) e
  indireta (SMR), razão de taxas padronizadas. **Nenhuma população padrão
  embutida**, de propósito: o usuário fornece a dele via `join`, para o sistema
  não fabricar números de referência
- **Auditoria estatística de anomalias** — detecção por *forma* estatística
  (concentração, ausência diferencial, dígito terminal), não por assunto
- **Comparação de tabelas**, alinhando por chave e reportando o que não casou
- **Gráficos e mapas temáticos**, seleção espacial, fluxos OD
- **Receitas** (`.twrecipe`) — carregam o pipeline de transformação junto,
  senão a receita reconstruiria outra tabela enquanto afirma fidelidade à fonte
- **Aquisição DATASUS** via proxy CORS próprio, com cache, retomada e hashes
- **Dicionário de rótulos** DATASUS (~70 campos SINAN/SIM/SINASC/SIH/CNES), em
  camadas: rótulo do DEF vence, dicionário em segundo, nome técnico por último
- **Gerador diferencial por seed** (`npm run seed:differential`) — emite `.dbf`
  real, `.cnv`, plano e o resultado *deste* motor, byte-idêntico por seed

## O que falta

**Depende de quem tem o TabWin 4.15 instalado (não dá pra destravar daqui):**

1. **Metade-oráculo do diferencial por seed.** O gerador está pronto e é função
   pura da seed. Falta abrir os mesmos `.dbf` no TabWin real e comparar. O
   gerador não decide quem está certo — de propósito.

**Fila normal:**

2. **UI mais séria e limpa** — em andamento agora. Referência declarada em
   `docs/government/FEDERAL_UI_PROFILE.md`: componentes acessíveis primeiro,
   tokens visuais substituíveis, e **não** imitar a identidade gov.br a ponto
   de sugerir status oficial que o projeto não tem
3. **Manual do usuário** — definido para o final
4. `duckdb-wasm` sob demanda; continuar as famílias catalogadas do 4.15;
   ampliar gráficos e mapas

**Dívida documental conhecida:** `docs/product/REMAINING_IMPLEMENTATION_PLAN.md`
está com baseline R05.1 e lista como pendentes blocos entregues até R12. Não
foi marcado `COMPLETE` de memória — isso exigiria a mesma evidência que
qualquer outra afirmação de compatibilidade — mas levou aviso de defasagem no
topo até a reconciliação bloco a bloco.

## Regras que o projeto não negocia

Valem para qualquer contribuição, humana ou automática:

1. **Golden é imutável.** Falha de candidato muda a implementação ou registra
   um desconhecido. Nunca se edita o golden para o teste passar.
2. **Nada vira "compatível" por suposição.** Exige fixture real + plano
   normalizado esperado + teste + comparação golden quando houver oráculo.
3. **Nunca fabricar um zero.** Denominador zero, célula ilegível, valor ausente
   → `null` / "—". Zero é uma afirmação sobre o mundo.
4. **Nunca amostrar em silêncio.** "Default pode existir; default invisível
   não."
5. **Ativos privados do oráculo não entram no repositório** (TabWin 4.15,
   `.dbc` de origem, DEF/CNV proprietários). Capturas de referência entram como
   evidência; os binários de origem, não.
6. **Camadas:** `core` nunca importa `analysis`.
