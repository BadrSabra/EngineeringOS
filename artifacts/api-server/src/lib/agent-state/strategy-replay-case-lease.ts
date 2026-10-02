import type { JsonValue } from "@workspace/ai-orchestrator";
import { z } from "zod/v4";

export const STRATEGY_REPLAY_CASE_LEASE_MS = 120_000;
export const STRATEGY_REPLAY_CASE_LEASE_RENEW_INTERVAL_MS = 30_000;
export const STRATEGY_REPLAY_CASE_LEASE_RECLAIM_GRACE_MS = 15_000;
export const STRATEGY_REPLAY_CASE_LEGACY_STALE_MS = 15 * 60_000;

export const STRATEGY_REPLAY_CASE_LEASE_KIND = "strategy_replay_case_run_lease";

const StrategyReplayCaseRunLeaseSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(STRATEGY_REPLAY_CASE_LEASE_KIND),
  ownerToken: z.string().uuid(),
  expiresAt: z.string().min(1).max(40),
}).strict();

export type StrategyReplayCaseRunLease = z.infer<typeof StrategyReplayCaseRunLeaseSchema>;

export type StrategyReplayCaseLeaseClaimDecision =
  | "reclaim"
  | "busy"
  | "invalid"
  | "terminal";

export function createStrategyReplayCaseRunLease(input: {
  ownerToken: string;
  expiresAt: Date;
}): StrategyReplayCaseRunLease & JsonValue {
  if (!Number.isFinite(input.expiresAt.getTime())) {
    throw new Error("Strategy Replay lease expiry is invalid.");
  }
  return {
    schemaVersion: 1,
    kind: STRATEGY_REPLAY_CASE_LEASE_KIND,
    ownerToken: z.string().uuid().parse(input.ownerToken),
    expiresAt: input.expiresAt.toISOString(),
  };
}

export function parseStrategyReplayCaseRunLease(value: unknown): StrategyReplayCaseRunLease | undefined {
  const parsed = StrategyReplayCaseRunLeaseSchema.safeParse(value);
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.expiresAt))) return undefined;
  return parsed.data;
}

export function decideStrategyReplayCaseLeaseClaim(input: {
  status: string;
  receipt: unknown;
  updatedAt: Date;
  now: Date;
}): StrategyReplayCaseLeaseClaimDecision {
  if (input.status !== "running") return "terminal";

  const lease = parseStrategyReplayCaseRunLease(input.receipt);
  if (lease) {
    return Date.parse(lease.expiresAt) + STRATEGY_REPLAY_CASE_LEASE_RECLAIM_GRACE_MS
      <= input.now.getTime()
      ? "reclaim"
      : "busy";
  }

  // A non-null unknown receipt may be forensic data. Never overwrite it as a
  // legacy lease marker just because its timestamp is old.
  if (input.receipt !== null) return "invalid";

  const updatedAt = input.updatedAt instanceof Date
    ? input.updatedAt.getTime()
    : Number.NaN;
  if (!Number.isFinite(updatedAt) || !Number.isFinite(input.now.getTime())) return "invalid";

  return updatedAt + STRATEGY_REPLAY_CASE_LEGACY_STALE_MS <= input.now.getTime()
    ? "reclaim"
    : "busy";
}