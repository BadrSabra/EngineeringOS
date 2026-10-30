import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reserveOpenRouterLaneSlot, type ModelLaneCursorScope } from "./model-lane-cursor-store.js";

const enabled = process.env.RUN_OPENROUTER_LANE_CURSOR_DB_TEST === "1";
const databaseUrl = process.env.OPENROUTER_LANE_CURSOR_TEST_DATABASE_URL;
const databaseSuite = enabled ? describe : describe.skip;

let priorDatabaseUrl: string | undefined;
let pool: import("pg").Pool | undefined;

databaseSuite("OpenRouter lane cursor PostgreSQL concurrency", () => {
  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error("Explicit disposable database URL is required for this test");
    }
    const parsed = new URL(databaseUrl);
    if (parsed.hostname !== "127.0.0.1") {
      throw new Error("Lane cursor database test only permits a loopback PostgreSQL host");
    }
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    const database = await import("@workspace/db");
    pool = database.pool;
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
  });

  it("allocates every slot once per cycle under concurrent reservations", async () => {
    const scope: ModelLaneCursorScope = {
      capability: "chat",
      quality: "fast",
      requireTools: false,
      requireJson: false,
      requireStreaming: false,
      taskType: `cursor_db_test_${process.pid}_${Date.now()}`,
      taskContract: null,
      preferredQuality: "fast",
      behaviorallyDemoted: false,
      policyVersion: 1,
    };
    const calls = await Promise.all(
      Array.from({ length: 18 }, () =>
        reserveOpenRouterLaneSlot(scope, ["free/model-a", "free/model-b", "free/model-c"], [1, 1, 1]),
      ),
    );

    expect(calls.sort((a, b) => a - b)).toEqual([
      0, 0, 0, 0, 0, 0,
      1, 1, 1, 1, 1, 1,
      2, 2, 2, 2, 2, 2,
    ]);
  });

  it("keeps a separate cursor when the lane scope or eligible candidates change", async () => {
    const scope: ModelLaneCursorScope = {
      capability: "chat",
      quality: "fast",
      requireTools: false,
      requireJson: false,
      requireStreaming: false,
      taskType: `cursor_db_isolation_${process.pid}_${Date.now()}`,
      taskContract: null,
      preferredQuality: "fast",
      behaviorallyDemoted: false,
      policyVersion: 1,
    };

    const first = await reserveOpenRouterLaneSlot(scope, ["free/model-a", "free/model-b"], [1, 1]);
    const second = await reserveOpenRouterLaneSlot(scope, ["free/model-a", "free/model-b"], [1, 1]);
    const changedCandidates = await reserveOpenRouterLaneSlot(
      scope,
      ["free/model-a", "free/model-c"],
      [1, 1],
    );
    const changedScope = await reserveOpenRouterLaneSlot(
      { ...scope, requireTools: true },
      ["free/model-a", "free/model-b"],
      [1, 1],
    );

    expect([first, second, changedCandidates, changedScope]).toEqual([0, 1, 0, 0]);
  });
});
