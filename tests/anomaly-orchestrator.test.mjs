/**
 * Regression cover for the anomaly orchestrator, adapting two of the
 * synthetic golden fixtures the master spec asks for (section 22.3):
 * `audit_diffuse_vs_concentrated` and `audit_systematic_category`. The point
 * of these is generalization - the code knows nothing about municipalities,
 * hospitals or diseases, and has to find the same shape of signal from raw
 * group/reference records alone.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categoryDisplayLabel,
  createAuditScanAccumulator,
  OTHER_CATEGORIES_KEY,
} from '../dist/packages/analysis/src/anomaly-orchestrator.js';

function repeat(value, times) {
  return Array.from({ length: times }, () => value);
}

test('audit_diffuse_vs_concentrated: a group concentrated in one place stands out against a diffuse reference', () => {
  // Group: 100 records, 95 of them in "X001". Reference: 400 records spread
  // over 100 different places, ~4 each - the "difuso" half of the fixture.
  const groupRecords = [
    ...repeat({ LOCAL: 'X001', isGroup: true }, 95),
    ...repeat({ LOCAL: 'X002', isGroup: true }, 3),
    ...repeat({ LOCAL: 'X003', isGroup: true }, 2),
  ];
  const referenceRecords = Array.from({ length: 400 }, (_, index) => ({
    LOCAL: `Y${(index % 100).toString().padStart(3, '0')}`, isGroup: false,
  }));
  const accumulator = createAuditScanAccumulator((record) => record.isGroup, {
    numericFields: [],
    categoricalFields: ['LOCAL'],
  });
  accumulator.push(groupRecords);
  accumulator.push(referenceRecords);
  const result = accumulator.finish();

  const signal = result.signals.find((item) => item.fields.includes('LOCAL') && item.kind !== 'missingness-shift');
  assert.ok(signal, 'a concentrated group against a diffuse reference must produce a signal');
  assert.notEqual(signal.severity, 'info');
  // No signal may declare this an error - the whole point of the module.
  for (const s of result.signals) {
    assert.doesNotMatch(s.explanation, /erro|inválido|incorreto/i);
    assert.equal(s.automaticAction, 'none');
  }
});

test('audit_systematic_category: a category present at the same rate everywhere is not flagged as group-specific', () => {
  // Category "raro" is ~9% of the group AND ~9% of a much larger reference -
  // rare, but not specific to the group. Must NOT read as concentration or
  // distribution shift.
  const groupRecords = [
    ...repeat({ CAT: 'raro', isGroup: true }, 9),
    ...repeat({ CAT: 'comum', isGroup: true }, 91),
  ];
  const referenceRecords = [
    ...repeat({ CAT: 'raro', isGroup: false }, 90),
    ...repeat({ CAT: 'comum', isGroup: false }, 910),
  ];
  const accumulator = createAuditScanAccumulator((record) => record.isGroup, {
    numericFields: [],
    categoricalFields: ['CAT'],
  });
  accumulator.push(groupRecords);
  accumulator.push(referenceRecords);
  const result = accumulator.finish();

  const shapeSignals = result.signals.filter((item) =>
    item.fields.includes('CAT') && (item.kind === 'distribution-shift' || item.kind === 'subgroup-divergence'));
  assert.deepEqual(shapeSignals, [], 'a category at the same rate in both groups must not read as group-specific');
});

test('numeric outliers are found on the group\'s own distribution and never delete anything', () => {
  const groupRecords = [
    ...repeat({ VALOR: 10, isGroup: true }, 8),
    { VALOR: 11, isGroup: true }, { VALOR: 9, isGroup: true }, { VALOR: 500, isGroup: true },
  ];
  const accumulator = createAuditScanAccumulator((record) => record.isGroup, {
    numericFields: ['VALOR'],
    categoricalFields: [],
  });
  accumulator.push(groupRecords);
  const result = accumulator.finish();

  const signal = result.signals.find((item) => item.kind === 'numeric-outlier');
  assert.ok(signal);
  assert.equal(signal.fields[0], 'VALOR');
  assert.equal(result.groupRecords, groupRecords.length);
  assert.equal(result.referenceRecords, 0);
});

test('a field needing more values than the retention limit is skipped, not silently sampled', () => {
  const groupRecords = Array.from({ length: 50 }, (_, index) => ({ VALOR: index, isGroup: true }));
  const accumulator = createAuditScanAccumulator((record) => record.isGroup, {
    numericFields: ['VALOR'],
    categoricalFields: [],
    maxRetainedNumericValues: 10,
  });
  accumulator.push(groupRecords);
  const result = accumulator.finish();

  assert.deepEqual(result.diagnostics.skipped, ['VALOR']);
  assert.equal(result.diagnostics.fieldsAnalyzed, 0);
  assert.ok(result.diagnostics.warnings[0].includes('VALOR'));
  assert.equal(result.signals.length, 0);
});

test('the cardinality-overflow bucket key is translated before it could ever reach user-facing text', () => {
  // The concentration signal that interpolates a raw category key into its
  // explanation can never legitimately fire with that key equal to the
  // overflow sentinel (group and reference share one cardinality cap, so the
  // reference's post-cap distinct count can never exceed the group's once
  // the group itself has overflowed) - so this exercises the translation
  // directly rather than trying to force an unreachable end-to-end shape.
  assert.notEqual(OTHER_CATEGORIES_KEY, '__outras_categorias__', 'the sentinel must stay unrepresentable in real data');
  assert.equal(categoryDisplayLabel(OTHER_CATEGORIES_KEY), 'outras categorias');
  assert.equal(categoryDisplayLabel('CID10-A519'), 'CID10-A519', 'an ordinary key must pass through untouched');
});

test('missingness only signals when the effect itself is large, not merely when N makes a small gap significant', () => {
  // A real, large gap: 40% missing in the group vs 5% in a big reference.
  const groupRecords = [
    ...repeat({ CAMPO: 'x', isGroup: true }, 60), ...repeat({ CAMPO: undefined, isGroup: true }, 40),
  ];
  const referenceRecords = [
    ...repeat({ CAMPO: 'x', isGroup: false }, 950), ...repeat({ CAMPO: undefined, isGroup: false }, 50),
  ];
  const accumulator = createAuditScanAccumulator((record) => record.isGroup, {
    numericFields: [],
    categoricalFields: ['CAMPO'],
  });
  accumulator.push(groupRecords);
  accumulator.push(referenceRecords);
  const result = accumulator.finish();
  assert.ok(result.signals.some((item) => item.kind === 'missingness-shift' && item.fields.includes('CAMPO')));

  // A tiny, practically irrelevant gap over a huge N must not fire, even
  // though a naive p-value-only check would call it "significant".
  const tinyGroup = repeat({ CAMPO: 'x', isGroup: true }, 10_000)
    .map((record, index) => (index < 501 ? { ...record, CAMPO: undefined } : record));
  const tinyReference = repeat({ CAMPO: 'x', isGroup: false }, 10_000)
    .map((record, index) => (index < 500 ? { ...record, CAMPO: undefined } : record));
  const tinyAccumulator = createAuditScanAccumulator((record) => record.isGroup, {
    numericFields: [], categoricalFields: ['CAMPO'],
  });
  tinyAccumulator.push(tinyGroup);
  tinyAccumulator.push(tinyReference);
  const tinyResult = tinyAccumulator.finish();
  assert.equal(tinyResult.signals.filter((item) => item.kind === 'missingness-shift').length, 0);
});
