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

async function readCurrentSourceRevision() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}

function buildLiveScorecard(baseline, sourceRevision) {
  const cases = Object.entries(baseline.metrics.gradeCounts).flatMap(
    ([grade, count]) => Array.from({ length: count }, (_, index) => ({
      caseId: `${grade.toLowerCase()}-${index + 1}`,
      grade,
      sourceRevision,
      ...(grade === "D" ? { diagnosis: "Safely blocked by the fixture contract." } : {}),
    })),
  );
  return {
    kind: "code-agent-benchmark",
    version: 1,
    suiteVersion: baseline.suiteVersion,
    generatedAt: new Date().toISOString(),
    sourceRevision,
    cases,
    metrics: { ...baseline.metrics },
    rolloutAllowed: true,
    rolloutBlockers: [],
    baselineComparison: {
      status: "passed",
      baselineId: baseline.baselineId,
      blockers: [],
    },
  };
}

describe("benchmark rollout verifier", () => {
  it("accepts a complete live scorecard bound to the approved baseline and current source", async () => {
    const baseline = await readFixture(baselineFixturePath);
    const sourceRevision = await readCurrentSourceRevision();
    const live = buildLiveScorecard(baseline, sourceRevision);

    const result = await runVerifier(live, baseline);

    deepStrictEqual(JSON.parse(result.stdout), {
      ok: true,
      suiteVersion: "flight-deck-v2",
      baselineId: baseline.baselineId,
      sourceRevision,
      observedCases: baseline.metrics.observedCases,
      rolloutAllowed: true,
    });
  });

  it("rejects a historical baseline-shaped scorecard as live evidence", async () => {
    const live = await readFixture(liveFixturePath);
    const baseline = await readFixture(baselineFixturePath);

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /unsupported kind/);
      return true;
    });
  });

  it("rejects a stale flight-deck-v1 live scorecard", async () => {
    const baseline = await readFixture(baselineFixturePath);
    const sourceRevision = await readCurrentSourceRevision();
    const live = buildLiveScorecard(baseline, sourceRevision);
    live.suiteVersion = "flight-deck-v1";

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /approved flight-deck-v2 schema/);
      return true;
    });
  });

  it("rejects a live scorecard compared against a different baseline", async () => {
    const baseline = await readFixture(baselineFixturePath);
    const live = buildLiveScorecard(baseline, await readCurrentSourceRevision());
    live.baselineComparison.baselineId = "unapproved-baseline";

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /not approved baseline/);
      return true;
    });
  });

  it("rejects a live scorecard from another source revision", async () => {
    const baseline = await readFixture(baselineFixturePath);
    const live = buildLiveScorecard(baseline, await readCurrentSourceRevision());
    live.sourceRevision = "f".repeat(40);

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /does not match current source/);
      return true;
    });
  });

  it("rejects case observations that are not bound to the current source revision", async () => {
    const baseline = await readFixture(baselineFixturePath);
    const live = buildLiveScorecard(baseline, await readCurrentSourceRevision());
    live.cases[0].sourceRevision = "f".repeat(40);

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /not bound to the current source revision/);
      return true;
    });
  });

  it("rejects a live scorecard with provider-blocked cases", async () => {
    const baseline = await readFixture(baselineFixturePath);
    const live = buildLiveScorecard(baseline, await readCurrentSourceRevision());
    live.metrics.providerUnavailableCount = 1;

    await rejects(runVerifier(live, baseline), (error) => {
      match(error.stderr, /provider-unavailable cases/);
      return true;
    });
  });
});