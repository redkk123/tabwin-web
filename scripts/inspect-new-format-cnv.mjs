#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function splitComment(line) {
  const index = line.indexOf(';');
  return index < 0 ? { body: line } : { body: line.slice(0, index), comment: line.slice(index + 1).trim() };
}

export function inspectNewFormatCnvText(text) {
  const normalized = text.split('\u001A')[0].replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let header;
  let bodyStart = -1;
  for (let index = 0; index < lines.length; index++) {
    const { body } = splitComment(lines[index] ?? '');
    if (!body.trim()) continue;
    const match = body.match(/^N\s*(\d+)\s+(\d+)(?:\s+\S+)?\s*$/i);
    if (!match) throw new Error(`linha ${index + 1}: o primeiro conteúdo não é um cabeçalho CNV formato N`);
    header = { categoryCount: Number(match[1]), codeLength: Number(match[2]), sourceLine: index + 1 };
    bodyStart = index + 1;
    break;
  }
  if (!header) throw new Error('CNV sem cabeçalho');

  const rows = [];
  for (let index = bodyStart; index < lines.length; index++) {
    const { body } = splitComment(lines[index] ?? '');
    if (!body.trim()) continue;
    if (body.length < 113) {
      throw new Error(`linha ${index + 1}: linha N tem ${body.length} caracteres; esperado >= 113`);
    }
    const prefix = body.slice(0, 5).trim();
    const sequenceText = body.slice(5, 9).trim();
    if (!/^\d+$/.test(sequenceText)) throw new Error(`linha ${index + 1}: sequência inválida: ${JSON.stringify(sequenceText)}`);
    const sequence = Number(sequenceText);
    const label = body.slice(11, 111).trim();
    const codesText = body.slice(112).trim();
    const codes = codesText.split(',').map((value) => value.trim()).filter(Boolean);
    rows.push({ sourceLine: index + 1, prefix, sequence, label, codesText, codes });
  }

  const bySequence = new Map();
  for (const row of rows) {
    const group = bySequence.get(row.sequence) ?? [];
    group.push(row);
    bySequence.set(row.sequence, group);
  }

  // G012's suspicious shape is easiest to see as repeated *classification
  // payload*, independent of label/prefix. Keep this purely observational:
  // duplicate payloads are evidence to inspect, never executable semantics.
  const payloadGroups = new Map();
  for (const [sequence, group] of bySequence.entries()) {
    const payload = group.map((row) => row.codesText).join('\n');
    if (!payload) continue;
    const matches = payloadGroups.get(payload) ?? [];
    matches.push(sequence);
    payloadGroups.set(payload, matches);
  }
  const duplicatePayloads = [...payloadGroups.entries()]
    .filter(([, sequences]) => sequences.length > 1)
    .map(([payload, sequences]) => ({ payload, sequences }))
    .sort((a, b) => a.sequences[0] - b.sequences[0]);

  return {
    header,
    parsedRows: rows.length,
    uniqueSequences: bySequence.size,
    rows,
    duplicatePayloads,
  };
}

function parseSequenceFilter(argv) {
  const index = argv.indexOf('--sequences');
  if (index < 0) return null;
  const raw = argv[index + 1];
  if (!raw) throw new Error('--sequences exige uma lista, por exemplo 104,524');
  const values = raw.split(',').map((value) => Number(value.trim()));
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) throw new Error('--sequences contém valor inválido');
  return new Set(values);
}

async function main(argv) {
  const filePath = argv[0];
  if (!filePath || filePath.startsWith('--')) {
    throw new Error('uso: npm run inspect:cnv-n -- <NATJUR.CNV> [--sequences 104,524] [--json]');
  }
  const bytes = await fs.readFile(filePath);
  const text = new TextDecoder('windows-1252').decode(bytes);
  const inspection = inspectNewFormatCnvText(text);
  const sequenceFilter = parseSequenceFilter(argv);
  const rows = sequenceFilter ? inspection.rows.filter((row) => sequenceFilter.has(row.sequence)) : inspection.rows;

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ...inspection, rows }, null, 2)}\n`);
    return;
  }

  console.log(`${path.basename(filePath)} | N ${inspection.header.categoryCount} ${inspection.header.codeLength}`);
  console.log(`linhas=${inspection.parsedRows} sequências=${inspection.uniqueSequences} payloads duplicados=${inspection.duplicatePayloads.length}`);
  console.log('linha\tprefixo\tseq\trótulo\tcódigos');
  for (const row of rows) {
    console.log(`${row.sourceLine}\t${row.prefix}\t${row.sequence}\t${row.label}\t${row.codesText}`);
  }
  if (inspection.duplicatePayloads.length) {
    console.log('\nPayloads de códigos idênticos entre sequências:');
    for (const duplicate of inspection.duplicatePayloads) {
      console.log(`- ${duplicate.sequences.join(', ')} :: ${duplicate.payload}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
