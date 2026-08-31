<div align="center">

# TabWin Web

**Tabulação de microdados públicos do DATASUS no navegador.**
Sem instalar nada. Sem enviar dados para lugar nenhum.

[**▶ Abrir a aplicação**](https://redkk123.github.io/tabwin-web/) · [**📖 Manual do usuário**](./docs/product/MANUAL_DO_USUARIO.md)

</div>

---

Reimplementação local e auditável dos fluxos analíticos do **TabWin 4.15** do
DATASUS. Lê os arquivos que você já usa — `.DBC`, `.DBF`, `.CSV` — e os
metadados legados `.DEF`, `.CNV` e `.MAP`. Roda igual no Windows, macOS,
Linux e Android, porque roda no navegador.

> Esforço independente e não oficial de modernização. Não é afiliado ao DATASUS
> nem ao Ministério da Saúde, e não é endossado por eles.

## Seus dados ficam no seu aparelho

Não é slogan, é como o programa funciona. A leitura e o cálculo acontecem no
navegador; nenhum microdado, resultado ou consulta sai da máquina. Quando você
busca no catálogo oficial, o que trafega é o download do DATASUS **para você**.

Depois que o arquivo abriu, nem internet é necessária.

## O que ele faz

| | |
| --- | --- |
| **Tabular** | linha × coluna, medidas, filtros, DEF/CNV executáveis, múltiplos arquivos e períodos |
| **Transformar** | pipeline de 11 verbos no estilo dplyr — inclusive semana epidemiológica (MMWR/MS) e código IBGE de município |
| **Calcular** | fórmulas estilo Excel, 57 funções, com nomes em português e inglês |
| **Visualizar** | gráficos editáveis e mapas temáticos, com exportação SVG/PNG |
| **Analisar** | descritivas, correlação, regressão, e taxas com IC de Byar, padronização direta (DSR) e indireta (SMR) |
| **Auditar** | procedência com SHA-256, histórico da sessão, e detecção estatística de anomalias |
| **Salvar** | receitas `.twrecipe`, tabelas `.twtable`, CSV/JSON/XLSX/XML, DBF filtrado, CSV para o `microdatasus` do R |

O **manual do usuário** cobre tudo isso com o passo a passo:
[`docs/product/MANUAL_DO_USUARIO.md`](./docs/product/MANUAL_DO_USUARIO.md).

## Compatibilidade que se pode conferir

Este projeto distingue três coisas, e diz qual é qual:

- **Compatível** — verificado contra o **TabWin 4.15 real**, com arquivo real,
  resultado capturado do programa original e comparação com **tolerância zero**.
  São **16 casos** hoje, em [`fixtures/golden/`](./fixtures/golden), cada um com
  manifesto, evidência e hashes.
- **Moderno** — funcionalidade nova, que o TabWin 4.15 não tinha. Não afirma
  equivalência com nada.
- **Não verificado** — existe e funciona, mas ninguém conferiu contra o
  original.

**Nada vira "compatível" por suposição.** Um golden é imutável: quando um teste
falha, muda a implementação ou registra-se um desconhecido — nunca o golden.

### Regras que valem no código inteiro

1. **Zero nunca é fabricado.** Denominador zero, célula ilegível ou valor
   ausente viram `null` / "—". Zero é uma afirmação sobre o mundo.
2. **Nada é amostrado em silêncio.**
3. **Um padrão pode existir; um padrão invisível não.**

## Rodando localmente

```bash
npm install
npm run web:dev
```

| Comando | O que faz |
| --- | --- |
| `npm run check` | testes unitários + typecheck + build web |
| `npm run e2e` | testes ponta a ponta (Playwright) |
| `npm run web:build` | build de produção em `dist-web/` |
| `npm run seed:differential` | gera casos determinísticos para conferir contra o TabWin real |

## Estrutura

```
apps/web              a aplicação
apps/datasus-proxy    Worker Cloudflare para o CORS do catálogo oficial
packages/core         modelo, plano normalizado, execução, receitas
packages/formats      DEF, CNV, .TAB, Windows-1252, mapas, BIFF
packages/analysis     estatística, epidemiologia, transformação, fórmulas
packages/acquisition  catálogo DATASUS, lote resiliente, fallback e limites
packages/export       CSV, JSON, XLSX, XML, DBF
fixtures/golden       as capturas do TabWin 4.15 que sustentam a compatibilidade
docs/                 manual, ADRs, protocolos de captura, engenharia reversa
```

Regra de camadas: `analysis → core`. `core` **nunca** importa `analysis`.

## Origem dos dados

Os microdados são públicos e do DATASUS/Ministério da Saúde, sujeitos aos
termos de uso do órgão. Este repositório **não** redistribui microdados nem o
binário original do TabWin 4.15 — as capturas em `fixtures/golden/` são
resultados de referência, não os arquivos de origem.

> **Licença ainda não definida.** Sem um arquivo `LICENSE`, o padrão legal é
> "todos os direitos reservados": ninguém pode reusar, modificar ou
> redistribuir este código. Se a intenção é que o projeto seja utilizável por
> outras pessoas, escolher e adicionar uma licença é um passo pendente.
