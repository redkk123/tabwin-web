import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_INGEST_CELLS,
  MAX_RESULT_ROWS,
  checkIngestBudget,
  createTableSql,
  inferColumnTypes,
  normalizeCell,
  quoteIdentifier,
  tableNameFor,
  buildCopyStatement,
  DUCKDB_EXPORT_FILES,
} from '../dist/packages/analysis/src/duckdb-surface.js';

test('o nome da tabela sai do nome do arquivo sem virar injeção', () => {
  assert.equal(tableNameFor('RDAC2401.dbc'), 'rdac2401');
  assert.equal(tableNameFor('DOINF23.DBC'), 'doinf23');
  // Um nome que começa com dígito não é identificador válido em SQL.
  assert.equal(tableNameFor('2020_nascidos.dbc'), 't_2020_nascidos');
  // Pontuação vira separador, nunca sintaxe.
  assert.equal(tableNameFor('base"; DROP TABLE x; --.dbc'), 'base_drop_table_x');
  assert.equal(tableNameFor('.dbc'), 'tabela', 'nome vazio precisa de um padrão, não de erro');
  // Acento é letra e pode ficar: o DuckDB aceita identificador Unicode citado.
  assert.equal(tableNameFor('óbitos.dbf'), 'óbitos');
});

test('identificador citado dobra as aspas internas', () => {
  assert.equal(quoteIdentifier('campo'), '"campo"');
  assert.equal(quoteIdentifier('cam"po'), '"cam""po"');
  // O caso que importa: sem dobrar, isto fecharia a citação e abriria comando.
  assert.equal(quoteIdentifier('a" ; DROP TABLE t; --'), '"a"" ; DROP TABLE t; --"');
});

test('o tipo da coluna vem dos valores, não do nome do campo', () => {
  const registros = [
    { IDADE: 30, UF: 'SP', NASC: new Date(Date.UTC(2020, 0, 1)), MISTO: 5 },
    { IDADE: 41, UF: 'RJ', NASC: new Date(Date.UTC(2021, 5, 3)), MISTO: 'sem informação' },
    { IDADE: null, UF: null, NASC: null, MISTO: null },
  ];
  const tipos = inferColumnTypes(registros, ['IDADE', 'UF', 'NASC', 'MISTO']);
  assert.deepEqual(tipos, [
    { name: 'IDADE', type: 'número' },
    { name: 'UF', type: 'texto' },
    { name: 'NASC', type: 'data' },
    // Mistura de número com texto vira texto: converter à força inventaria dado.
    { name: 'MISTO', type: 'texto' },
  ]);
});

test('coluna inteiramente vazia não vira número por acidente', () => {
  // Um campo que só tem nulo não tem evidência de ser numérico. Texto é a
  // escolha que não perde informação quando os dados chegarem.
  const tipos = inferColumnTypes([{ X: null }, { X: undefined }], ['X']);
  assert.deepEqual(tipos, [{ name: 'X', type: 'texto' }]);
});

test('o CREATE TABLE traduz os tipos e cita todos os nomes', () => {
  const sql = createTableSql('doinf23', [
    { name: 'IDADE', type: 'número' },
    { name: 'UF', type: 'texto' },
    { name: 'DT"OBITO', type: 'data' },
  ]);
  assert.equal(sql, 'CREATE OR REPLACE TABLE "doinf23" ("IDADE" DOUBLE, "UF" VARCHAR, "DT""OBITO" DATE)');
});

test('BigInt do DuckDB vira número utilizável, e o que não cabe vira texto exato', () => {
  // Uma contagem volta como BigInt. BigInt não soma com Number nem sobrevive a
  // JSON.stringify — se não for convertido aqui, o erro reaparece em cada
  // lugar que consome o resultado.
  assert.equal(normalizeCell(12746n), 12746);
  assert.equal(typeof normalizeCell(12746n), 'number');
  // Acima de 2^53 um Number deixa de ser exato: melhor um texto certo que um
  // número errado.
  const enorme = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
  assert.equal(normalizeCell(enorme), enorme.toString());
  assert.equal(normalizeCell(null), null);
  assert.equal(normalizeCell(undefined), null);
  assert.equal(normalizeCell('SP'), 'SP');
  assert.equal(normalizeCell(3.5), 3.5);
  assert.equal(normalizeCell(true), 'true');
  const data = new Date(Date.UTC(2020, 0, 1));
  assert.equal(normalizeCell(data), data);
});

