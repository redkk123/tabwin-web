# R10.2 — auditoria e segunda bateria de goldens (2026-08-29)

## Resultado

A auditoria das alterações recentes do Claude terminou sem enfraquecer nenhum
oracle. Depois das correções encontradas, o gate completo passa com **227/227**
testes, tipagem web e build Vite. `origin/main` já contém duas unidades
publicadas durante a rodada:

- `52cf5e6` — total de subtotais e identidade lógica de MultiPolygon;
- `2f2e7c2` — segunda bateria de goldens e rótulos auxiliares por DBF.

## Achados da auditoria

1. O G010 exibiu linhas-pai e linhas-filhas corretamente, mas o total final
   somava ambas e chegava a 8.630. As linhas-pai de subtotal agora ficam fora
   do total; o resultado real fecha em 4.315.
2. Um `MultiPolygon` GeoJSON era dividido em várias áreas lógicas, duplicando
   correspondências. Agora uma feature continua uma área, com várias partes,
   e o limite de pontos é aplicado ao objeto lógico inteiro.
3. O lookup de hospital do G015 vinha de `TCNESAC.DBF`, não de CNV. O modelo,
   o compilador DEF, o executor, o Worker e a interface agora tratam DBF
   auxiliar explicitamente, com ordem, rótulos e categorias zero preservados.
4. O parser do formato CNV `N` tinha apenas rejeição total. As colunas fixas
   observadas nas 89 CNVs oficiais foram decodificadas sem inferir a hierarquia.
   Como o G012 ainda contém uma categoria duplicada sem explicação, arquivos N
   são somente leitura: podem ser inspecionados e pré-visualizados, mas não
   aparecem nos seletores executáveis nem podem ser aplicados ou regravados.

## Estado dos oracles recebidos

| Caso | Estado | Resultado decisivo |
| --- | --- | --- |
| G006 | passa, tolerância 0 | total 4.315; não classificados 1.703 |
| G008 | passa, tolerância 0 | capitais; total 1.835 |
| G009 | bloqueio de protocolo | `AIH_MA.DEF` referencia `MA*.DBC`, não `RD*.DBC` |
| G010 | passa, tolerância 0 | regiões/UFs; total 4.315 sem dupla contagem |
| G012 | evidência preservada | formato N; categoria 104-0 duplica 524 sem regra provada |
| G014 | passa, tolerância 0 | frequência ponderada; total 4.315 sobre 49.338 registros |
| G015 | passa, tolerância 0 | 25 hospitais rotulados por `TCNESAC.DBF`; total 4.315 |
| G017 | evidência preservada | 27 hospitais × 3 medidas; totais 4.315 / 4.308.072,76 / 126 |
| G018 | passa, tolerância 0 | seleção de alta complexidade; total 124 |
| G021 | passa, tolerância 0 | dois meses combinados; total 8.631 |

Os XLS originais foram copiados como referência imutável, normalizados e
rehashados. O verificador `npm run verify:goldens:second` compara novamente o
BIFF com o JSON e executa os sete casos suportados contra os dados reais.

## Verificação visual

Em navegador, `RD2008.DEF`, `TCNESAC.DBF` e `RDAC2401.dbc` foram abertos em
conjunto. A interface reconheceu 27 rótulos auxiliares, selecionou a dimensão
CNES, mostrou `Hospital AC (CNES)` e fechou em 4.315, sem erro de console.

## Próxima progressão estrutural

O próximo item é o G017: representar e executar múltiplas medidas lado a lado
sem quebrar o contrato atual de uma medida, coluna categórica, cache, receitas
e exportações. Depois vem a semântica hierárquica do formato N/G012, somente
quando houver explicação reproduzível para a categoria duplicada. O G009 não
deve ser repetido até o protocolo usar um DEF compatível com o arquivo RD.

## Prompt de retomada para Claude

> Leia `C:\projetos\PROTOCOLO_VM_COMPARTILHADA.md`, confirme que
> `C:\projetos\LOCK.md` está livre e faça `git fetch` antes de editar. Comece
> pelo handoff `docs/handoffs/R10_2_SECOND_GOLDEN_BATCH_AUDIT_2026-08-29.md` e
> pelo `PROJECT_STATE.json`. Não altere nenhum oracle para fazê-lo passar.
> Audite primeiro os commits `52cf5e6`, `2f2e7c2` e o commit posterior do
> formato N somente leitura. Rode `npm run check` e depois
> `npm run verify:goldens:second -- C:\projetos\tabwin-private\oracle\tabwin415\app\G001 C:\projetos\tabwin-private\oracle\tabwin415\app\golden\gol`.
> Se estiver tudo verde, continue do menos
> complexo para o mais complexo: implemente G017 (múltiplas medidas) de forma
> aditiva e compatível com receitas/cache/exportações; só depois investigue
> G012. O formato N deve permanecer não executável e não gravável enquanto a
> linha duplicada do golden não tiver uma explicação baseada em evidência.
