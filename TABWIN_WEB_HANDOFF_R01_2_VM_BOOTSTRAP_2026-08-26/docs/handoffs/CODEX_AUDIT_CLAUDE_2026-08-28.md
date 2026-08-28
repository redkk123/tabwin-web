# Auditoria Codex das alterações do Claude — 2026-08-28

## Escopo

Revisão dos commits `5f9cc8a..6847628`, com foco nos trechos de maior risco:
leitura DBC/DBF em blocos, projeção por plano, consumidores incrementais,
regras cruzadas e propriedade persistente do conjunto pelo Worker.

## Resultado

O desenho principal foi preservado. O gate recebido estava verde (148/148), a
projeção enumera inclusive os campos das regras cruzadas e a execução em lotes
usa o mesmo acumulador do caminho em memória. A auditoria encontrou três
defeitos concretos fora da cobertura existente.

### 1. Troca do Worker quebrava a preservação do conjunto anterior

`openDataset` encerrava o Worker ativo antes de o candidato validar o cabeçalho.
Uma abertura inválida ou cancelada deixava metadados e tabela antigos na tela,
mas já sem o conjunto que os sustentava. Isso contradizia tanto o comentário do
código quanto `PROJECT_STATE.json`.

**Correção:** abertura em Worker candidato. O Worker anterior só é encerrado
depois que o candidato responde com cabeçalho válido.

### 2. Cancelar análise destruía o único conjunto residente

Interromper o laço síncrono exige terminar o Worker. Como os bytes tinham sido
transferidos, a próxima análise criava um Worker vazio.

**Correção:** os objetos `File`/`Blob` das fontes ficam retidos, sem registros
residentes na thread principal. Depois de cancelamento ou falha fatal, a próxima
operação reconstitui o Worker pelas fontes, confere assinatura de esquema e
contagem, e só então executa. Arquivos combinados e CSV/TSV participam da mesma
restauração.

### 3. Limite de valores distintos gerava falso truncamento

Ao atingir exatamente o limite, qualquer duplicata posterior marcava
`truncated=true`, mesmo sem existir valor adicional.

**Correção:** duplicatas conhecidas são descartadas antes do teste do limite.
Um teste fixa o caso de exatamente dois valores repetidos com limite dois.

## Faixa 1 encerrada junto da auditoria

- `runAnalysis` agora cede a fila com `setTimeout(0)`, sem depender de composição
  de quadro;
- modalidade oficial final/preliminar chega à auditoria e à receita;
- resultado tabular ganhou exportação JSON versionada, com proveniência e o
  `TabulationResult` completo.

## Verificação

- `npm run check`: 149/149, typecheck web e build Vite;
- RDAC2401 real: 4.315/4.315 no navegador;
- cancelamento da abertura do Dengue preservou o RDAC anterior;
- cancelamento durante tabulação do Dengue e nova execução restauraram o Worker;
- `ID_UNIDADE` após restauração: total 1.643.053, sem erro de console;
- JSON coberto por teste determinístico; o navegador interno não expôs evento
  de download para URL `blob:`, embora o botão tenha ficado habilitado e sem
  erro de console.

## Riscos remanescentes

- o ciclo completo do Worker ainda não tem teste automatizado de navegador;
- exportação DBF selecionada é limitada por quantidade de registros, não por
  bytes estimados, então conjuntos muito largos merecem um limite por tamanho;
- não há cancelamento cooperativo por mensagem: a interrupção continua encerrando
  o Worker, agora com restauração verificável na operação seguinte.
