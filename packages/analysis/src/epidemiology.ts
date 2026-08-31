/**
 * Epidemiological rates with honest confidence intervals, and direct age
 * standardization.
 *
 * Two deliberate boundaries:
 *
 * 1. No standard population is hardcoded here. The WHO World Standard and the
 *    IBGE census distributions are public, but reproducing their exact
 *    per-age weights from memory would risk fabricating reference numbers,
 *    which this project forbids. The standard weights are an input: the
 *    caller supplies them (in practice, by joining the official table). The
 *    math is what lives here, and the math is verifiable.
 *
 * 2. A zero denominator has no rate. It returns `null`, never a rate of zero
 *    or infinity - the same rule the rest of the project follows.
 */

const Z_95 = 1.959963984540054;

export interface RateWithInterval {
  /** Point estimate, per `per` person-time. `null` when the denominator is zero. */
  rate: number | null;
  lower: number | null;
  upper: number | null;
  events: number;
  population: number;
  per: number;
}

/**
 * A crude rate and its 95% confidence interval by Byar's approximation to the
 * exact Poisson interval - accurate to well under 1% for events >= 1, and the
 * method DATASUS-adjacent tools and the WHO use for count-based rates.
 *
 * For zero events the lower bound is 0 and the upper bound is the exact
 * one-sided Poisson bound (-ln(0.025) = 3.6889 expected events), since Byar's
 * form is undefined at zero.
 */
export function crudeRateInterval(events: number, population: number, per = 100_000): RateWithInterval {
  if (!Number.isFinite(events) || events < 0 || !Number.isInteger(events)) {
    throw new Error('crude rate requires a non-negative whole number of events');
  }
  if (!Number.isFinite(population) || population < 0) {
    throw new Error('crude rate requires a non-negative population');
  }
  if (!Number.isFinite(per) || per <= 0) throw new Error('crude rate requires a positive scale');

  if (population === 0) {
    return { rate: null, lower: null, upper: null, events, population, per };
  }
  const scale = per / population;
  if (events === 0) {
    return { rate: 0, lower: 0, upper: 3.6888794541139363 * scale, events, population, per };
  }
  // Byar's approximation of the exact Poisson limits for the event count.
  const lowerEvents = events * (1 - 1 / (9 * events) - Z_95 / (3 * Math.sqrt(events))) ** 3;
  const upperEvents = (events + 1) * (1 - 1 / (9 * (events + 1)) + Z_95 / (3 * Math.sqrt(events + 1))) ** 3;
  return {
    rate: events * scale,
    lower: Math.max(0, lowerEvents) * scale,
    upper: upperEvents * scale,
    events,
    population,
    per,
  };
}

export interface StandardizationStratum {
  /** For diagnostics only. */
  label?: string;
  events: number;
  population: number;
  /** The standard population's size for this stratum (any consistent unit; only the relative weights matter). */
  standardWeight: number;
}

export interface DirectStandardizationResult {
  /** Directly age-standardized rate per `per`, with its 95% CI. `null` when no stratum has population. */
  standardizedRate: number | null;
  lower: number | null;
  upper: number | null;
  /** Standard error of the standardized rate, on the same `per` scale - exposed so a rate ratio can compose from two of these. */
  standardError: number | null;
  /** The crude rate over the same strata, for comparison. */
  crudeRate: number | null;
  per: number;
  /** Strata that contributed (population > 0 and standardWeight > 0). */
  strataUsed: number;
  /** Strata dropped because they had no population or no standard weight - reported, never silently ignored. */
  strataSkipped: number;
}

/**
 * Directly age-standardized rate: what the group's rate would be if its age
 * structure matched the standard population's.
 *
 *   DSR = sum(w_i * r_i) / sum(w_i),  r_i = events_i / population_i
 *
 * with the variance
 *
 *   Var(DSR) = sum(w_i^2 * events_i / population_i^2) / (sum w_i)^2
 *
 * and a normal-approximation 95% CI. The normal approximation is standard and
 * adequate when the total event count is not tiny; for very small counts a
 * gamma/Dobson interval would be tighter, and that is noted rather than
 * silently assumed.
 *
 * A stratum with zero population or zero standard weight cannot contribute a
 * rate and is skipped - counted in `strataSkipped`, never treated as a zero.
 */
export function directlyStandardizedRate(
  strata: readonly StandardizationStratum[],
  per = 100_000,
): DirectStandardizationResult {
  if (!Number.isFinite(per) || per <= 0) throw new Error('standardization requires a positive scale');

  let weightSum = 0;
  let weightedRateSum = 0;
  let varianceNumerator = 0;
  let totalEvents = 0;
  let totalPopulation = 0;
  let used = 0;
  let skipped = 0;

  for (const stratum of strata) {
    const { events, population, standardWeight } = stratum;
    if (!Number.isFinite(events) || events < 0) throw new Error(`stratum ${stratum.label ?? ''} has invalid events`);
    if (!Number.isFinite(population) || population < 0) throw new Error(`stratum ${stratum.label ?? ''} has invalid population`);
    if (!Number.isFinite(standardWeight) || standardWeight < 0) throw new Error(`stratum ${stratum.label ?? ''} has invalid standard weight`);

    totalEvents += events;
    totalPopulation += population;
    if (population <= 0 || standardWeight <= 0) { skipped++; continue; }

    used++;
    const rate = events / population;
    weightSum += standardWeight;
    weightedRateSum += standardWeight * rate;
    varianceNumerator += standardWeight ** 2 * events / population ** 2;
  }

  const crudeRate = totalPopulation > 0 ? (totalEvents / totalPopulation) * per : null;
  if (weightSum <= 0) {
    return {
      standardizedRate: null, lower: null, upper: null, standardError: null,
      crudeRate, per, strataUsed: used, strataSkipped: skipped,
    };
  }
  const dsr = weightedRateSum / weightSum;
  const standardError = Math.sqrt(varianceNumerator) / weightSum;
  return {
    standardizedRate: dsr * per,
    lower: Math.max(0, dsr - Z_95 * standardError) * per,
    upper: (dsr + Z_95 * standardError) * per,
    standardError: standardError * per,
    crudeRate,
    per,
    strataUsed: used,
    strataSkipped: skipped,
  };
}

