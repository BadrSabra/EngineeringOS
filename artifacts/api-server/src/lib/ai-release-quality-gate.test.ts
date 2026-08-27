import { describe, expect, it } from "vitest";
import {
  evaluateAiReleaseQuality,
  getAiReleaseChecks,
  type AiReleaseCheckResult,
} from "./ai-release-quality-gate.js";

function result(overrides: Partial<AiReleaseCheckResult> = {}): AiReleaseCheckResult {
  return {
    id: "fixture",
    kind: "contract",
    command: "fixture",
    blocking: true,
    enabled: true,
    coverage: ["fixture"],
    status: "passed",
    durationMs: 1,
    ...overrides,
  };
}

describe("AI release quality gate", () => {
  it("keeps preview and live-provider lanes opt-in", () => {
    const checks = getAiReleaseChecks();
    expect(checks.find((check) => check.id === "dashboard-preview-contract")?.enabled).toBe(false);
    expect(checks.some((check) => check.id === "live-provider-quality")).toBe(false);
  });

  it("adds only a non-blocking structured-review campaign when live checks are requested", () => {
    const live = getAiReleaseChecks({ enableLiveProvider: true });
    const check = live.find((candidate) => candidate.id === "live-provider-quality");
    expect(check).toMatchObject({
      enabled: true,
      blocking: false,
      command: expect.stringContaining("validate:live-provider-review"),
    });
    expect(check?.coverage).toEqual(expect.arrayContaining([
      "reasoning-only and agent-harness recovery",
      "rate-limit, empty, and malformed incomplete receipts",
    ]));
  });

  it("blocks a failed typecheck or false-success benchmark without raw output", () => {
    const decision = evaluateAiReleaseQuality([
      result({ id: "api-typecheck", kind: "typecheck", failureCode: "API_TYPECHECK_FAILED_2", status: "failed" }),
      result({ id: "benchmark", kind: "benchmark", failureCode: "FALSE_SUCCESS", status: "failed" }),
      result({ id: "informational", blocking: false, status: "failed", failureCode: "LATENCY_HIGH" }),
    ]);
    expect(decision.status).toBe("blocked");
    expect(decision.summary.blockingFailures).toBe(2);
    expect(decision.summary.informationalFailures).toBe(1);
    expect(JSON.stringify(decision)).not.toContain("prompt");
  });

  it("reports skipped preview cases while preserving a deterministic decision", () => {
    const checks = getAiReleaseChecks();
    const preview = checks.find((check) => check.id === "dashboard-preview-contract")!;
    const decision = evaluateAiReleaseQuality([
      result({ ...preview, status: "skipped" }),
    ]);
    expect(decision.status).toBe("passed");
    expect(decision.summary.skippedCases).toBe(1);
  });
});