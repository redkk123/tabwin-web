import assert from 'node:assert/strict';
import test from 'node:test';
import {
  crudeRateInterval,
  directlyStandardizedRate,
  indirectlyStandardizedRatio,
  standardizedRateRatio,
} from '../dist/packages/analysis/src/epidemiology.js';

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''}: ${actual} vs ${expected} (±${tolerance})`);
}

test('a crude rate is events over population, scaled', () => {
  const r = crudeRateInterval(30, 200_000, 100_000);
  assert.equal(r.rate, 15);
  assert.equal(r.events, 30);
  assert.equal(r.per, 100_000);
});

test('Byar\'s interval for a moderate count matches the exact Poisson limits closely', () => {
  // 10 events: exact Poisson 95% CI on the count is 4.795..18.390; Byar is
  // accurate to well under 1% there.
  const r = crudeRateInterval(10, 1000, 1000);
  close(r.lower, 4.795, 0.02, 'lower');
  close(r.upper, 18.390, 0.02, 'upper');
});

test('zero events gives a zero lower bound and the exact one-sided Poisson upper', () => {
  const r = crudeRateInterval(0, 1000, 1000);
  assert.equal(r.rate, 0);
  assert.equal(r.lower, 0);
  // -ln(0.025) = 3.6889 expected events over 1000 person-time, per 1000.
  close(r.upper, 3.6889, 1e-3, 'upper');
});

test('a zero denominator has no rate at all - null, never zero or infinity', () => {
  const r = crudeRateInterval(5, 0, 100_000);
  assert.equal(r.rate, null);
  assert.equal(r.lower, null);
  assert.equal(r.upper, null);
});

test('the interval brackets the point estimate, and the width shrinks as counts grow', () => {
  const small = crudeRateInterval(4, 1000, 1000);
  const large = crudeRateInterval(400, 100_000, 1000);
  // Both estimate a rate of 4 per 1000.
  close(small.rate, 4, 1e-9);
  close(large.rate, 4, 1e-9);
  assert.ok(small.lower < small.rate && small.rate < small.upper);
  // Relative width is far narrower for the larger count.
  const smallWidth = (small.upper - small.lower) / small.rate;
  const largeWidth = (large.upper - large.lower) / large.rate;
  assert.ok(largeWidth < smallWidth / 5, 'a 100x larger count must give a much tighter interval');
});

test('crude rate rejects impossible inputs instead of guessing', () => {
  assert.throws(() => crudeRateInterval(-1, 100, 1000), /non-negative whole number/);
  assert.throws(() => crudeRateInterval(1.5, 100, 1000), /non-negative whole number/);
  assert.throws(() => crudeRateInterval(1, -100, 1000), /non-negative population/);
  assert.throws(() => crudeRateInterval(1, 100, 0), /positive scale/);
});

test('direct standardization reweights the age-specific rates to the standard structure', () => {
  // A young and an old stratum, standard split evenly between them.
  const result = directlyStandardizedRate([
    { label: '0-59', events: 5, population: 1000, standardWeight: 5000 },
    { label: '60+', events: 20, population: 500, standardWeight: 5000 },
  ], 1000);
  // Crude: 25 events / 1500 = 16.67 per 1000.
  close(result.crudeRate, 16.6667, 1e-3, 'crude');
  // Standardized with equal weights: (5/1000 + 20/500)/2 = 0.0225 -> 22.5.
  close(result.standardizedRate, 22.5, 1e-9, 'DSR');
  assert.ok(result.lower < result.standardizedRate && result.standardizedRate < result.upper);
  assert.equal(result.strataUsed, 2);
  assert.equal(result.strataSkipped, 0);
});

test('standardizing to a group\'s own population reproduces its crude rate', () => {
  // When the standard weights equal each stratum\'s own population, the
  // directly standardized rate is by definition the crude rate.
  const strata = [
    { events: 3, population: 700, standardWeight: 700 },
    { events: 9, population: 300, standardWeight: 300 },
  ];
  const result = directlyStandardizedRate(strata, 100_000);
  close(result.standardizedRate, result.crudeRate, 1e-9, 'DSR equals crude when standard = own population');
});

test('a stratum with no population or no standard weight is skipped, not treated as zero', () => {
  const result = directlyStandardizedRate([
    { label: 'ok', events: 10, population: 1000, standardWeight: 1000 },
    { label: 'sem população', events: 0, population: 0, standardWeight: 1000 },
    { label: 'sem padrão', events: 5, population: 500, standardWeight: 0 },
  ], 1000);
  assert.equal(result.strataUsed, 1);
  assert.equal(result.strataSkipped, 2);
  // Only the first stratum contributes: 10/1000 -> 10 per 1000.
  close(result.standardizedRate, 10, 1e-9);
});

test('no usable stratum yields a null standardized rate, and the crude rate still reports where it can', () => {
  const result = directlyStandardizedRate([
    { events: 5, population: 100, standardWeight: 0 },
  ], 1000);
  assert.equal(result.standardizedRate, null);
  assert.equal(result.lower, null);
  // The crude rate does not need the standard weights, so it is still reported.
  close(result.crudeRate, 50, 1e-9);
});

test('standardization rejects invalid strata', () => {
  assert.throws(() => directlyStandardizedRate([{ events: -1, population: 100, standardWeight: 1 }]), /invalid events/);
  assert.throws(() => directlyStandardizedRate([{ events: 1, population: -1, standardWeight: 1 }]), /invalid population/);
  assert.throws(() => directlyStandardizedRate([{ events: 1, population: 1, standardWeight: -1 }]), /invalid standard weight/);
});

// --- indirect standardization (SMR) and standardized rate ratio (SRR) -----

test('an SMR compares observed against what the reference rates predict for this age structure', () => {
  // Reference rates 0.005 and 0.04 over own populations 1000 and 500:
  // expected = 5 + 20 = 25. Observed 30 -> SMR 1.2.
  const result = indirectlyStandardizedRatio([
    { label: '0-59', events: 6, population: 1000, referenceRate: 0.005 },
    { label: '60+', events: 24, population: 500, referenceRate: 0.04 },
  ]);
  assert.equal(result.observed, 30);
  assert.equal(result.expected, 25);
  close(result.smr, 1.2, 1e-9, 'SMR');
  assert.equal(result.strataUsed, 2);
  // 30 observed against 25 expected is not a significant excess: the CI holds 1.
  assert.ok(result.lower < 1 && result.upper > 1, 'CI must contain 1 here');
});

test('an SMR of exactly 1 comes out when observed equals expected', () => {
  const result = indirectlyStandardizedRatio([
    { events: 5, population: 1000, referenceRate: 0.005 },
  ]);
  close(result.smr, 1, 1e-9);
});

test('a clear excess pushes the SMR interval entirely above 1', () => {
  // 100 observed against 25 expected.
  const result = indirectlyStandardizedRatio([
    { events: 100, population: 1000, referenceRate: 0.025 },
  ]);
  close(result.smr, 4, 1e-9);
  assert.ok(result.lower > 1, 'a fourfold excess must exclude 1');
});

test('a stratum with no population or no reference rate is skipped, and its events still count as observed', () => {
  const result = indirectlyStandardizedRatio([
    { label: 'ok', events: 10, population: 1000, referenceRate: 0.01 },
    { label: 'sem população', events: 2, population: 0, referenceRate: 0.01 },
    { label: 'sem taxa', events: 3, population: 500, referenceRate: 0 },
  ]);
  assert.equal(result.strataUsed, 1);
  assert.equal(result.strataSkipped, 2);
  // Expected comes only from the usable stratum...
  close(result.expected, 10, 1e-9);
  // ...but the observed total is honest about every event seen.
  assert.equal(result.observed, 15);
});

test('nothing expected means no SMR at all - null, never a division by zero', () => {
  const result = indirectlyStandardizedRatio([{ events: 5, population: 0, referenceRate: 0.01 }]);
  assert.equal(result.smr, null);
  assert.equal(result.lower, null);
  assert.equal(result.observed, 5);
});

test('indirect standardization rejects invalid strata', () => {
  assert.throws(() => indirectlyStandardizedRatio([{ events: -1, population: 1, referenceRate: 0.1 }]), /invalid events/);
  assert.throws(() => indirectlyStandardizedRatio([{ events: 1, population: -1, referenceRate: 0.1 }]), /invalid population/);
  assert.throws(() => indirectlyStandardizedRatio([{ events: 1, population: 1, referenceRate: -0.1 }]), /invalid reference rate/);
});

test('a standardized rate ratio divides two DSRs, with a log-scale interval', () => {
  const a = directlyStandardizedRate([
    { events: 5, population: 1000, standardWeight: 5000 },
    { events: 20, population: 500, standardWeight: 5000 },
  ], 1000);
  const b = directlyStandardizedRate([
    { events: 3, population: 1000, standardWeight: 5000 },
    { events: 10, population: 500, standardWeight: 5000 },
  ], 1000);
  const srr = standardizedRateRatio(a, b);
  close(srr.ratio, a.standardizedRate / b.standardizedRate, 1e-9, 'ratio');
  // The interval is built on the log scale, so it is asymmetric around the
  // ratio and multiplicatively symmetric - and can never reach below zero.
  assert.ok(srr.lower > 0);
  close(srr.ratio / srr.lower, srr.upper / srr.ratio, 1e-9, 'log-symmetric');
});

test('a rate ratio against itself is exactly 1', () => {
  const a = directlyStandardizedRate([
    { events: 7, population: 900, standardWeight: 1000 },
    { events: 2, population: 400, standardWeight: 1000 },
  ], 100_000);
  close(standardizedRateRatio(a, a).ratio, 1, 1e-12);
});

test('a rate ratio has no value when either side has none', () => {
  const usable = directlyStandardizedRate([{ events: 5, population: 100, standardWeight: 10 }], 1000);
  const unusable = directlyStandardizedRate([{ events: 5, population: 100, standardWeight: 0 }], 1000);
  assert.equal(standardizedRateRatio(usable, unusable).ratio, null);
  assert.equal(standardizedRateRatio(unusable, usable).ratio, null);
});