export interface IndirectStandardizationStratum {
  label?: string;
  /** Observed events in this stratum of the group under study. */
  events: number;
  /** The group's own population for this stratum. */
  population: number;
  /** The reference population's rate for this stratum, as events per person (not per 100k). */
  referenceRate: number;
}

export interface IndirectStandardizationResult {
  /** Standardized Mortality/Morbidity Ratio: observed / expected. `null` when nothing was expected. */
  smr: number | null;
  lower: number | null;
  upper: number | null;
  observed: number;
  /** Events the reference rates predict for this group's own age structure. */
  expected: number;
  strataUsed: number;
  strataSkipped: number;
}

/**
 * Indirect standardization (SMR): applies a **reference population's**
 * age-specific rates to the group's own age structure, and compares what was
 * observed against what those rates predict.
 *
 *   expected = sum(referenceRate_i * population_i),  SMR = observed / expected
 *
 * This is the method to reach for when the group's own age-specific rates are
 * too sparse to standardize directly - the usual case for a small municipality
 * or a rare outcome. The CI comes from Byar's interval on the observed count
 * divided by the (treated as fixed) expected count, which is the standard
 * approach.
 *
 * An SMR is a ratio, not a rate: 1 means "as expected". It is deliberately
 * not scaled by `per`, and never multiplied by 100 here - a caller that wants
 * percent points says so itself.
 */
export function indirectlyStandardizedRatio(
  strata: readonly IndirectStandardizationStratum[],
): IndirectStandardizationResult {
  let observed = 0;
  let expected = 0;
  let used = 0;
  let skipped = 0;

  for (const stratum of strata) {
    const { events, population, referenceRate } = stratum;
    if (!Number.isFinite(events) || events < 0) throw new Error(`stratum ${stratum.label ?? ''} has invalid events`);
    if (!Number.isFinite(population) || population < 0) throw new Error(`stratum ${stratum.label ?? ''} has invalid population`);
    if (!Number.isFinite(referenceRate) || referenceRate < 0) throw new Error(`stratum ${stratum.label ?? ''} has invalid reference rate`);

    observed += events;
    if (population <= 0 || referenceRate <= 0) { skipped++; continue; }
    used++;
    expected += referenceRate * population;
  }

  if (expected <= 0) {
    return { smr: null, lower: null, upper: null, observed, expected, strataUsed: used, strataSkipped: skipped };
  }
  // Byar's interval on the observed count, scaled by the expected count.
  const countInterval = crudeRateInterval(Math.round(observed), 1, 1);
  return {
    smr: observed / expected,
    lower: (countInterval.lower ?? 0) / expected,
    upper: (countInterval.upper ?? 0) / expected,
    observed,
    expected,
    strataUsed: used,
    strataSkipped: skipped,
  };
}

export interface RateRatioResult {
  /** Ratio of the two directly standardized rates. `null` when either is unavailable or the denominator is zero. */
  ratio: number | null;
  lower: number | null;
  upper: number | null;
}

/**
 * Standardized rate ratio: two directly standardized rates compared, with a
 * CI from the log-ratio's approximate variance
 *
 *   Var(log SRR) ~= (SE1/DSR1)^2 + (SE2/DSR2)^2
 *
 * The interval is built on the log scale and exponentiated, so it is
 * asymmetric around the ratio and can never reach below zero - which is what
 * a ratio requires and a naive symmetric interval would get wrong.
 *
 * Both rates must already be standardized to the **same** standard
 * population; comparing rates standardized to different ones is meaningless,
 * and this function cannot detect it - the caller is responsible.
 *
 * A numerator rate of exactly zero is a real result, not a missing one: the
 * ratio is 0 and is reported as such. Only its interval is withheld, because
 * the log scale has no value at zero - reporting `ratio: null` there would
 * hide the very finding ("this group had no events") that the comparison was
 * run to surface.
 */
export function standardizedRateRatio(
  numerator: DirectStandardizationResult,
  denominator: DirectStandardizationResult,
): RateRatioResult {
  const a = numerator.standardizedRate;
  const b = denominator.standardizedRate;
  // Without a denominator rate there is no ratio at all; dividing by zero
  // would invent one.
  if (a === null || b === null || b === 0) return { ratio: null, lower: null, upper: null };
  const ratio = a / b;
  if (a === 0) return { ratio, lower: null, upper: null };
  const seA = numerator.standardError ?? 0;
  const seB = denominator.standardError ?? 0;
  const logVariance = (seA / a) ** 2 + (seB / b) ** 2;
  const halfWidth = Z_95 * Math.sqrt(logVariance);
  return {
    ratio,
    lower: ratio * Math.exp(-halfWidth),
    upper: ratio * Math.exp(halfWidth),
  };
}