test('o teto de linhas é declarado, porque resultado cortado precisa dizer que foi cortado', () => {
  assert.equal(MAX_RESULT_ROWS, 5000);
  assert.ok(Number.isSafeInteger(MAX_RESULT_ROWS) && MAX_RESULT_ROWS > 0);
});

test('o orçamento de ingestão recusa com instrução, em vez de derrubar a aba', () => {
  // A ingestão passa por representações caras em sequência: objetos vindos do
  // worker, um vetor JavaScript por coluna, e os vetores Arrow. Um arquivo do
  // SIM tem 87 campos; 400 mil linhas dele são 34,8 milhões de células.
  const cabe = checkIngestBudget(100_000, 5);
  assert.equal(cabe.withinBudget, true);
  assert.equal(cabe.cells, 500_000);

  const naoCabe = checkIngestBudget(400_000, 87);
  assert.equal(naoCabe.withinBudget, false);
  assert.equal(naoCabe.cells, 34_800_000);
  // Recusar sem dizer o que fazer é só travar mais devagar.
  assert.match(naoCabe.message, /Escolha até 20 campo\(s\)/);
  assert.equal(naoCabe.suggestedFields, 20);
  assert.match(naoCabe.message, /responde igual sobre os campos escolhidos/);
});

test('a borda do orçamento é exata, e zero linhas não divide por zero', () => {
  assert.equal(checkIngestBudget(MAX_INGEST_CELLS, 1).withinBudget, true);
  assert.equal(checkIngestBudget(MAX_INGEST_CELLS + 1, 1).withinBudget, false);
  const vazio = checkIngestBudget(0, 87);
  assert.equal(vazio.cells, 0);
  assert.equal(vazio.withinBudget, true);
  assert.equal(vazio.suggestedFields, 87, 'sem linhas não há campo a cortar');
});

test('o COPY do Parquet sai comprimido e com o destino declarado', () => {
  // ZSTD porque as colunas de um microdado do DATASUS repetem muito, e
  // porque pandas, polars, Arrow e R leem sem configuração nenhuma.
  const sql = buildCopyStatement('SELECT * FROM t', 'parquet');
  assert.match(sql, /^COPY \(SELECT \* FROM t\) TO 'consulta\.parquet'/);
  assert.match(sql, /FORMAT PARQUET/);
  assert.match(sql, /COMPRESSION ZSTD/);
});

test('o COPY do CSV usa ponto e vírgula, que é o que o Excel em português espera', () => {
  const sql = buildCopyStatement('SELECT 1', 'csv');
  assert.match(sql, /FORMAT CSV/);
  assert.match(sql, /DELIMITER ';'/);
  assert.match(sql, /HEADER/);
  // ENCODING no DuckDB é opção de LEITURA; passá-la aqui derruba a escrita
  // com "not supported for writing". Medido, não suposto.
  assert.doesNotMatch(sql, /ENCODING/);
});

test('o ponto e vírgula final é removido antes de entrar no COPY', () => {
  // É como quase todo mundo escreve SQL, e `COPY (SELECT 1;) TO ...` é erro
  // de sintaxe. Sem isto, a exportação falharia para a maioria das consultas.
  assert.match(buildCopyStatement('SELECT 1;', 'csv'), /\(SELECT 1\)/);
  assert.match(buildCopyStatement('SELECT 1;  \n', 'csv'), /\(SELECT 1\)/);
  assert.match(buildCopyStatement('  SELECT 1 ;;; ', 'csv'), /\(SELECT 1\)/);
});

test('mais de uma instrução é recusada com motivo, não repassada ao motor', () => {
  // Passar adiante daria um erro de sintaxe do DuckDB, que não diz o que
  // fazer. E emendar duas instruções dentro de um COPY nunca ia funcionar.
  assert.throws(
    () => buildCopyStatement('SELECT 1; DROP TABLE t', 'csv'),
    /uma consulta só/,
  );
});

test('consulta vazia é recusada antes de virar SQL', () => {
  for (const vazia of ['', '   ', ';', ' ;; ']) {
    assert.throws(() => buildCopyStatement(vazia, 'parquet'), /Não há consulta/, JSON.stringify(vazia));
  }
});

test('cada formato escreve num arquivo próprio', () => {
  // Se os dois escrevessem no mesmo nome, exportar CSV depois de Parquet
  // entregaria o arquivo antigo, ou falharia por já existir.
  assert.notEqual(DUCKDB_EXPORT_FILES.parquet, DUCKDB_EXPORT_FILES.csv);
  assert.match(DUCKDB_EXPORT_FILES.parquet, /\.parquet$/);
  assert.match(DUCKDB_EXPORT_FILES.csv, /\.csv$/);
});
