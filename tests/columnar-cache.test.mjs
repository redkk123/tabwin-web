import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildColumnarProjection,
  compileQueryPlan,
  createColumnarProjectionBuilder,
  createColumnarProjectionCache,
  executeColumnarProjection,
  executeInMemory,
} from '../dist/packages/core/src/index.js';

const records = [
  { UF: 'AC', SEXO: 'M', VALOR: 1.5, FLAG: true, DATA: new Date(Date.UTC(2024, 0, 1)) },
  { UF: 'AC', SEXO: 'F', VALOR: 2, FLAG: false, DATA: new Date(Date.UTC(2024, 0, 2)) },
  { UF: 'AM', SEXO: 'F', VALOR: 4, FLAG: true, DATA: null },
  { UF: '', SEXO: 'M', VALOR: 10, FLAG: true, DATA: undefined },
];

const plan = compileQueryPlan({
  compatibilityProfile: 'modern',
  rows: { field: 'UF' },
  columns: { field: 'SEXO' },
  measure: { kind: 'sum', field: 'VALOR' },
  filters: [{ field: 'FLAG', acceptedCategories: ['true'] }],
});

test('columnar projection dictionary-encodes projected fields and reconstructs exact supported values', () => {
  const projection = buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR', 'FLAG', 'DATA'], { chunkRows: 256 });
  assert.equal(projection.rowCount, 4);
  assert.ok(projection.estimatedBytes > 0);
  assert.equal(projection.columns.get('UF')?.indexWidth, 2);
  assert.equal(projection.recordAt(0).VALOR, 1.5);
  assert.equal(projection.recordAt(0).FLAG, true);
  assert.ok(projection.recordAt(0).DATA instanceof Date);
  assert.equal(projection.recordAt(3).DATA, undefined);
  const selected = projection.select(['UF', 'VALOR']);
  assert.deepEqual(selected.fields, ['UF', 'VALOR']);
  assert.equal(selected.columns.get('UF'), projection.columns.get('UF'));
});

test('columnar execution remains bit-for-bit on the reference semantic path', () => {
  const projection = buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR', 'FLAG']);
  const direct = executeInMemory(records, plan);
  const columnar = executeColumnarProjection(projection, plan);
  assert.deepEqual(columnar, direct);
  assert.throws(() => executeColumnarProjection(projection.select(['UF']), plan), /missing plan field/);
});

test('columnar builder accepts bounded batches and L2 cache reuses smallest supersets with LRU eviction', () => {
  const builder = createColumnarProjectionBuilder(['UF', 'SEXO', 'VALOR'], { chunkRows: 256 });
  builder.push(records.slice(0, 2));
  builder.push(records.slice(2));
  assert.equal(builder.rowCount, 4);
  const broad = builder.finish();
  const cache = createColumnarProjectionCache(2);
  cache.set('sha256:source-a', broad);
  const hit = cache.get('sha256:source-a', ['UF', 'VALOR']);
  assert.ok(hit);
  assert.deepEqual(hit.fields, ['UF', 'VALOR']);
  cache.set('sha256:source-b', buildColumnarProjection(records, ['UF']));
  // Touch A so B becomes least recently used.
  assert.ok(cache.get('sha256:source-a', ['UF']));
  cache.set('sha256:source-c', buildColumnarProjection(records, ['SEXO']));
  assert.equal(cache.get('sha256:source-b', ['UF']), undefined);
  assert.ok(cache.get('sha256:source-a', ['UF']));
});

test('the index widens to 4 bytes past the Uint16 dictionary limit, and values survive it', () => {
  // 65,536 distinct values still index inside Uint16 (0..65535); one more must
  // not. This is the boundary a dictionary encoder gets wrong by one.
  const atLimit = buildColumnarProjection(
    Array.from({ length: 65_536 }, (_, index) => ({ K: `v${index}` })),
    ['K'],
    { chunkRows: 4096 },
  );
  assert.equal(atLimit.columns.get('K').dictionary.length, 65_536);
  assert.equal(atLimit.columns.get('K').indexWidth, 2);
  assert.equal(atLimit.recordAt(65_535).K, 'v65535');

  const pastLimit = buildColumnarProjection(
    Array.from({ length: 65_537 }, (_, index) => ({ K: `v${index}` })),
    ['K'],
    { chunkRows: 4096 },
  );
  assert.equal(pastLimit.columns.get('K').indexWidth, 4);
  assert.equal(pastLimit.recordAt(65_536).K, 'v65536');
  assert.equal(pastLimit.recordAt(0).K, 'v0');
});

