import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import app from "../../app.js";

const originalOutputDir = process.env.BENCHMARK_OUTPUT_DIR;
const originalEmpiricalPath = process.env.EMPIRICAL_QUALITY_SCORECARD_PATH;
const originalReleasePath = process.env.AI_RELEASE_QUALITY_REPORT_PATH;
const outputDir = path.join(os.tmpdir(), `engineeringos-benchmark-route-${process.pid}`);
const scorecardFile = path.join(outputDir, "code-agent-benchmark-live.json");
const envelopeFile = path.join(outputDir, "free-tier-quality-envelope.json");
const empiricalFile = path.join(outputDir, "empirical-quality-scorecard.json");
const releaseFile = path.join(outputDir, "ai-release-quality-decision.json");

async function writeScorecard(value: unknown): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(scorecardFile, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeEnvelope(value: unknown): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(envelopeFile, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

afterEach(async () => {
  if (originalOutputDir === undefined) delete process.env.BENCHMARK_OUTPUT_DIR;
  else process.env.BENCHMARK_OUTPUT_DIR = originalOutputDir;
  if (originalEmpiricalPath === undefined) delete process.env.EMPIRICAL_QUALITY_SCORECARD_PATH;
  else process.env.EMPIRICAL_QUALITY_SCORECARD_PATH = originalEmpiricalPath;
  if (originalReleasePath === undefined) delete process.env.AI_RELEASE_QUALITY_REPORT_PATH;
  else process.env.AI_RELEASE_QUALITY_REPORT_PATH = originalReleasePath;
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

  it("returns only bounded empirical quality measurements", async () => {
    process.env.EMPIRICAL_QUALITY_SCORECARD_PATH = empiricalFile;
    await writeFile(empiricalFile, {
      kind: "empirical-ai-quality-scorecard",
      version: 1,
      generatedAt: "2026-08-19T01:03:24.000Z",
      corpusRevision: "public-disposable-v1",
      provider: "provider secret response",
      model: "model secret response",
      measurementOnly: true,
      status: "COMPLETE",
      empiricalQualityStatus: "MEASURED",
      blockers: ["raw blocker with source body"],
      metrics: {
        totalCases: 2,
        completedCases: 2,
        incompleteCases: 0,
        providerUnavailableCount: 0,
        timeoutCount: 0,
        errorCount: 0,
        truePositiveCount: 1,
        falsePositiveCount: 1,
        falseNegativeCount: 0,
        precision: 0.5,
        recall: 1,
        f1: 0.67,
        citationCoverage: 1,
        falseAcceptanceRate: 0,
        latencyMs: { p50: 100, p95: 200, p99: 200 },
        normalizationCounters: { changedSeverity: 1, droppedCitation: 0, changedFindingType: 0 },
      },
      cases: [{
        caseId: "defect-001",
        outcome: "COMPLETE",
        truePositives: 1,
        falsePositives: 1,
        falseNegatives: 0,
        citationCoveredFindings: 1,
        unsupportedCitations: 0,
        contractPassed: true,
        semanticVerdictConsistent: true,
        qualityGateAccepted: true,
        falseAcceptance: false,
        falseRejection: false,
        normalization: { changedFindingType: 0, changedSeverity: 1, droppedCitation: 0 },
        rawResponse: "must not be exposed",
        sourceBody: "must not be exposed",
      }],
    });

    const response = await request(app).get("/api/ai/benchmark/empirical-scorecard");

    expect(response.status).toBe(200);
    expect(response.body.empiricalQualityStatus).toBe("MEASURED");
    expect(response.body.metrics.truePositiveCount).toBe(1);
    expect(response.body.cases[0].caseId).toBe("defect-001");
    expect(response.body.cases[0].rawResponse).toBeUndefined();
    expect(response.body.cases[0].sourceBody).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("must not be exposed");
    expect(JSON.stringify(response.body)).not.toContain("provider secret response");
    expect(JSON.stringify(response.body)).not.toContain("model secret response");
    expect(JSON.stringify(response.body)).not.toContain("raw blocker with source body");
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
    await writeEnvelope({
      kind: "free-tier-quality-envelope",
      version: 1,
      suiteVersion: "flight-deck-v2",
      generatedAt: "2026-08-19T01:03:24.000Z",
      providerRecoverySummaries: [{
        provider: "openrouter",
        model: "test-model:free",
        failureCategory: "quota",
        recoveryAction: "choose-alternative",
        evidenceStatus: "incomplete",
        attemptCount: 3,
        providerMessage: "do not expose this",
      }],
      rawResponse: "do not expose this",
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
    expect(response.body.benchmark.freeTierEnvelope.providerRecoverySummaries).toEqual([{
      provider: "openrouter",
      model: "test-model:free",
      failureCategory: "quota",
      recoveryAction: "choose-alternative",
      evidenceStatus: "incomplete",
      attemptCount: 3,
    }]);
    expect(JSON.stringify(response.body)).not.toContain("do not expose this");
  });

  it("keeps historical reports compatible when the optional envelope is absent", async () => {
    process.env.BENCHMARK_OUTPUT_DIR = outputDir;
    const response = await request(app).get("/api/ai/mission-control");

    expect(response.status).toBe(200);
    expect(response.body.benchmark?.freeTierEnvelope).toBeUndefined();
  });

  it("shows empirical measurement and release posture independently", async () => {
    process.env.EMPIRICAL_QUALITY_SCORECARD_PATH = empiricalFile;
    process.env.AI_RELEASE_QUALITY_REPORT_PATH = releaseFile;
    await writeFile(empiricalFile, {
      kind: "empirical-ai-quality-scorecard",
      version: 1,
      measurementOnly: true,
      status: "INCOMPLETE",
      empiricalQualityStatus: "INCOMPLETE",
      blockers: ["provider unavailable"],
      metrics: {},
      cases: [],
    });
    await writeFile(releaseFile, {
      kind: "ai-release-quality-decision",
      version: 1,
      status: "passed",
      liveProviderChecks: "disabled",
      previewChecks: "disabled",
      summary: {
        totalCases: 2,
        passedCases: 2,
        failedCases: 0,
        skippedCases: 0,
        blockingFailures: 0,
        informationalFailures: 0,
      },
      blockers: [],
    });

    const response = await request(app).get("/api/ai/mission-control");

    expect(response.status).toBe(200);
    expect(response.body.benchmark.empiricalCampaign.empiricalQualityStatus).toBe("INCOMPLETE");
    expect(response.body.benchmark.releaseGate.status).toBe("passed");
    expect(response.body.benchmark.releaseGate.blockers).toEqual([]);
    expect(response.body.benchmark.empiricalCampaign.measurementOnly).toBe(true);
  });
});