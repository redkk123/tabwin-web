# Handoff definitivo para Claude — 2026-08-31

## Ponto de partida

- Repositório: `C:\projetos\tabwin-web`
- Branch: `main`
- Commit da implementação: `f9c6ff8`
- Base anterior: `3d1b6e9`
- Responsável daqui em diante: **Claude**

Não reaplique o patch antigo do pacote `contexto.zip`: ele foi produzido contra
`a74ff2c`. Os achados válidos foram reimplementados no `HEAD`, e os hunks mortos
foram descartados.

## O que foi corrigido

### Auditoria do pacote antigo

1. receitas agora persistem e restauram epidemiologia e histograma por chave de
   coluna, não por índice;
2. célula ausente em estatística vira `NaN` e é excluída pelas rotinas; nunca
   fabrica zero;
3. SMR e intervalo usam o mesmo observado inteiro; evento fracionário é
   recusado, não arredondado;
4. pipeline salvo é o que realmente produziu a tabela ativa, não um rascunho
   ainda não aplicado;
5. erro ao reaplicar pipeline/receita interrompe a restauração e não anuncia
   sucesso falso;
6. transformação que produz zero registros limpa tabela e exportações antigas;
7. vínculos estatísticos/epidemiológicos acompanham a chave quando colunas são
   movidas ou excluídas;
8. a diretiva DEF `G` alimenta frequência ponderada, inclusive após replay sem
   o DEF original.

Também foi corrigida a afirmação universal não sustentada em
`RE_001_TAB.md`: T08 prova referência externa naquele caso, não “mapa nunca
embutido”. O documento agora informa que T01–T10 não estão no clone.

### Aquisição DATASUS resiliente

Fluxo efetivo:

```text
arquivo A -> sucesso
arquivo B -> falha transitória -> até 2 retries -> registra e pula
arquivo C -> tentado normalmente
arquivo D -> tentado normalmente
```

Cancelamento humano é a única condição que impede os próximos itens.
`NOT_PUBLISHED` é diferente de falha e não recebe retry automático.

Foram adicionados:

- `retry-policy.ts`: retry limitado, abort-aware e com contagem de tentativas;
- `resilient-batch.ts`: estados tipados, sucesso parcial, retry-only, manifesto
  e cache de Promise que remove rejeições;
- `archive-validation.ts`: recusa vazio, HTML/XML e bytes sem assinatura ZIP
  antes do cache;
- `microdatasus-resolver.ts`: fallback estrito derivado do registro publicado
  pelo microdatasus, sem adivinhar caminhos não cobertos;
- UI para salvar manifesto operacional e retentar só falhas;
- resolução de auxiliar DEF/CNV uma vez por lote;
- provenance de resolver e tentativas na auditoria da fonte.

O fallback só roda quando o catálogo principal falha. Uma lista oficial vazia
continua sendo ausência observada e não dispara a segunda estratégia.

## Gates realmente executados

- `npm run check`: **464/464**, typecheck web e build Vite/manual — PASS;
- `npm run e2e`: **34/34 Chromium** — PASS;
- após o último ajuste de timeout, os 2 E2E de catálogo foram repetidos — PASS;
- `npm run proxy:check` — PASS;
- `npm audit --omit=dev` — 0 vulnerabilidades;
- `npm audit` — 0 vulnerabilidades;
- `git diff --check` — PASS.

Não houve alteração de goldens. Não houve instalação ou atualização de
dependência.

Backup verificado antes do commit:

`C:\projetos\backups\2026-08-31_224511_codex-final-resilience-hotfixes`

O backup novo contém ZIP da árvore, bundle Git, status e hashes conferidos. O
script terminou com erro apenas ao tentar remover um backup antigo bloqueado;
nenhuma exclusão foi forçada.

## Revisão que ainda vale fazer

1. Rodar o fluxo **ao vivo** numa implantação com proxy: provocar 504 em um
   item intermediário e confirmar que o seguinte abre.
2. Confirmar expiração/comportamento de URLs `zipupload` preparadas pelo
   fallback. O cliente só reutiliza uma por quatro minutos e prepara outra
   depois disso.
3. Revisar as regras do fallback contra mudanças futuras no registro do
   microdatasus. Expandir apenas com evidência de caminho/nome.
4. Testar em tablet real um lote grande. A concorrência está intencionalmente
   em 1; não aumentar antes de medir memória e pressão no serviço.
5. Tentar fechar/reabrir o modal durante retry, cancelar durante preparação e
   cancelar durante streaming.
6. Adicionar E2E com transporte totalmente simulado para os botões de manifesto
   e “retentar somente falhas”. A política já tem testes unitários A–I; a UI de
   falha não tem cobertura ponta a ponta específica.
7. Se houver suporte a navegadores antigos, revisar disponibilidade de
   `AbortSignal.any`; o build atual mira navegadores modernos.

## Limites que não devem ser rebatizados

- O fallback não é uma cópia completa do microdatasus. Cobre SIH, SIA, CNES e
  subconjuntos explicitamente mapeados de SIM, SINASC e SINAN.
- “FOUND” no lookup significa endereço oficial resolvido/preparado; o ZIP só é
  declarado válido após download e assinatura.
- Os testes de rede não provam disponibilidade futura do DATASUS.
- Pyodide/webR não são redundância de transporte: no navegador sofrem a mesma
  política de rede. Pertencem ao **Tabwin Lab**, em pasta/produto separado.

## Prompt pronto para continuar

```text
Você é o novo responsável pelo TabWin Web. Comece em
C:\projetos\tabwin-web, leia integralmente
docs/architecture/HANDOFF_CLAUDE_2026-08-31.md e audite o commit f9c6ff8 contra
o código, sem reaplicar o patch velho de contexto.zip.

Primeiro rode npm ci, npm run check, npm run proxy:check e npm run e2e sem
stubs. Depois faça uma revisão adversarial da aquisição resiliente: timeout no
meio do lote precisa registrar/pular e o próximo item precisa ser tentado;
cancelamento humano precisa parar; NOT_PUBLISHED não pode virar erro; HTML 200
não pode entrar no cache; retry-only não pode baixar sucessos; Promise rejeitada
de auxiliar não pode envenenar o lote; fallback não pode inventar URL nem abrir
o proxy.

Revise também os hotfixes de receita/pipeline/epidemiologia e os novos E2E.
Preserve goldens e a regra “zero nunca é fabricado”. Se encontrar problema,
registre reprodução, corrija no HEAD, rode o gate completo e faça commit/push
pequeno. Mantenha o Tabwin Lab fora deste repositório e não use Python/R como
downloader do produto web.
```
