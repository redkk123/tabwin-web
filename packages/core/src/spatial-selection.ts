import type { FilterSpec } from './model.js';

/**
 * Converts an explicit set of selected map geocodes into an ordinary raw-value
 * filter. No field inference occurs here: the caller must name the dataset
 * field that carries the same geocode namespace as the map.
 */
export function spatialSelectionFilter(field: string, geocodes: Iterable<string>): FilterSpec {
  const cleanField = field.trim();
  if (!cleanField) throw new Error('spatial selection requires an explicit dataset field');
  const acceptedCategories = [...new Set([...geocodes].map((value) => value.trim()).filter(Boolean))];
  if (!acceptedCategories.length) throw new Error('spatial selection requires at least one geocode');
  return {
    kind: 'categories',
    field: cleanField,
    mode: 'include',
    acceptedCategories,
  };
}
