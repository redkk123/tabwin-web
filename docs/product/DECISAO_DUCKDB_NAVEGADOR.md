# Decisão: DuckDB dentro do navegador?

**Data:** 2026-08-30
**Para:** ChatGPT, em modo chat, sem acesso ao repositório.
**Status:** decisão em aberto. Nada foi feito nessa direção ainda.

Este documento é autocontido. Ele tem os números reais medidos hoje, o que já
está pronto, o que a decisão desbloqueia e onde ela dói.

---

## 1. O que é o TabWin Web, em cinco linhas

Reimplementação moderna do TabWin 4.15 do DATASUS. Roda **inteiramente no
navegador**: a pessoa abre DBC/DBF/CSV do próprio aparelho, ou baixa do catálogo
oficial pelo próprio aplicativo, e os microdados **nunca saem do dispositivo**.
Não há servidor de dados. A compatibilidade com o TabWin é provada por 15 casos
golden capturados no programa original, todos passando com tolerância zero.

Publicado em <https://redkk123.github.io/tabwin-web/> (GitHub Pages, estático).

## 2. A decisão

Existe hoje um **compilador de plano para SQL DuckDB**, provado. Falta decidir
se o motor DuckDB vai rodar **no navegador do usuário**, via WebAssembly.

Isso não é escolha de implementação. É escolha de produto.

## 3. Correção de um número que circulou antes

Eu havia dito "149 MB". Esse é o pacote npm **inteiro desempacotado**, que
inclui as três variantes de build (mvp, eh, coi), os builds de Node e todos os
source maps. **Não é o que o usuário baixa.**

Medido hoje, o que um navegador moderno realmente carrega:

| Arquivo | Bruto | Gzip |
| --- | ---: | ---: |
| `duckdb-eh.wasm` | 34 MB | **~7 MB** |
| worker + wrapper JS | ~1 MB | ~0,3 MB |

**~7 MB comprimidos, uma vez, com cache do navegador depois.**

Para comparação, o que o aplicativo entrega hoje:

| | Bruto | Gzip |
| --- | ---: | ---: |
| JS da aplicação | 237 KB | 74 KB |
| CSS | 36 KB | 8 KB |
| Worker de dados | 33 KB | — |
| Mapas do Brasil (`.MAP`) | 5,2 MB | — |
| **dist-web inteiro** | **6,6 MB** | — |

Ou seja: o DuckDB comprimido é **da mesma ordem de grandeza dos mapas do Brasil
que já embarcamos**. Não é 600x a aplicação, como eu disse antes. Isso muda o
peso do argumento e é por isso que estou corrigindo.

## 4. O que já está pronto e provado

`packages/core/src/duckdb-plan.ts`:

- traduz o `QueryPlan` para SQL parametrizado;
- **recusa** 12 categorias de plano cujo significado em SQL não pode ser
  afirmado: CNV, lookup DBF, `startPosition`, unclassified discriminado, regras
  cross-field, múltiplas medidas, e qualquer soma/peso/faixa sobre campo não
  declarado numérico. Cada recusa é um *blocker* nomeado, nunca uma tradução
  aproximada;
- nenhuma categoria entra no texto do SQL — tudo é parâmetro posicional;
- tem um **portão de paridade** que compara grupo a grupo, valor a valor, e
  `recordsSeen`/`recordsAccepted`, contra o executor de referência.

`tests/duckdb-parity.test.mjs` roda o SQL gerado num **DuckDB de verdade** (Node,
dependência só de desenvolvimento) e exige números idênticos. Sete casos:

1. contagem 1D — linhas de dimensão vazia saem nos dois motores;
2. contagem 2D — registro com coluna vazia sai inteiro;
3. soma decimal — onde dois motores divergem primeiro;
4. frequência ponderada;
5. filtros incluir **e** excluir;
6. faixa numérica com limite inclusivo e **exclusivo em caso separado**;
7. categoria contendo aspas e `DROP TABLE` — prova que é parâmetro, não texto.

Um oitavo caso alimenta o portão com um agregado errado de propósito e exige que
ele **acuse**. Portão que nunca falhou não é evidência de nada.

