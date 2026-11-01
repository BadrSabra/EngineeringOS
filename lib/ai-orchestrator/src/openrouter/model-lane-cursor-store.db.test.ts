import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { reserveOpenRouterLaneSlot, type ModelLaneCursorScope } from "./model-lane-cursor-store.js";
import { acquireModelAttemptLease } from "./model-cooldown-store.js";

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

  it("serializes the same model attempt across independent processes", async () => {
    const model = `lease_db_test_${process.pid}_${Date.now()}`;
    const firstLease = await acquireModelAttemptLease("openrouter", model);
    expect(firstLease).toBeDefined();

    const cooldownStoreUrl = new URL("./model-cooldown-store.ts", import.meta.url).href;
    const childScript = `
      import { acquireModelAttemptLease } from ${JSON.stringify(cooldownStoreUrl)};
      console.log("ATTEMPTING");
      const lease = await acquireModelAttemptLease("openrouter", ${JSON.stringify(model)});
      console.log(lease ? "LEASE_ACQUIRED" : "LEASE_DENIED");
      await lease?.release();
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", childScript],
      { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    const childExit = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
      child.once("error", () => resolve(null));
    });
    const waitForOutput = async (expected: string) => {
      const deadline = Date.now() + 8_000;
      while (!output.includes(expected) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(output).toContain(expected);
    };

    let firstReleased = false;
    try {
      await waitForOutput("ATTEMPTING");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(output).not.toContain("LEASE_ACQUIRED");

      await firstLease!.release();
      firstReleased = true;

      await waitForOutput("LEASE_ACQUIRED");
      expect(await childExit).toBe(0);
    } finally {
      if (!firstReleased) await firstLease!.release();
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 15_000);
});
