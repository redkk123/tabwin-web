/**
 * Deterministic small cases for differential testing against the real
 * TabWin 4.15 - the "diferencial por seed" phase of
 * `docs/testing/GOLDEN_CORPUS_QUEUE.md` §4.
 *
 * What this module does and does not claim:
 *
 * - It **generates** a fixture and a plan reproducibly from a seed, so the
 *   exact same bytes can be opened in TabWin 4.15 and in this engine.
 * - It does **not** decide who is right. This engine's output is one side of
 *   a comparison; the oracle is the real program, and only a human with
 *   TabWin installed can produce that half. Nothing here may be promoted to
 *   a golden without that capture - the project's rule that a behaviour is
 *   never "compatible" by supposition applies in full.
 *
 * The generated cases deliberately aim at the corners where the two engines
 * could plausibly disagree - unclassified values, empty categories, ties in
 * ordering, sums with decimals - rather than at uniformly easy data, because
 * a differential harness that only produces easy cases proves nothing.
 */

import type { CnvDefinition } from '../../formats/src/cnv-model.js';
import type { DataRecord, TabulationSpec } from './model.js';

/**
 * A tiny, fast, fully deterministic PRNG (mulberry32). Determinism is the
 * whole point: the same seed must produce byte-identical fixtures on any
 * machine, or the two engines are not being fed the same case.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeededFieldSpec {
  name: string;
  type: 'C' | 'N';
  length: number;
  decimalCount: number;
}

export interface SeededCase {
  seed: number;
  /** Field descriptors, ready for the DBF writer. */
  fields: SeededFieldSpec[];
  records: DataRecord[];
  /** The tabulation to run in both engines. */
  spec: TabulationSpec;
  /** A CNV the plan may reference, or undefined when the case tabulates raw values. */
  conversion?: { id: string; definition: CnvDefinition };
  /** Plain-language description of what corner this case aims at. */
  intent: string;
}

const UF_CODES = ['11', '12', '13', '21', '22', '31', '33', '35', '41', '43', '50', '52'];
/** Deliberately includes codes the CNV below does not cover, to exercise unclassified handling. */
const SEX_CODES = ['1', '2', '9', '0'];

/**
 * Builds one differential case from a seed.
 *
 * The shape varies with the seed so a run over a range of seeds covers
 * several plan kinds, but every field of the result is a pure function of the
 * seed alone - no clock, no randomness outside the PRNG, no environment.
 */
export function generateSeededCase(seed: number): SeededCase {
  if (!Number.isInteger(seed) || seed < 0) throw new Error('a differential seed must be a non-negative whole number');
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1));

  const recordCount = between(8, 60);
  const records: DataRecord[] = [];
  for (let index = 0; index < recordCount; index++) {
    records.push({
      UF: pick(UF_CODES),
      SEXO: pick(SEX_CODES),
      // Two decimals, so a sum exercises decimal accumulation rather than
      // integer addition only.
      VALOR: Math.round(random() * 100_000) / 100,
      IDADE: between(0, 109),
    });
  }

  const fields: SeededFieldSpec[] = [
    { name: 'UF', type: 'C', length: 2, decimalCount: 0 },
    { name: 'SEXO', type: 'C', length: 1, decimalCount: 0 },
    { name: 'VALOR', type: 'N', length: 12, decimalCount: 2 },
    { name: 'IDADE', type: 'N', length: 3, decimalCount: 0 },
  ];

  // A CNV that covers only part of SEXO's domain: '9' and '0' fall outside it
  // on purpose, so every case that uses it exercises the unclassified path.
  const definition: CnvDefinition = {
    categoryCount: 2,
    codeLength: 1,
    mode: 'short',
    precedence: 'first-match-wins',
    categories: [
      { sequence: 1, label: 'Masculino' },
      { sequence: 2, label: 'Feminino' },
    ],
    rules: [
      { categorySequence: 1, exactCodes: ['1'], ranges: [], sourceOrder: 0, sourceLine: 2 },
      { categorySequence: 2, exactCodes: ['2'], ranges: [], sourceOrder: 1, sourceLine: 3 },
    ],
    comments: [],
    warnings: [],
    headerLine: 1,
  };
  const conversion = { id: 'SEED_SEXO.CNV', definition };

  // Four plan shapes, chosen by the seed, each aimed at a different corner.
  const shape = seed % 4;
  const useConversion = shape === 1 || shape === 3;
  const spec: TabulationSpec = {
    compatibilityProfile: 'tabwin-4.15',
    rows: shape === 1 || shape === 3
      ? { field: 'SEXO', conversionId: conversion.id, ...(shape === 3 ? { unclassifiedPolicy: 'discriminate' as const } : {}) }
      : { field: 'UF' },
    ...(shape === 2 ? { columns: { field: 'SEXO' } } : {}),
    measure: shape === 2
      ? { kind: 'sum' as const, field: 'VALOR' }
      : { kind: 'count' as const },
    filters: shape === 3
      ? [{ field: 'IDADE', kind: 'numeric-range' as const, minimum: 10, maximum: 79, includeMinimum: true, includeMaximum: true }]
      : [],
    suppressZeroRows: shape === 0,
  };

  const intent = [
    'contagem por UF com supressão de linhas zeradas',
    'contagem por SEXO com CNV que não cobre todo o domínio (não classificados omitidos)',
    'soma de VALOR com decimais, cruzando UF por SEXO',
    'CNV parcial com não classificados discriminados, sob filtro de faixa etária',
  ][shape]!;

  return {
    seed,
    fields,
    records,
    spec,
    ...(useConversion ? { conversion } : {}),
    intent,
  };
}
