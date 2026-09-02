/**
 * As partes do DuckDB que não dependem do navegador.
 *
 * Nome de tabela, citação de identificador, inferência de tipo e normalização
 * de célula são regras, não infraestrutura — e regra que decide o que vira
 * número e o que vira texto precisa de teste. Aqui elas ficam num pacote que o
 * `tsc` compila e o `node --test` alcança; o que carrega WebAssembly e cria
 * Worker fica em `apps/web/src/duckdb-engine.ts`.
 *
 * Camada: analysis -> core. Só o modelo de dados vem de baixo.
 */

import type { DataRecord } from '../../core/src/model.js';

/**
 * O que uma célula de resultado pode ser depois de normalizada.
 *
 * O modelo do núcleo usa `unknown` para valor de campo, porque um DBF pode
 * trazer qualquer coisa. Aqui o conjunto já é fechado: o que sai do DuckDB
 * passou por `normalizeCell`, e é isso que a interface sabe mostrar.
 */
export type DuckDbCell = string | number | Date | null;

export interface DuckDbColumn {
  name: string;
  /** Como o valor foi declarado ao motor, para a interface poder dizer. */
  type: 'texto' | 'número' | 'data';
}

export interface DuckDbQueryResult {
  columns: readonly DuckDbColumn[];
  rows: readonly (readonly DuckDbCell[])[];
  rowCount: number;
  /** Quanto o motor levou, sem contar carregamento nem ingestão. */
  milliseconds: number;
  /** Verdadeiro quando o resultado foi cortado pelo limite de exibição. */
  truncated: boolean;
}

export interface DuckDbLoadedTable {
  name: string;
  rowCount: number;
  columns: readonly DuckDbColumn[];
}

/**
 * Teto de linhas trazidas para a memória da página.
 *
 * Uma consulta pode legitimamente devolver milhões de linhas; materializá-las
 * num array de JavaScript é o caminho conhecido para travar a aba. O corte é
 * declarado no resultado, nunca silencioso — a regra da casa é que resultado
 * cortado precisa dizer que foi cortado.
 */
export const MAX_RESULT_ROWS = 5000;

/** Nome de tabela seguro a partir do nome de um arquivo aberto. */
export function tableNameFor(sourceName: string): string {
  const base = sourceName.replace(/\.[^.]+$/, '');
  const limpo = base.replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '');
  // O padrão precisa vir ANTES do prefixo: `t_` mais vazio dá `'t_'`, que é
  // verdadeiro, então um `|| 'tabela'` no fim nunca chegaria a disparar.
  if (!limpo) return 'tabela';
  const comInicial = /^[\p{L}_]/u.test(limpo) ? limpo : `t_${limpo}`;
  return comInicial.slice(0, 60).toLowerCase();
}

/**
 * Decide o tipo de cada coluna olhando os valores, não adivinhando pelo nome.
 *
 * Um campo do DBF chega aqui já decodificado em primitivo pelo leitor. Se todo
 * valor presente for número, a coluna vira numérica; se houver mistura, vira
 * texto — porque converter à força inventaria dado, e inventar dado é o que
 * este projeto não faz.
 */
export function inferColumnTypes(
  records: readonly DataRecord[],
  fields: readonly string[],
): DuckDbColumn[] {
  return fields.map((name) => {
    let viuNumero = false;
    let viuOutro = false;
    let viuData = false;
    for (const record of records) {
      const value = record[name];
      if (value === null || value === undefined) continue;
      if (typeof value === 'number') { viuNumero = true; continue; }
      if (value instanceof Date) { viuData = true; continue; }
      viuOutro = true;
    }
    if (viuData && !viuNumero && !viuOutro) return { name, type: 'data' as const };
    if (viuNumero && !viuOutro && !viuData) return { name, type: 'número' as const };
    return { name, type: 'texto' as const };
  });
}

/** O SQL que cria a tabela, com os tipos inferidos. */
export function createTableSql(table: string, columns: readonly DuckDbColumn[]): string {
  const tipo = (c: DuckDbColumn): string =>
    c.type === 'número' ? 'DOUBLE' : c.type === 'data' ? 'DATE' : 'VARCHAR';
  const corpo = columns.map((c) => `${quoteIdentifier(c.name)} ${tipo(c)}`).join(', ');
  return `CREATE OR REPLACE TABLE ${quoteIdentifier(table)} (${corpo})`;
}

/** Identificador citado à moda do SQL: aspas duplas, dobrando as internas. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}


/**
 * Traz o valor do Arrow para algo que a interface sabe mostrar.
 *
 * `BigInt` é o caso que morde: uma contagem do DuckDB volta como `BigInt`, e
 * `BigInt` não soma com `Number` nem sobrevive a `JSON.stringify`. Converter
 * aqui, uma vez, evita o erro reaparecer em cada lugar que consome o resultado.
 */
export function normalizeCell(value: unknown): DuckDbCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    // Acima de 2^53 um inteiro deixa de ser exato como Number; nesse caso o
    // texto preserva o valor, e é melhor um texto certo que um número errado.
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Date) return value;
  return String(value);
}
