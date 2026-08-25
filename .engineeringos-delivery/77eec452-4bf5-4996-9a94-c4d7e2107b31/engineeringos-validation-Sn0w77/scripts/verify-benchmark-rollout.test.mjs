import { deepStrictEqual, match, rejects } from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifierPath = path.join(projectRoot, "scripts/verify-benchmark-rollout.mjs");
const liveFixturePath = path.join(
  projectRoot,
  "lib/ai-orchestrator/benchmark-results/code-agent-benchmark-live.json",
);
const baselineFixturePath = path.join(
  projectRoot,
  "lib/ai-orchestrator/benchmark-results/code-agent-benchmark-baseline.json",
);

async function runVerifier(live, baseline) {
  const directory = await mkdtemp(path.join(tmpdir(), "benchmark-rollout-"));
  const livePath = path.join(directory, "live.json");
  const baselinePath = path.join(directory, "baseline.json");

  try {
    await Promise.all([
      writeFile(livePath, JSON.stringify(live)),
      writeFile(baselinePath, JSON.stringify(baseline)),
    ]);

    return await execFileAsync(process.execPath, [verifierPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        BENCHMARK_LIVE_SCORECARD_PATH: livePath,
        BENCHMARK_BASELINE_PATH: baselinePath,
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readFixture(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

describe("benchmark rollout verifier", () => {
  it("accepts the approved flight-deck-v2 baseline-shaped live scorecard", async () => {
    const live = await readFixture(liveFixturePath);
    const baseline = await readFixture(baselineFixturePath);

    const result = await runVerifier(live, baseline);

    deepStrictEqual(JSON.parse(result.stdout), {
      ok: true,
      suiteVersion: "flight-deck-v2",
      baselineId: baseline.baselineId,
      observedCases: baseline.metrics.observedCases,
      rolloutAllowed: true,
    });
  });

  it("rejects a stale flight-deck-v1 live scorecard", async () => {
    const live = await readFixture(liveFixturePath);
    const baseline = await readFixture(baselineFixturePath);
    live.kind = "code-agent-benchmark";
    live.suiteVersion = "flight-deck-v1";

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /approved flight-deck-v2 schema/);
      return true;
    });
  });

  it("rejects a live scorecard with provider-blocked cases", async () => {
    const live = await readFixture(liveFixturePath);
    const baseline = await readFixture(baselineFixturePath);
    live.metrics.providerUnavailableCount = 1;

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /provider-unavailable cases/);
      return true;
    });
  });
});