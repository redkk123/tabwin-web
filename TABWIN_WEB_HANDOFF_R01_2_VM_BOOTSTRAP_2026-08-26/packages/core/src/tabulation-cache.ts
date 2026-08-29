/**
 * L3 result cache: memoizes a finished {@link TabulationResult} by the exact
 * plan and conversions that produced it.
 *
 * Measured motivation: tabulating the real national Dengue file costs
 * roughly 13 seconds even with field projection (`bench:plan-projection`).
 * A user experimenting with sort, presentation or a quick filter toggle can
 * return to a plan they already ran; re-streaming the whole dataset for an
 * answer already computed is pure waste. This cache is what turns that
 * repeat into a Map lookup.
 *
 * Deliberately not a general LRU library: bounded, single-purpose, and small
 * enough that its correctness — same key in, same result out, oldest evicted
 * first past capacity — is verifiable by inspection and by the tests next to
 * it.
 */

import { stableJson } from './recipe.js';
import type { ConversionRegistry } from './execute.js';
import type { QueryPlan, TabulationResult } from './model.js';

export interface TabulationCacheKey {
  plan: QueryPlan;
  conversions: ConversionRegistry;
}

export interface TabulationResultCache {
  /** `undefined` on a miss; never throws on an unknown key. */
  get(key: TabulationCacheKey): TabulationResult | undefined;
  set(key: TabulationCacheKey, result: TabulationResult): void;
  /** Call whenever the underlying records change — a new or appended source.
   *  A cached result answers for the plan *and* the data it last ran over;
   *  once the data moves, every entry is stale, not just some of it. */
  clear(): void;
  readonly size: number;
}

const DEFAULT_MAX_ENTRIES = 20;

function cacheKeyFor(key: TabulationCacheKey): string {
  // stableJson sorts object keys but preserves array order, which matters
  // here: filter and cross-field-rule order can change which plan actually
  // ran, so two plans that differ only in that order must not collide.
  return stableJson({ plan: key.plan, conversions: key.conversions });
}

export function createTabulationResultCache(maxEntries = DEFAULT_MAX_ENTRIES): TabulationResultCache {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`limite inválido de entradas em cache: ${maxEntries}`);
  }
  // Map iteration order is insertion order, and re-inserting on every hit
  // moves an entry to the end — exactly the ordering an LRU eviction needs,
  // with no extra bookkeeping.
  const entries = new Map<string, TabulationResult>();

  return {
    get(key) {
      const cacheKey = cacheKeyFor(key);
      const hit = entries.get(cacheKey);
      if (hit === undefined) return undefined;
      entries.delete(cacheKey);
      entries.set(cacheKey, hit);
      return hit;
    },
    set(key, result) {
      const cacheKey = cacheKeyFor(key);
      entries.delete(cacheKey);
      entries.set(cacheKey, result);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
