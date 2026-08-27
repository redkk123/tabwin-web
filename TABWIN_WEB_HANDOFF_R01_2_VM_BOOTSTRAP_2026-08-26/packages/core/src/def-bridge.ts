import type {
  DefConversionOption,
  DefDefinition,
  DefIncrement,
  DefOption,
} from '../../formats/src/def-model.js';
import type { DimensionSpec, FilterSpec, MeasureSpec } from './model.js';

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
    throw new UnsupportedDefFeatureError(
      `DEF option "${option.label}" uses DBF lookup ${option.lookupFile}; DBF lookup execution is not implemented in R01`,
    );
  }
  return option;
}

export function dimensionFromDefOption(option: DefOption): DimensionSpec {
  const conversion = requireConversion(option);
  return {
    field: conversion.field,
    conversionId: conversionIdForDefOption(conversion),
    startPosition: conversion.startPosition,
  };
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
  return { kind: 'sum', field: increment.field };
}
