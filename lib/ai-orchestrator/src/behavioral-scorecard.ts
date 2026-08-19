/**
 * Rolling behavioral reliability scorecards for model routing.
 *
 * This is intentionally process-local runtime health, like the provider circuit
 * breaker. It is not a durable analytics store and must never be used as a
 * security or correctness boundary.
 */

export type BehavioralFailureKind = "loop" | "soft_limit" | "malformed_json";

export type BehavioralScorecard = {
  model: string;
  windowMs: number;
  sampleCount: number;
  loopCount: number;
  /** Explicit alias for loopCount: one sample with a DUPLICATE_TOOL_CALL. */
  duplicateToolCallCount: number;
  softLimitCount: number;
  malformedJsonCount: number;
  loopRate: number | null;
  /** Explicit rate of samples marked by DUPLICATE_TOOL_CALL. */
  duplicateToolCallRate: number | null;
  softLimitRate: number | null;
  malformedJsonRate: number | null;
  demoted: boolean;
  lastEventAt: string | null;
};

export const BEHAVIORAL_SCORECARD_CONFIG = {
  windowMs: 15 * 60 * 1_000,
  minSamples: 5,
  loopRateThreshold: 0.4,
} as const;

type Sample = {
  at: number;
  failures: Set<BehavioralFailureKind>;
};

const samplesByModel = new Map<string, Sample[]>();

function prune(model: string, now: number): Sample[] {
  const cutoff = now - BEHAVIORAL_SCORECARD_CONFIG.windowMs;
  const retained = (samplesByModel.get(model) ?? []).filter((sample) => sample.at >= cutoff);
  if (retained.length === 0) samplesByModel.delete(model);
  else samplesByModel.set(model, retained);
  return retained;
}

function getOrCreateSampleForFailure(model: string, now: number): Sample {
  const samples = prune(model, now);
  const matching = [...samples].reverse().find((sample) => sample.at <= now);
  if (matching) return matching;
  const latest = samples.at(-1);
  if (latest) return latest;
  const sample: Sample = { at: now, failures: new Set() };
  samplesByModel.set(model, [sample]);
  return sample;
}

/** Record one completed provider model call. */
export function recordBehavioralModelCall(model: string, at = Date.now()): void {
  const normalized = model.trim();
  if (!normalized) return;
  const samples = prune(normalized, at);
  samples.push({ at, failures: new Set() });
  samplesByModel.set(normalized, samples);
}

/**
 * Attach an observed behavioral failure to the latest completed call for a
 * model. A Set makes repeated duplicate-tool log lines in one turn count as
 * one bad sample rather than artificially inflating the rate.
 */
export function recordBehavioralFailure(
  model: string,
  kind: BehavioralFailureKind,
  at = Date.now(),
): void {
  const normalized = model.trim();
  if (!normalized) return;
  getOrCreateSampleForFailure(normalized, at).failures.add(kind);
}

export function getBehavioralScorecards(now = Date.now()): BehavioralScorecard[] {
  const scorecards: BehavioralScorecard[] = [];
  for (const model of [...samplesByModel.keys()]) {
    const samples = prune(model, now);
    if (samples.length === 0) continue;
    const count = (kind: BehavioralFailureKind) =>
      samples.filter((sample) => sample.failures.has(kind)).length;
    const loopCount = count("loop");
    const softLimitCount = count("soft_limit");
    const malformedJsonCount = count("malformed_json");
    const loopRate = loopCount / samples.length;

    scorecards.push({
      model,
      windowMs: BEHAVIORAL_SCORECARD_CONFIG.windowMs,
      sampleCount: samples.length,
      loopCount,
      duplicateToolCallCount: loopCount,
      softLimitCount,
      malformedJsonCount,
      loopRate,
      duplicateToolCallRate: loopRate,
      softLimitRate: softLimitCount / samples.length,
      malformedJsonRate: malformedJsonCount / samples.length,
      demoted:
        samples.length >= BEHAVIORAL_SCORECARD_CONFIG.minSamples &&
        loopRate > BEHAVIORAL_SCORECARD_CONFIG.loopRateThreshold,
      lastEventAt: new Date(samples.at(-1)!.at).toISOString(),
    });
  }
  return scorecards.sort((a, b) => b.sampleCount - a.sampleCount || a.model.localeCompare(b.model));
}

export function getBehavioralScorecard(model: string, now = Date.now()): BehavioralScorecard | undefined {
  return getBehavioralScorecards(now).find((scorecard) => scorecard.model === model.trim());
}

export function isModelBehaviorallyDemoted(model: string, now = Date.now()): boolean {
  return getBehavioralScorecard(model, now)?.demoted ?? false;
}

/** Reset runtime state for isolated tests. */
export function _resetBehavioralScorecardForTest(): void {
  samplesByModel.clear();
}