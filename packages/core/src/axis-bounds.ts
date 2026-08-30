/**
 * The one rule for a manual chart-axis bound pair, shared by every place that
 * has to apply it.
 *
 * Before this existed, "both present, and max strictly greater than min" was
 * written out by hand in four places with four different reactions to a bad
 * pair: `resolveAxis` (packages/visualization/src/chart-model.ts) falls back
 * to the data's own range, the live editor (apps/web/src/main.ts) shows a
 * toast and does the same, saving a recipe (also main.ts) silently omits the
 * pair, and loading one (packages/core/src/recipe.ts) throws. All four
 * agreed today, but nothing stopped them from drifting - a future change to
 * what counts as "valid" (say, allowing `max === min` for a single-value
 * axis) would have to be found and repeated by hand in every one of them.
 * This makes the definition itself the one place that can change.
 *
 * `core` is the base package every other one already depends on, so this
 * lives here rather than in `visualization`, which `recipe.ts` cannot import
 * without introducing a dependency in the wrong direction.
 */
export type AxisBoundsValidity =
  | { kind: 'none' }
  | { kind: 'incomplete' }
  | { kind: 'inverted' }
  | { kind: 'valid'; min: number; max: number };

export function validateAxisBounds(
  min: number | undefined,
  max: number | undefined,
): AxisBoundsValidity {
  if (min === undefined && max === undefined) return { kind: 'none' };
  if (min === undefined || max === undefined) return { kind: 'incomplete' };
  if (!(max > min)) return { kind: 'inverted' };
  return { kind: 'valid', min, max };
}
