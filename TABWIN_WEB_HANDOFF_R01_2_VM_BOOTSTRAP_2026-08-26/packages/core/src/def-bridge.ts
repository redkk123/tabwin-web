import type {
  DefConversionOption,
  DefDbfLookupOption,
  DefDefinition,
  DefIncrement,
  DefOption,
} from '../../formats/src/def-model.js';
import type { DataRecord, DimensionLookupDefinition, DimensionSpec, FilterSpec, MeasureSpec } from './model.js';

export class UnsupportedDefFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDefFeatureError';
  }
}

export function conversionIdForDefOption(option: DefConversionOption): string {
  // File name is intentionally retained rather than case-folded: provenance will
  // later hash the exact artifact. Callers may map this id to a content-addressed id.
  return option.conversionFile;
}

function requireConversion(option: DefOption): DefConversionOption {
  if (option.kind !== 'conversion') {
    const detail = option.kind === 'dbf-lookup'
      ? `DBF lookup ${option.lookupFile}`
      : `external lookup ${option.resourceFile}`;
    throw new UnsupportedDefFeatureError(
      `DEF option "${option.label}" uses ${detail}; lookup execution is not implemented in R01`,
    );
  }
  return option;
}

export function dimensionFromDefOption(option: DefOption): DimensionSpec {
  if (option.kind === 'dbf-lookup') {
    return { field: option.field, lookupId: option.lookupFile };
  }
  const conversion = requireConversion(option);
  return {
    field: conversion.field,
    conversionId: conversionIdForDefOption(conversion),
    startPosition: conversion.startPosition,
  };
}

/** Builds the exact ordered code -> display-label axis a DEF DBF lookup declares. */
export function lookupDefinitionFromDefOption(
  option: DefDbfLookupOption,
  records: readonly DataRecord[],
): DimensionLookupDefinition {
  const entries: Array<{ key: string; label: string }> = [];
  const labelsByKey = new Map<string, string>();
  for (const record of records) {
    const key = String(record[option.field] ?? '').trim();
    const name = String(record[option.lookupLabelField] ?? '').trim();
    if (!key) continue;
    const label = name ? `${key} ${name}` : key;
    const previous = labelsByKey.get(key);
    if (previous !== undefined) {
      if (previous !== label) throw new Error(`${option.lookupFile}: conflicting labels for lookup key ${key}`);
      continue;
    }
    labelsByKey.set(key, label);
    entries.push({ key, label });
  }
  if (!entries.length) {
    throw new Error(`${option.lookupFile}: no usable ${option.field} -> ${option.lookupLabelField} lookup rows`);
  }
  return { kind: 'dbf-lookup', entries };
}

export function filterFromDefOption(
  option: DefOption,
  acceptedCategorySequences: Array<string | number>,
): FilterSpec {
  const conversion = requireConversion(option);
  return {
    field: conversion.field,
    conversionId: conversionIdForDefOption(conversion),
    startPosition: conversion.startPosition,
    acceptedCategories: acceptedCategorySequences.map(String),
  };
}

export function frequencyMeasureFromDef(definition: DefDefinition): MeasureSpec {
  return {
    kind: 'count',
    ...(definition.groupedCountField ? { weightField: definition.groupedCountField } : {}),
  };
}

export function sumMeasureFromDefIncrement(increment: DefIncrement): MeasureSpec {
  // G003 established that the real engine headers the column with the
  // increment's own label ("Valor Total"), so it travels with the measure.
  const label = increment.label.trim();
  return { kind: 'sum', field: increment.field, ...(label ? { label } : {}) };
}