**Conclusão já estabelecida:** o SQL que geramos concorda com o executor. Essa
prova não depende de onde o DuckDB roda.

## 5. O que a decisão desbloqueia — e aqui está o ponto novo

O dono do projeto colocou três coisas na mesa. Duas mudam a análise; a terceira já existe e estava mal registrada:

> "sobre a ideia do microdatasus, era pra ter mais filtros pro usuário, saca?
> a nível do que tu consegue fazer com o R"

> "e eu não vi uma ideia minha aí: estatística avançada"

> "e a ideia de limpeza de dados embutida não vi também"

### O que existe hoje

**Filtros:** duas formas apenas — `categories` (lista de valores aceitos, com
incluir/excluir) e `numeric-range` (mínimo/máximo, com limites inclusivos ou
exclusivos), mais regras cross-field. Combinam por interseção.

**Estatística:** quatro operações — descritiva, correlação de Pearson, regressão
linear simples e histograma.

### Limpeza de dados — isso já existe, e é preciso registrar direito

Uma terceira ideia do dono do projeto era **limpeza de dados embutida**. Ela
já está implementada há algum tempo, e ficou de fora dos resumos recentes
porque não foi tocada nesta rodada — não porque não exista.

O que existe, sob "Limpeza assistida · **não destrutiva**":

- **Perfil numérico por campo:** total, numéricos, ausentes, inválidos,
  distintos, mínimo, Q1, mediana, Q3, máximo, cercas IQR e contagem de
  outliers por IQR;
- **Sugestão automática de faixa válida** pelo critério IQR, que o usuário
  aceita, edita ou ignora;
- **Faixa válida manual** por campo;
- **Regras cross-field:** condições combinadas com ação `flag` (só conta) ou
  `exclude` (também remove da tabulação), cada uma com contagem sobre **todos**
  os registros vistos, não sobre o subconjunto já filtrado;
- **Perfil de combinações raras** entre dois campos, para achar pares
  improváveis que sinalizam erro de digitação ou de codificação.

Duas decisões de projeto que valem citar, porque são o que diferencia isso de
"limpar dados" no sentido comum:

1. **Não destrutiva.** Nada é apagado nem corrigido. Uma faixa válida vira um
   `FilterSpec` comum, marcado com `origin: 'data-quality'`, que aparece na
   mesma lista de filtros e entra na receita. Dá para remover depois e o dado
   original nunca foi tocado.
2. **Sem presets clínicos.** O roadmap classifica "gestante acima de 55 é
   impossível" como **bloqueado por evidência**: seria inventar política
   epidemiológica. O IQR é estatístico e declarado; regra de plausibilidade
   clínica exige fonte citada ou assinatura explícita do usuário.

O que **falta** na limpeza, e conversa com esta decisão:

- imputação (nenhuma, e talvez deva continuar assim);
- deduplicação por chave — que é SQL trivial e trabalho real no nosso motor;
- validação de dígito verificador (CNS, CNPJ do estabelecimento);
- consistência de data — internação depois da saída, óbito antes da entrada;
- padrão textual — CID malformado, procedimento fora da tabela SIGTAP.

### O que "nível do R" significaria

Coisas que um usuário de `microdatasus` + `dplyr` faz sem pensar e que hoje **não
dá para fazer** aqui:

- filtro por expressão derivada — `IDADE / 365 > 60`, `VAL_TOT / DIAS_PERM`;
- filtro condicional entre campos — "sexo feminino **e** procedimento em lista";
- padrão textual — `PROC_REA` começando com `04`, CID que casa `J1.`;
- filtro por agregado — "municípios com mais de 100 internações";
- janela/percentil — "os 10% mais caros";
- deduplicação por chave;
- junção com uma tabela auxiliar que o usuário traz.

E, na estatística:

- qui-quadrado e teste exato de Fisher em tabela de contingência;
- intervalos de confiança para proporção e para taxa;
- padronização direta e indireta por idade — **o pão com manteiga da
  epidemiologia**, e hoje não existe;
