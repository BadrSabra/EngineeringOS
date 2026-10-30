import { createHash } from "node:crypto";

export type ModelLaneCursorScope = {
  capability: string;
  quality: string;
  requireTools: boolean;
  requireJson: boolean;
  requireStreaming: boolean;
  taskType: string;
  taskContract: string | null;
  preferredQuality: string;
  behaviorallyDemoted: boolean;
  policyVersion: number;
};

export type ModelLaneCursorPersistence = {
  reserveSlot(
    cursorKey: string,
    candidateSetHash: string,
    slotCount: number,
  ): Promise<number>;
};

const postgresPersistence: ModelLaneCursorPersistence = {
  async reserveSlot(cursorKey, candidateSetHash, slotCount) {
    const { pool } = await import("@workspace/db");
    const result = await pool.query<{ next_slot: number }>(
      `INSERT INTO openrouter_lane_cursors
         (cursor_key, candidate_set_hash, next_slot, updated_at)
       VALUES ($1, $2, 0, now())
       ON CONFLICT (cursor_key, candidate_set_hash) DO UPDATE
       SET next_slot = (openrouter_lane_cursors.next_slot + 1) % $3,
           updated_at = now()
       RETURNING next_slot`,
      [cursorKey, candidateSetHash, slotCount],
    );
    const slot = result.rows[0]?.next_slot;
    if (!Number.isSafeInteger(slot) || slot! < 0 || slot! >= slotCount) {
      throw new Error("OpenRouter lane cursor returned an invalid slot");
    }
    return slot!;
  },
};

const fallbackCursors = new Map<string, number>();
const PERSISTENCE_WARNING_INTERVAL_MS = 60_000;
let persistence: ModelLaneCursorPersistence = postgresPersistence;
let lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function localSlot(key: string, slotCount: number): number {
  const slot = (fallbackCursors.get(key) ?? 0) % slotCount;
  fallbackCursors.set(key, (slot + 1) % slotCount);
  return slot;
}

function warnPersistenceUnavailable(): void {
  const now = Date.now();
  if (now - lastPersistenceWarningAt < PERSISTENCE_WARNING_INTERVAL_MS) return;
  lastPersistenceWarningAt = now;
  console.warn(JSON.stringify({
    scope: "openrouter-lane-cursor",
    code: "SHARED_STORE_UNAVAILABLE",
  }));
}

/**
 * Reserve one weighted slot atomically across API processes. On storage
 * failure, continue with a local cursor; fairness is advisory, not availability.
 */
export async function reserveOpenRouterLaneSlot(
  scope: ModelLaneCursorScope,
  candidateIds: readonly string[],
  weights: readonly number[],
  persistenceOverride?: ModelLaneCursorPersistence,
): Promise<number> {
  const slotCount = weights.reduce((sum, weight) => sum + weight, 0);
  if (
    candidateIds.length < 2 ||
    candidateIds.length !== weights.length ||
    !Number.isSafeInteger(slotCount) ||
    slotCount < 1 ||
    candidateIds.some((candidate) => !candidate.trim()) ||
    weights.some((weight) => !Number.isSafeInteger(weight) || weight <= 0)
  ) {
    return 0;
  }

  const cursorKey = hash(scope);
  const candidateSetHash = hash({ candidateIds, weights });
  const fallbackKey = `${cursorKey}:${candidateSetHash}`;
  try {
    const slot = await (persistenceOverride ?? persistence).reserveSlot(
      cursorKey,
      candidateSetHash,
      slotCount,
    );
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= slotCount) {
      throw new Error("OpenRouter lane cursor returned an invalid slot");
    }
    return slot;
  } catch {
    warnPersistenceUnavailable();
    return localSlot(fallbackKey, slotCount);
  }
}

export function _setModelLaneCursorPersistenceForTest(
  next: ModelLaneCursorPersistence | undefined,
): void {
  persistence = next ?? postgresPersistence;
  fallbackCursors.clear();
  lastPersistenceWarningAt = Number.NEGATIVE_INFINITY;
}
