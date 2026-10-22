export const MAX_MISSION_AUTO_REPLANS = 10;

export interface NormalizedMissionAutonomyPolicy {
  mode: "assisted" | "autonomous";
  allowAutoContinue: boolean;
  allowAutoApply: boolean;
  allowAutoCommit: boolean;
  allowAutoPush: false;
  requireHumanForExternalDelivery: true;
  maxAutoReplans: number;
  automaticReplanCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    ? Math.min(value, MAX_MISSION_AUTO_REPLANS)
    : null;
}

export function normalizeMissionAutonomyPolicy(
  value: unknown,
): NormalizedMissionAutonomyPolicy {
  const policy = isRecord(value) ? value : {};
  const mode = policy.mode === "autonomous" ? "autonomous" : "assisted";
  const hasCanonicalLimit = Object.prototype.hasOwnProperty.call(policy, "maxAutoReplans");
  const rawLimit = hasCanonicalLimit
    ? policy.maxAutoReplans
    : policy.maxAutomaticReplans;
  const parsedLimit = boundedInteger(rawLimit);
  const rawCount = policy.automaticReplanCount;
  const parsedCount = boundedInteger(rawCount);

  return {
    mode,
    allowAutoContinue: mode === "autonomous" && policy.allowAutoContinue === true,
    allowAutoApply: mode === "autonomous" && policy.allowAutoApply === true,
    allowAutoCommit: mode === "autonomous" && policy.allowAutoCommit === true,
    allowAutoPush: false,
    requireHumanForExternalDelivery: true,
    // An absent or malformed bound cannot enable automatic replanning.
    maxAutoReplans: parsedLimit ?? 0,
    // A malformed persisted count is treated as exhausted, not reset.
    automaticReplanCount: parsedCount ?? (
      rawCount === undefined ? 0 : MAX_MISSION_AUTO_REPLANS
    ),
  };
}

export function writeCanonicalMissionAutonomyPolicy(
  value: unknown,
  preservedReplanCount?: number,
): Record<string, unknown> {
  const policy = isRecord(value) ? value : {};
  const normalized = normalizeMissionAutonomyPolicy(policy);
  const {
    maxAutomaticReplans: _legacyMaximum,
    ...rest
  } = policy;

  return {
    ...rest,
    mode: normalized.mode,
    allowAutoContinue: normalized.allowAutoContinue,
    allowAutoApply: normalized.allowAutoApply,
    allowAutoCommit: normalized.allowAutoCommit,
    allowAutoPush: false,
    requireHumanForExternalDelivery: true,
    maxAutoReplans: normalized.maxAutoReplans,
    automaticReplanCount: preservedReplanCount ?? normalized.automaticReplanCount,
  };
}
