import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createResearchPlan,
  parseResearchRequest,
  serializeResearchPlan,
} from '../dist/packages/acquisition/src/research.js';

const request = {
  schema: 'tabwin-web.research-request',
  version: 1,
  title: 'Pesquisa longitudinal explícita',
  datasets: [
    { system: 'SIHSUS', fileType: 'RD', years: ['2024', '2023'], months: ['02', '01'], ufs: ['SP', 'AC'] },
    { system: 'SIM', fileType: 'DO', years: ['2024', '2023'], ufs: ['BR'] },
  ],
  desiredFields: ['SEXO', 'IDADE'],
  conceptTerms: ['B57'],
};

test('research request expands deterministically without interpreting user concept terms', () => {
  const plan = createResearchPlan(request);
  assert.equal(plan.estimate.queryCount, 10);
  assert.equal(plan.estimate.fileCount, null);
  assert.equal(plan.estimate.bytes, null);
  assert.deepEqual(plan.request.conceptTerms, ['B57']);
  assert.deepEqual(plan.datasets[0].queries[0], { system: 'SIHSUS', fileType: 'RD', year: '2023', month: '01', uf: 'AC' });
  assert.deepEqual(plan.datasets[1].queries[0], { system: 'SIM', fileType: 'DO', year: '2023' });
  assert.equal(serializeResearchPlan(plan), serializeResearchPlan(createResearchPlan(parseResearchRequest(JSON.stringify(request)))));
});

test('research request rejects incompatible geography, duplicates and unknown catalogs', () => {
  assert.throws(() => createResearchPlan({ ...request, datasets: [{ system: 'SIHSUS', fileType: 'RD', years: ['2024'], months: ['01'], ufs: ['BR'] }] }), /incompatível/);
  assert.throws(() => createResearchPlan({ ...request, datasets: [request.datasets[0], request.datasets[0]] }), /duplicado/);
  assert.throws(() => createResearchPlan({ ...request, datasets: [{ system: 'UNKNOWN', fileType: 'X', years: ['2024'], ufs: ['BR'] }] }), /desconhecido/);
});