test('rows on both sides of a chunk boundary reconstruct correctly', () => {
  // recordAt divides by chunkRows to find the chunk. An off-by-one there reads
  // from the neighbouring chunk and returns a plausible wrong value, which is
  // the worst kind.
  // 256 is the smallest chunk the builder accepts, so 600 rows straddle two
  // full chunks and end inside a short third one.
  const chunkRows = 256;
  const records = Array.from({ length: 600 }, (_, index) => ({ N: index, S: `linha ${index}` }));
  const projection = buildColumnarProjection(records, ['N', 'S'], { chunkRows });
  for (const index of [0, 255, 256, 511, 512, 598, 599]) {
    assert.deepEqual(projection.recordAt(index), { N: index, S: `linha ${index}` }, `linha ${index}`);
  }
  assert.throws(() => projection.recordAt(600), /out of range/);
  assert.equal([...projection.records()].length, 600);
});

test('a projection keeps null, undefined, boolean and Date apart from their text', () => {
  const when = new Date('2024-01-15T00:00:00.000Z');
  const projection = buildColumnarProjection(
    [
      { V: null }, { V: undefined }, { V: '' }, { V: 'null' },
      { V: 0 }, { V: false }, { V: 'false' }, { V: when },
    ],
    ['V'],
    {},
  );
  const values = [...projection.records()].map((record) => record.V);
  assert.equal(values[0], null);
  assert.equal(values[1], undefined);
  assert.equal(values[2], '');
  assert.equal(values[3], 'null');
  assert.equal(values[4], 0);
  assert.equal(values[5], false);
  assert.equal(values[6], 'false');
  assert.ok(values[7] instanceof Date && values[7].getTime() === when.getTime());
  // Eight values that a naive String() dictionary would collapse into fewer.
  assert.equal(projection.columns.get('V').dictionary.length, 8);
});

test('a projeção devolve o MESMO resultado do caminho direto, em todo formato de plano', async () => {
  // Este é o teste que a ligação do cache no aplicativo exige. Antes, a
  // igualdade estava provada para um plano só; agora muitos formatos passam
  // por aqui, e um resultado divergente seria invisível — a tela mostraria um
  // número plausível vindo de dados guardados.
  const { generateSeededCase } = await import('../dist/packages/core/src/differential-seed.js');
  const { compileQueryPlan } = await import('../dist/packages/core/src/plan.js');
  const { fieldsUsedByPlan } = await import('../dist/packages/core/src/plan-fields.js');

  for (let seed = 0; seed < 24; seed++) {
    const testCase = generateSeededCase(seed);
    const compiled = compileQueryPlan(testCase.spec);
    const conversions = testCase.conversion
      ? { [testCase.conversion.id]: testCase.conversion.definition }
      : {};

    const direct = executeInMemory(testCase.records, compiled, conversions);
    const projection = buildColumnarProjection(testCase.records, fieldsUsedByPlan(compiled));
    const columnar = executeColumnarProjection(projection, compiled, conversions);

    assert.deepEqual(columnar, direct, `seed ${seed} (${testCase.intent}) divergiu`);
  }
});

