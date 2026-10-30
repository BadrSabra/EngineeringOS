import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _setModelLaneCursorPersistenceForTest,
  reserveOpenRouterLaneSlot,
  type ModelLaneCursorPersistence,
  type ModelLaneCursorScope,
} from "./model-lane-cursor-store.js";

const scope: ModelLaneCursorScope = {
  capability: "chat",
  quality: "fast",
  requireTools: false,
  requireJson: false,
  requireStreaming: false,
  taskType: "project_query",
  taskContract: null,
  preferredQuality: "fast",
  behaviorallyDemoted: false,
  policyVersion: 1,
};

afterEach(() => {
  _setModelLaneCursorPersistenceForTest(undefined);
  vi.restoreAllMocks();
});

describe("shared OpenRouter model-lane cursor", () => {
  it("reserves distinct slots atomically through the shared persistence adapter", async () => {
    let next = 0;
    const reservations: Array<{ cursorKey: string; candidateHash: string; slotCount: number }> = [];
    const adapter: ModelLaneCursorPersistence = {
      async reserveSlot(cursorKey, candidateSetHash, slotCount) {
        reservations.push({ cursorKey, candidateHash: candidateSetHash, slotCount });
        const slot = next % slotCount;
        next = (slot + 1) % slotCount;
        return slot;
      },
    };

    const slots = await Promise.all(Array.from({ length: 8 }, () =>
      reserveOpenRouterLaneSlot(scope, ["free/a", "free/b"], [1, 1], adapter),
    ));

    expect(slots).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(new Set(reservations.map((entry) => entry.cursorKey)).size).toBe(1);
    expect(new Set(reservations.map((entry) => entry.candidateHash)).size).toBe(1);
    expect(reservations.every((entry) => entry.slotCount === 2)).toBe(true);
  });

  it("isolates candidate sets and lane scopes without storing raw scope values", async () => {
    const calls: Array<{ cursorKey: string; candidateHash: string }> = [];
    const adapter: ModelLaneCursorPersistence = {
      async reserveSlot(cursorKey, candidateSetHash) {
        calls.push({ cursorKey, candidateHash: candidateSetHash });
        return 0;
      },
    };

    await reserveOpenRouterLaneSlot(scope, ["free/a", "free/b"], [2, 1], adapter);
    await reserveOpenRouterLaneSlot(scope, ["free/a", "free/c"], [2, 1], adapter);
    await reserveOpenRouterLaneSlot({ ...scope, requireTools: true }, ["free/a", "free/b"], [2, 1], adapter);

    expect(new Set(calls.map((entry) => entry.cursorKey)).size).toBe(2);
    expect(new Set(calls.map((entry) => entry.candidateHash)).size).toBe(2);
    expect(JSON.stringify(calls)).not.toContain("project_query");
    expect(JSON.stringify(calls)).not.toContain("free/a");
  });

  it("falls back to a local rotation when shared persistence is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const adapter: ModelLaneCursorPersistence = {
      async reserveSlot() {
        throw new Error("database unavailable");
      },
    };

    const slots = await Promise.all(Array.from({ length: 4 }, () =>
      reserveOpenRouterLaneSlot(scope, ["free/a", "free/b"], [1, 1], adapter),
    ));

    expect(slots).toEqual([0, 1, 0, 1]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("database unavailable");
  });

  it("does not allocate a cursor for one candidate or invalid weights", async () => {
    const reserveSlot = vi.fn(async () => 0);
    const adapter: ModelLaneCursorPersistence = { reserveSlot };

    await expect(reserveOpenRouterLaneSlot(scope, ["free/a"], [1], adapter)).resolves.toBe(0);
    await expect(reserveOpenRouterLaneSlot(scope, ["free/a", "free/b"], [1, 0], adapter)).resolves.toBe(0);

    expect(reserveSlot).not.toHaveBeenCalled();
  });
});
