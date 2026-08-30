import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeDuckDbPlanSupport,
  compareDuckDbAggregationToReference,
  compileDuckDbSql,
  compileQueryPlan,
  executeInMemory,
  runDuckDbAggregation,
} from '../dist/packages/core/src/index.js';

const plan = compileQueryPlan({
  compatibilityProfile: 'modern',
  rows: { field: 'UF' },
  columns: { field: 'SEXO' },
  measure: { kind: 'sum', field: 'VALOR' },
  filters: [
    { field: 'ANO', kind: 'numeric-range', minimum: 2024, maximum: 2025 },
    { field: 'TIPO', acceptedCategories: ['A', 'B'] },
  ],
});
const schema = { UF: 'text', SEXO: 'text', VALOR: 'number', ANO: 'number', TIPO: 'text' };

test('DuckDB compiler accepts only the explicit raw-field subset and parameterizes filters', () => {
  const support = analyzeDuckDbPlanSupport(plan, schema);
  assert.equal(support.supported, true);
  const compiled = compileDuckDbSql(plan, schema, 'dados');
  assert.match(compiled.aggregateSql, /SUM\("VALOR"\) AS __value/);
  assert.match(compiled.aggregateSql, /CAST\("UF" AS VARCHAR\) AS __row_key/);
  assert.match(compiled.aggregateSql, /CAST\("SEXO" AS VARCHAR\) AS __column_key/);
  assert.deepEqual(compiled.parameters, [2024, 2025, 'A', 'B']);
  assert.deepEqual(compiled.countParameters, [2024, 2025, 'A', 'B']);
  assert.ok(!compiled.aggregateSql.includes("'A'"));
});

test('DuckDB compiler refuses CNV semantics instead of duplicating them in SQL', () => {
  const cnvPlan = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'UF', conversionId: 'UF.cnv' },
    measure: { kind: 'count' }, filters: [],
  });
  const support = analyzeDuckDbPlanSupport(cnvPlan, { UF: 'text' });
  assert.equal(support.supported, false);
  assert.match(support.blockers.join('\n'), /CNV conversion/);
  assert.throws(() => compileDuckDbSql(cnvPlan, { UF: 'text' }), /unsupported/);
});

test('DuckDB adapter boundary and parity gate compare against reference executor facts', async () => {
  const records = [
    { UF: 'AC', SEXO: 'M', VALOR: 2, ANO: 2024, TIPO: 'A' },
    { UF: 'AC', SEXO: 'F', VALOR: 3, ANO: 2024, TIPO: 'A' },
    { UF: 'AM', SEXO: 'F', VALOR: 5, ANO: 2025, TIPO: 'B' },
    { UF: 'AM', SEXO: 'F', VALOR: 100, ANO: 2023, TIPO: 'A' },
  ];
  const reference = executeInMemory(records, plan);
  const bundle = compileDuckDbSql(plan, schema);
  let calls = 0;
  const adapter = {
    async query(sql) {
      calls++;
      if (sql.includes('GROUP BY')) return [
        { __row_key: 'AC', __column_key: 'F', __value: 3, __group_records: 1 },
        { __row_key: 'AC', __column_key: 'M', __value: 2, __group_records: 1 },
        { __row_key: 'AM', __column_key: 'F', __value: 5, __group_records: 1 },
      ];
      return [{ __records_seen: 4, __records_accepted: 3 }];
    },
  };
  const ran = await runDuckDbAggregation(adapter, bundle);
  assert.equal(calls, 2);
  assert.equal(compareDuckDbAggregationToReference(reference, ran.aggregates, ran.counts).identical, true);
  const bad = compareDuckDbAggregationToReference(reference,
    ran.aggregates.map((row, index) => index === 0 ? { ...row, __value: 9 } : row), ran.counts);
  assert.equal(bad.identical, false);
  assert.equal(bad.changedGroups.length, 1);
});