test('a projeção sobrevive a lote fatiado igual ao do worker', () => {
  // O worker alimenta o builder em lotes de 5.000 registros, não de uma vez.
  // Se a fronteira de lote deslocasse uma linha, o erro apareceria só em
  // arquivo grande - tarde demais.
  const many = Array.from({ length: 12_345 }, (_, index) => ({
    UF: index % 3 === 0 ? 'AC' : 'SP',
    SEXO: index % 2 === 0 ? '1' : '2',
    VALOR: index / 10,
    FLAG: index % 5 === 0,
  }));
  const inOneGo = buildColumnarProjection(many, ['UF', 'SEXO', 'VALOR', 'FLAG']);

  const builder = createColumnarProjectionBuilder(['UF', 'SEXO', 'VALOR', 'FLAG']);
  for (let start = 0; start < many.length; start += 5_000) {
    builder.push(many.slice(start, start + 5_000));
  }
  const inBatches = builder.finish();

  assert.equal(inBatches.rowCount, inOneGo.rowCount);
  assert.deepEqual(executeInMemory(inBatches.records(), plan), executeInMemory(many, plan));
  // E o primeiro e o último registro, que são onde um deslocamento aparece.
  assert.deepEqual(inBatches.recordAt(0), many[0]);
  assert.deepEqual(inBatches.recordAt(many.length - 1), many[many.length - 1]);
});

test('contar entradas não limita memória: o teto agregado é o que segura a aba', () => {
  // O defeito que isto tranca: o cache limitava só a QUANTIDADE de projeções,
  // e quem chamava conferia cada uma contra o próprio orçamento. Quatro
  // projeções de 192 MiB passavam individualmente e conviviam em 768 MiB —
  // a soma não era olhada por ninguém.
  const uma = buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR']);
  const tamanho = uma.estimatedBytes;
  assert.ok(tamanho > 0, 'a projeção precisa saber quanto ocupa');

  // Orçamento para duas e meia: a terceira força despejo mesmo cabendo na
  // contagem de entradas, que é generosa de propósito neste teste.
  const cache = createColumnarProjectionCache(10, tamanho * 2.5);
  cache.set('fonte-a', buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR']));
  cache.set('fonte-b', buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR']));
  assert.equal(cache.size, 2);
  assert.ok(cache.estimatedBytes <= tamanho * 2.5);

  cache.set('fonte-c', buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR']));
  assert.ok(cache.estimatedBytes <= tamanho * 2.5, 'o teto agregado não pode ser ultrapassado');
  assert.equal(cache.size, 2, 'a mais antiga saiu para a nova caber');
  assert.ok(cache.get('fonte-c', ['UF']), 'a recém-guardada continua lá');
  assert.equal(cache.get('fonte-a', ['UF']), undefined, 'a mais antiga foi despejada');
});

test('projeção maior que o orçamento inteiro não é guardada, e não despeja as outras', () => {
  // Aceitá-la esvaziaria o cache para no fim ficar com uma coisa que também
  // não cabe — perde-se o que era útil e não se ganha nada.
  const uma = buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR']);
  const cache = createColumnarProjectionCache(10, uma.estimatedBytes * 1.5);
  cache.set('pequena', buildColumnarProjection(records, ['UF']));
  const antes = cache.size;
  const guardadoAntes = cache.estimatedBytes;

  const gigante = buildColumnarProjection(records, ['UF', 'SEXO', 'VALOR', 'FLAG']);
  const cacheApertado = createColumnarProjectionCache(10, 1);
  cacheApertado.set('nao-cabe', gigante);
  assert.equal(cacheApertado.size, 0, 'não guarda o que sozinho estoura o orçamento');

  cache.set('outra-pequena', buildColumnarProjection(records, ['SEXO']));
  assert.ok(cache.size >= antes, 'as pequenas continuam convivendo');
  assert.ok(cache.estimatedBytes >= guardadoAntes);
});

test('o orçamento é validado, porque zero ou negativo esvaziaria tudo em silêncio', () => {
  assert.throws(() => createColumnarProjectionCache(4, 0), /budget must be positive/);
  assert.throws(() => createColumnarProjectionCache(4, -1), /budget must be positive/);
  assert.throws(() => createColumnarProjectionCache(4, Number.NaN), /budget must be positive/);
  // Sem orçamento declarado o comportamento antigo é preservado.
  const semTeto = createColumnarProjectionCache(2);
  semTeto.set('a', buildColumnarProjection(records, ['UF']));
  assert.equal(semTeto.size, 1);
  assert.ok(semTeto.estimatedBytes > 0);
});
