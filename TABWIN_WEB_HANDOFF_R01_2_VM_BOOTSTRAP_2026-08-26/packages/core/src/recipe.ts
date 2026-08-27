import type { QueryPlan, SourceFingerprint, TabulationSpec } from './model.js';
import { compileQueryPlan } from './plan.js';

export interface ConversionFingerprint {
  id: string;
  name: string;
  sha256: string;
  size: number;
}

export interface AnalysisRecipeV1 {
  schema: 'tabwin-web.recipe';
  version: 1;
  name?: string;
  spec: TabulationSpec;
  conversions: ConversionFingerprint[];
  sourceHints: Array<Pick<SourceFingerprint, 'name' | 'sha256' | 'size'>>;
}

export interface RunManifestV1 {
  schema: 'tabwin-web.run-manifest';
  version: 1;
  appVersion: string;
  executedAt: string;
  plan: QueryPlan;
  sources: SourceFingerprint[];
  conversions: ConversionFingerprint[];
  result: {
    recordsSeen: number;
    recordsAccepted: number;
    rowCount: number;
    columnCount: number;
    warnings: string[];
  };
}

/**
 * Deterministic JSON representation for diffs, signatures and future content
 * addressing. Array order is preserved because it can encode meaningful legacy
 * precedence; object keys are sorted recursively.
 */
export function stableJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return current;
  };
  return JSON.stringify(normalize(value), null, 2);
}

export function serializeRecipe(recipe: AnalysisRecipeV1): string {
  return stableJson(recipe);
}

export function parseRecipe(json: string): AnalysisRecipeV1 {
  const parsed = JSON.parse(json) as Partial<AnalysisRecipeV1>;
  if (parsed.schema !== 'tabwin-web.recipe' || parsed.version !== 1 || !parsed.spec ||
      !Array.isArray(parsed.conversions) || !Array.isArray(parsed.sourceHints)) {
    throw new Error('unsupported or invalid TabWin Web recipe');
  }
  compileQueryPlan(parsed.spec);
  for (const conversion of parsed.conversions) {
    if (!conversion || typeof conversion.id !== 'string' || typeof conversion.name !== 'string' ||
        typeof conversion.sha256 !== 'string' || typeof conversion.size !== 'number') {
      throw new Error('invalid conversion fingerprint in TabWin Web recipe');
    }
  }
  for (const source of parsed.sourceHints) {
    if (!source || typeof source.name !== 'string' || typeof source.sha256 !== 'string' ||
        typeof source.size !== 'number') {
      throw new Error('invalid source fingerprint in TabWin Web recipe');
    }
  }
  return parsed as AnalysisRecipeV1;
}
