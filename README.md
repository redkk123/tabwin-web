# TabWin Web

Reimplementação moderna, local e auditável dos fluxos analíticos do DATASUS
TabWin. A aplicação roda no navegador: Windows, macOS e Android usam a mesma
interface e os microdados permanecem no aparelho.

Aplicação: <https://redkk123.github.io/tabwin-web/>

O código ativo e toda a documentação de compatibilidade estão em
[`TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26`](./TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26/).

## Estado atual

- leitura local de DBC e DBF;
- frequência, soma e múltiplos filtros;
- DEF/CNV, linhas, colunas e supressão de zeros;
- receitas reproduzíveis `.twrecipe` com fingerprints;
- tabela e oito famílias de gráficos com PNG/SVG;
- mapas temáticos com classes, paletas, zoom, pan e identificação de áreas;
- estatística descritiva, correlação, regressão e histograma;
- exportação CSV/XML e auditoria do plano;
- leitura de mapas binários `.MAP` do TabWin;
- mapas brasileiros de UF e município incluídos;
- 86 testes automatizados, typecheck e build de produção verificados.

A busca oficial do DATASUS funciona no site publicado por meio de um Worker
Cloudflare estritamente limitado às rotas oficiais. Downloads recentes ficam
somente no navegador, podem ser removidos pelo usuário e serão reabertos
offline pela entrega R05.3-A. A entrega R05.3-B já publicada mostra progresso
de download e permite cancelar consultas demoradas.

O projeto ainda não declara equivalência completa com o TabWin 4.15. Casos
golden só são aceitos após captura pareada no programa de referência.
