#!/usr/bin/env node
/**
 * Emits differential-test cases for comparison against the real TabWin 4.15
 * ("diferencial por seed", docs/testing/GOLDEN_CORPUS_QUEUE.md §4).
 *
 * For each seed it writes, into the output directory:
 *
 *   seed-<n>.dbf        the fixture, as a real DBF TabWin 4.15 can open
 *   seed-<n>.cnv        the conversion the plan uses, when it uses one
 *   seed-<n>.plan.json  the plan, in this project's own normalized form
 *   seed-<n>.ours.txt   what THIS engine produces for that plan
 *   README.md           how to run the other half by hand
 *
 * It deliberately does not produce a verdict. This engine's output is one
 * side; the oracle is the real program, and only someone with TabWin
 * installed can produce the other. A divergence becomes a permanent golden
 * only after that capture - never by supposition, and a golden is never
 * edited to make a test pass.
 *
 *   node scripts/differential-seed.mjs --seeds 1-20 --out .seed-cases
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateSeededCase } from '../dist/packages/core/src/differential-seed.js';
import { compileQueryPlan } from '../dist/packages/core/src/plan.js';
import { executeInMemory } from '../dist/packages/core/src/execute.js';
import { writeDbf } from '../dist/packages/export/src/dbf-writer.js';
import { serializeCnv } from '../dist/packages/formats/src/cnv-serializer.js';

function parseSeeds(value) {
  const range = /^(\d+)-(\d+)$/.exec(value ?? '');
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    if (to < from) throw new Error('--seeds range runs backwards');
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  }
  return (value ?? '1').split(',').map((part) => {
    const seed = Number(part.trim());
    if (!Number.isInteger(seed) || seed < 0) throw new Error(`invalid seed: ${part}`);
    return seed;
  });
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

/** The result rendered as plain text, so a human can eyeball it beside TabWin's own screen. */
function renderResult(result) {
  const lines = [];
  lines.push(`registros lidos: ${result.recordsSeen}`);
  lines.push(`registros aceitos: ${result.recordsAccepted}`);
  lines.push('');
  const header = ['linha', ...result.columns.map((column) => column.label)];
  lines.push(header.join('\t'));
  result.rows.forEach((row, index) => {
    lines.push([row.label, ...(result.cells[index] ?? []).map((value) => String(value))].join('\t'));
  });
  if (result.warnings.length) {
    lines.push('');
    lines.push('avisos:');
    for (const warning of result.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n') + '\n';
}

const seeds = parseSeeds(argument('--seeds', '1-10'));
const outDir = argument('--out', '.seed-cases');
fs.mkdirSync(outDir, { recursive: true });

const index = [];
for (const seed of seeds) {
  const testCase = generateSeededCase(seed);
  const base = path.join(outDir, `seed-${seed}`);

  // The fixture as a real DBF, so the very same bytes go into both engines.
  const dbfFields = testCase.fields.map((field) => ({
    name: field.name, type: field.type, length: field.length, decimalCount: field.decimalCount,
  }));
  // The DBF header carries a "last updated" date. Left to default it would be
  // today's, so the same seed would emit different bytes tomorrow - and the
  // reproducibility this whole harness rests on would be a fiction. Pinned.
  fs.writeFileSync(`${base}.dbf`, writeDbf(testCase.records, dbfFields, {
    dateOfLastUpdate: new Date(Date.UTC(2000, 0, 1)),
  }));

  const conversions = {};
  if (testCase.conversion) {
    fs.writeFileSync(`${base}.cnv`, serializeCnv(testCase.conversion.definition));
    conversions[testCase.conversion.id] = testCase.conversion.definition;
  }

  const plan = compileQueryPlan(testCase.spec);
  fs.writeFileSync(`${base}.plan.json`, `${JSON.stringify({ intent: testCase.intent, spec: testCase.spec }, null, 2)}\n`);

  const result = executeInMemory(testCase.records, plan, conversions);
  fs.writeFileSync(`${base}.ours.txt`, renderResult(result));

  index.push({ seed, intent: testCase.intent, records: testCase.records.length, rows: result.rows.length });
  console.log(`seed ${seed}: ${testCase.records.length} registros, ${result.rows.length} linhas — ${testCase.intent}`);
}

fs.writeFileSync(path.join(outDir, 'README.md'), `# Casos diferenciais por seed

Gerados por \`scripts/differential-seed.mjs\`. Cada caso é uma função pura da
sua seed: a mesma seed produz os mesmos bytes em qualquer máquina, que é o que
permite alimentar os dois motores com exatamente o mesmo caso.

## O que está aqui

| arquivo | o que é |
| --- | --- |
| \`seed-N.dbf\` | a fixture, DBF real que o TabWin 4.15 abre |
| \`seed-N.cnv\` | a conversão que o plano usa, quando usa alguma |
| \`seed-N.plan.json\` | o plano, na forma normalizada deste projeto |
| \`seed-N.ours.txt\` | o que **este** motor produz |

## A outra metade — precisa de você

Este script **não** decide quem está certo. Ele produz um dos lados; o oráculo
é o programa real. Para cada seed:

1. abra \`seed-N.dbf\` no TabWin 4.15 (com \`seed-N.cnv\` na pasta, se houver);
2. monte a tabulação descrita em \`seed-N.plan.json\` (\`intent\` diz em uma
   frase o que o caso exercita);
3. compare com \`seed-N.ours.txt\`.

Uma divergência vira golden permanente **depois** dessa captura, seguindo
\`docs/testing/G001_CAPTURE_PROTOCOL.md\`. Nunca por suposição, e o golden
nunca é editado para o teste passar.

## Índice desta rodada

${index.map((item) => `- seed ${item.seed}: ${item.records} registros, ${item.rows} linhas — ${item.intent}`).join('\n')}
`);

console.log(`\n${seeds.length} caso(s) em ${outDir}. Leia ${path.join(outDir, 'README.md')} para a metade que precisa do TabWin real.`);
