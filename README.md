# TabWin Web

Reimplementação moderna, local e auditável dos fluxos analíticos do DATASUS
TabWin. A aplicação roda no navegador: Windows, macOS e Android usam a mesma
interface e os microdados permanecem no aparelho.

Aplicação: <https://redkk123.github.io/tabwin-web/>

O código ativo e toda a documentação de compatibilidade estão em
[`TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26`](./TABWIN_WEB_HANDOFF_R01_2_VM_BOOTSTRAP_2026-08-26/).

## Estado atual

- leitura local de DBC e DBF;
- tabulação automática por frequência;
- linhas, colunas, CNV e supressão de zeros;
- tabela, gráfico de barras, mapa temático e auditoria;
- leitura de mapas binários `.MAP` do TabWin;
- mapas brasileiros de UF e município incluídos;
- 25 testes automatizados e build verificado em cada publicação.

O projeto ainda não declara equivalência completa com o TabWin 4.15. Casos
golden só são aceitos após captura pareada no programa de referência.
