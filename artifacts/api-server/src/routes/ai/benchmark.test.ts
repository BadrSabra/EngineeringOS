import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import app from "../../app.js";

const originalOutputDir = process.env.BENCHMARK_OUTPUT_DIR;
const outputDir = path.join(os.tmpdir(), `engineeringos-benchmark-route-${process.pid}`);
const scorecardFile = path.join(outputDir, "code-agent-benchmark-live.json");

async function writeScorecard(value: unknown): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(scorecardFile, `${JSON.stringify(value)}\n`, "utf8");
}

afterEach(async () => {
  if (originalOutputDir === undefined) delete process.env.BENCHMARK_OUTPUT_DIR;
  else process.env.BENCHMARK_OUTPUT_DIR = originalOutputDir;
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe.sequential("GET /api/ai/benchmark/scorecard", () => {
  it("returns bounded scorecard metadata and preserves U separately from F", async () => {
    process.env.BENCHMARK_OUTPUT_DIR = outputDir;
    await writeScorecard({
      suiteVersion: "flight-deck-v2",
      generatedAt: "2026-08-17T18:00:00.000Z",
      provider: "openrouter",
      model: "test-model",
      metrics: {
        observedCases: 2,
        totalCases: 34,
        gradeCounts: { A: 1, F: 0, U: 1 },
        providerUnavailableCount: 1,
        falseSuccessRate: 0,
        scopeEscapeRate: 0,
        correctCompletionRate: 1,
      },
      rolloutAllowed: false,
      rolloutBlockers: ["provider unavailable for 1 observed case"],
      baseline: {
        baselineId: "approved-baseline",
        suiteVersion: "flight-deck-v2",
        generatedAt: "2026-08-16T18:00:00.000Z",
      },
      baselineComparison: {
        status: "regressed",
        baselineId: "approved-baseline",
        metricDeltas: { correctCompletionRate: -0.1 },
        blockers: ["correct completion rate regressed vs baseline"],
      },
      rawResponse: "must not be exposed",
      sourceContent: "must not be exposed",
    });

    const response = await request(app).get("/api/ai/benchmark/scorecard");

    expect(response.status).toBe(200);
    expect(response.body.metrics.gradeCounts).toEqual({ A: 1, F: 0, U: 1 });
    expect(response.body.metrics.providerUnavailableCount).toBe(1);
    expect(response.body.model).toBe("test-model");
    expect(response.body.baseline.baselineId).toBe("approved-baseline");
    expect(response.body.baselineComparison.status).toBe("regressed");
    expect(response.body.baselineComparison.metricDeltas).toEqual({ correctCompletionRate: -0.1 });
    expect(response.body.rolloutBlockers).toEqual(["provider unavailable for 1 observed case"]);
    expect(response.body.rawResponse).toBeUndefined();
    expect(response.body.sourceContent).toBeUndefined();
  });

  it("rejects malformed scorecard metadata", async () => {
    process.env.BENCHMARK_OUTPUT_DIR = outputDir;
    await writeScorecard({ metrics: "not an object", rolloutAllowed: "yes" });

    const response = await request(app).get("/api/ai/benchmark/scorecard");

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "Benchmark scorecard is malformed." });
  });

  it("returns 404 when no live scorecard exists", async () => {
    process.env.BENCHMARK_OUTPUT_DIR = outputDir;

    const response = await request(app).get("/api/ai/benchmark/scorecard");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "No live benchmark scorecard is available." });
  });
});

describe.sequential("GET /api/ai/mission-control", () => {
  it("returns a bounded benchmark and execution ledger envelope", async () => {
    process.env.BENCHMARK_OUTPUT_DIR = outputDir;
    await writeScorecard({
      suiteVersion: "flight-deck-v2",
      generatedAt: "2026-08-19T01:03:24.000Z",
      metrics: {
        observedCases: 34,
        totalCases: 34,
        gradeCounts: { A: 0, B: 20, C: 0, D: 14, F: 0, U: 0 },
      },
      rolloutAllowed: true,
    });

    const response = await request(app).get("/api/ai/mission-control");

    expect(response.status).toBe(200);
    expect(response.body.benchmark.scorecard.metrics.gradeCounts).toEqual({
      A: 0,
      B: 20,
      C: 0,
      D: 14,
      F: 0,
      U: 0,
    });
    expect(Array.isArray(response.body.executions)).toBe(true);
    expect(response.body.executions[0]?.request).toBeUndefined();
    expect(response.body.executions[0]?.resumeToken).toBeUndefined();
  });
});