- razão de chances e risco relativo com IC;
- regressão múltipla e logística;
- série temporal, sazonalidade, tendência;
- taxas por população com denominador do IBGE.

### Por que isso pesa a favor do DuckDB

Filtro por expressão, por agregado, por janela e junção com tabela auxiliar
**são exatamente o que SQL faz nativamente**. Implementar cada um à mão no nosso
executor significa escrever um interpretador de expressões, um planejador de
junções e funções de janela — meses de trabalho, e cada um vira uma nova
superfície onde a semântica pode divergir dos goldens.

A estatística avançada é diferente: ela **não** vem de graça com o DuckDB.
Qui-quadrado, padronização por idade e IC precisam ser escritos por nós de
qualquer jeito. Mas ficam muito mais fáceis quando a camada de baixo consegue
produzir a tabela de contingência ou a série agregada que eles consomem.

**Resumo honesto:** DuckDB resolve a metade "filtro nível R", e resolve de
graça três dos cinco itens que faltam na limpeza (deduplicação, consistência
de data, padrão textual). Não resolve a
metade "estatística avançada", só facilita.

## 6. Onde dói

1. **Peso.** ~7 MB comprimidos no primeiro acesso. Num celular em rede fraca no
   interior — que é parte real do público do DATASUS — isso é sentido.
2. **Dois motores.** Todo plano que rodar por SQL precisa passar pelo portão de
   paridade, ou vira uma segunda verdade. A disciplina existe; o custo é
   permanente.
3. **O que o SQL não pode ver.** CNV, lookup, `startPosition` e unclassified são
   semântica do TabWin que **não** será traduzida para SQL — e são justamente o
   que a maioria das tabulações usa. Então o caminho SQL serve para
   **exploração de microdado bruto**, não para reproduzir tabulação oficial.
4. **Não é local-first?** É, sim. O WASM roda no dispositivo; nenhum dado sai.
   O custo é de download, não de privacidade.

## 7. Opções

**A — Não fazer.** O compilador continua servindo para *exportar* a consulta em
SQL, para quem quiser rodar em outro lugar. Filtros avançados teriam que ser
implementados um a um no nosso executor.

**B — Carregar sob demanda.** O aplicativo continua com 6,6 MB. O DuckDB só é
baixado quando a pessoa abre a aba de consulta avançada, com aviso de tamanho.
Quem nunca abrir, nunca paga.

**C — Sempre embarcado.** SQL disponível desde o primeiro clique; todo mundo
paga os ~7 MB.

## 8. O que eu recomendo, e por quê

**B**, com o caminho SQL restrito a exploração de microdado, e **a estatística
avançada tratada como trilha separada**, que não depende dessa decisão.

Razão: o público que precisa de filtro nível R é minoria e sabe o que está
pedindo; o público que abre para ver uma frequência por município é maioria e
não deve pagar por uma capacidade que não vai usar. E a padronização por idade —
que é provavelmente o item de maior valor epidemiológico da lista — precisa ser
escrita por nós de qualquer forma.

## 9. Perguntas concretas para o ChatGPT

1. Com ~7 MB comprimidos e cache, sob demanda, a objeção de peso ainda procede
   para o público do DATASUS?
2. Restringir o caminho SQL a microdado bruto — sem CNV, sem lookup — é uma
   fronteira defensável, ou vira armadilha quando o usuário não entender por que
   metade das opções não aparece ali?
3. Na lista de estatística avançada, qual é a **ordem** por valor
   epidemiológico real? Minha aposta é padronização por idade primeiro, depois
   IC de proporção e taxa, depois qui-quadrado.
4. Padronização por idade precisa de população de referência. A OMS 2000-2025 e
   a padrão brasileira são as candidatas. Isso é escolha do usuário por análise,
   ou default declarado?
5. Tem algum filtro "nível R" na seção 5 que você tiraria da lista por não ser
   realmente usado em análise de SUS?
6. Na limpeza, imputação deve continuar fora? Meu instinto diz que sim — um
   valor imputado que entra numa tabulação oficial vira número inventado com
   cara de dado —, mas quero contraditório.
