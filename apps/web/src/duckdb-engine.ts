/**
 * DuckDB no navegador, como superfície de ANÁLISE — nunca como o motor de
 * tabulação.
 *
 * A distinção é o ponto inteiro. O valor deste projeto é fidelidade ao TabWin
 * 4.15, provada por goldens com tolerância zero. Se a tabulação migrasse para
 * SQL, cada golden teria de ser reprovado, e a semântica de CNV, lookup,
 * `startPosition` e regras entre campos teria de ser reproduzida num segundo
 * motor. `packages/core/src/duckdb-plan.ts` existe justamente para RECUSAR
 * essas doze categorias em vez de traduzir por aproximação.
 *
 * O que este módulo abre é outra coisa: perguntas que o modelo de plano não
 * expressa. Junção entre arquivos e entre anos, percentis, funções de janela,
 * faixas contínuas, exportação para Parquet.
 *
 * O motor pesa cerca de 7 MB comprimidos — noventa vezes o JS da aplicação.
 * Por isso é carregado SOB DEMANDA: quem só quer uma tabela do TabWin nunca
 * paga esse download. O `import()` dinâmico é o que mantém o pacote principal
 * do tamanho que é.
 *
 * As regras puras (nome de tabela, tipos, normalização) moram em
 * `packages/analysis/src/duckdb-surface.ts`, onde são testadas.
 */

import type { DataRecord } from '../../../packages/core/src/model.ts';
import {
  MAX_RESULT_ROWS,
  inferColumnTypes,
  quoteIdentifier,
  normalizeCell,
  type DuckDbColumn,
  type DuckDbLoadedTable,
  type DuckDbQueryResult,
} from '../../../packages/analysis/src/duckdb-surface.ts';

export {
  MAX_RESULT_ROWS,
  createTableSql,
  inferColumnTypes,
  normalizeCell,
  quoteIdentifier,
  tableNameFor,
  type DuckDbColumn,
  type DuckDbLoadedTable,
  type DuckDbQueryResult,
} from '../../../packages/analysis/src/duckdb-surface.ts';

interface DuckDbRuntime {
  connection: {
    query(sql: string): Promise<unknown>;
    insertArrowTable(table: unknown, options: { name: string; create?: boolean }): Promise<void>;
    close(): Promise<void>;
  };
  database: { terminate(): Promise<void> };
  worker: Worker;
}

let runtime: DuckDbRuntime | null = null;
let loading: Promise<DuckDbRuntime> | null = null;

/**
 * Carrega o motor, uma vez.
 *
 * O `import()` é dinâmico de propósito: é ele que mantém os 7 MB fora do
 * pacote principal. Chamadas concorrentes compartilham a mesma promessa, senão
 * dois cliques rápidos baixariam o WebAssembly duas vezes.
 */
export async function ensureDuckDb(onProgress?: (mensagem: string) => void): Promise<DuckDbRuntime> {
  if (runtime) return runtime;
  if (loading) return loading;
  loading = (async () => {
    onProgress?.('Carregando o motor de consulta (uma vez, ~7 MB)…');
    const duckdb = await import('@duckdb/duckdb-wasm');
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    if (!bundle.mainWorker) throw new Error('O motor de consulta não ofereceu um worker para este navegador');
    // O worker sai de um blob para não depender de um caminho servido pelo
    // site: o aplicativo é estático e publicado em subdiretório.
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const database = new duckdb.AsyncDuckDB(logger, worker);
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker ?? null);
    URL.revokeObjectURL(workerUrl);
    const connection = await database.connect();
    onProgress?.('Motor de consulta pronto.');
    runtime = { connection, database, worker } as unknown as DuckDbRuntime;
    return runtime;
  })();
  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** Encerra o motor e devolve a memória. Idempotente. */
export async function shutdownDuckDb(): Promise<void> {
  const atual = runtime;
  runtime = null;
  loading = null;
  if (!atual) return;
  try {
    await atual.connection.close();
    await atual.database.terminate();
  } finally {
    atual.worker.terminate();
  }
}

/** Se o motor já está carregado — para a interface não prometer instantâneo. */
export function duckDbIsLoaded(): boolean {
  return runtime !== null;
}

/**
 * Carrega registros como uma tabela consultável.
 *
 * Vai por Arrow em vez de `INSERT`: um `INSERT` por registro faria centenas de
 * milhares de idas ao motor para um arquivo do DATASUS. O Arrow entrega tudo
 * numa transferência só.
 */
export async function loadRecordsAsTable(
  table: string,
  records: readonly DataRecord[],
  fields: readonly string[],
  onProgress?: (mensagem: string) => void,
): Promise<DuckDbLoadedTable> {
  const { connection } = await ensureDuckDb(onProgress);
  const columns = inferColumnTypes(records, fields);
  onProgress?.(`Preparando ${records.length.toLocaleString('pt-BR')} registros…`);

  const arrow = await import('apache-arrow');
  const colunas: Record<string, unknown[]> = {};
  for (const c of columns) {
    const destino = new Array<unknown>(records.length);
    for (let i = 0; i < records.length; i++) {
      const valor = records[i]![c.name];
      if (valor === null || valor === undefined) { destino[i] = null; continue; }
      destino[i] = c.type === 'número'
        ? Number(valor)
        : c.type === 'data'
          ? valor
          : typeof valor === 'string' ? valor : String(valor);
    }
    colunas[c.name] = destino;
  }
  const arrowTable = arrow.tableFromArrays(colunas as never);
  await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
  await connection.insertArrowTable(arrowTable, { name: table, create: true });
  onProgress?.(`Tabela ${table} pronta com ${records.length.toLocaleString('pt-BR')} linhas.`);
  return { name: table, rowCount: records.length, columns };
}

/** Roda uma consulta e devolve linhas já em JavaScript, com o corte declarado. */
export async function runQuery(sql: string): Promise<DuckDbQueryResult> {
  const { connection } = await ensureDuckDb();
  const inicio = performance.now();
  const resultado = await connection.query(sql) as {
    numRows: number;
    schema: { fields: Array<{ name: string; type: { toString(): string } }> };
    toArray(): Array<Record<string, unknown>>;
  };
  const milliseconds = performance.now() - inicio;
  const columns: DuckDbColumn[] = resultado.schema.fields.map((f) => {
    const t = f.type.toString().toLowerCase();
    return {
      name: f.name,
      type: /date|timestamp/.test(t) ? 'data' : /int|float|double|decimal/.test(t) ? 'número' : 'texto',
    };
  });
  const todas = resultado.toArray();
  const cortadas = todas.slice(0, MAX_RESULT_ROWS);
  const rows = cortadas.map((linha) => columns.map((c) => normalizeCell(linha[c.name])));
  return {
    columns,
    rows,
    rowCount: resultado.numRows ?? todas.length,
    milliseconds,
    truncated: todas.length > cortadas.length,
  };
}
