/**
 * EI-029/030 — Scoped Verdict Seam: end-to-end regression.
 *
 * Verifies that the final-response seam in chat() correctly replaces the
 * generic "FINDING PROVEN" label with a scoped label when retained evidence
 * comes from fixture/test/spec paths, while leaving it unchanged for
 * production-scope evidence (including non-TS languages).
 *
 * Note: plan-prefetch filters fixture paths via isForensicTestSourcePath, so
 * fixture evidence must enter forensicFileContents through the agentic loop
 * (model calls read_file on the fixture file). Production files can use either
 * path; we use an in-loop read_file call here for consistency.
 *
 * Test matrix:
 *   1. Fixture-path evidence (tests/fixtures/defect.ts) → FIXTURE_PROVEN
 *      → final response contains the scoped label
 *        "FIXTURE-LOCAL FINDING PROVEN — PRODUCTION REACHABILITY NOT PROVEN"
 *
 *   2. Non-TS production evidence (src/service.py) → PRODUCTION_PROVEN
 *      → final response is NOT overwritten with any scoped label
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | scoped verdict seam",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

async function mockChatProviders(fakeStrategy: unknown, plan: unknown): Promise<void> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
  });
  vi.doMock("../agents/query-planner.js", () => ({
    planQuery: vi.fn(() => Promise.resolve(plan)),
  }));
  vi.doMock("../model-selection/decision-engine.js", () => ({
    resolveExecutionDecision: vi.fn((scope: string) => ({ taskProfile: { taskType: scope } })),
  }));
  vi.doMock("../model-selection/provider-strategy.js", () => ({
    resolveExecutionProvider: vi.fn((_, provider: string) => ({ providerId: provider })),
  }));
  vi.doMock("../model-selection/model-resolver.js", () => ({
    resolveExecutionModel: vi.fn(() => ({
      model: "initial-model",
      powerModel: "initial-model",
      fallbackChain: ["initial-model"],
    })),
  }));
  vi.doMock("../openrouter/model-resolver.js", () => ({
    resolveFallbackChain: vi.fn(() => [{ id: "initial-model" }]),
  }));
}

/**
 * An empty plan (no targetFiles) so the plan-prefetch path is skipped.
 * The model reads the evidence file itself via read_file during the loop.
 */
function emptyPlan() {
  return {
    targetFiles: [],
    targetEntities: [],
    scopeEstimate: "narrow",
    suggestedIterations: 8,
    requiresToolUse: true,
    subQueries: [],
  };
}

/**
 * Strategy: on the first call, issue a read_file tool call for evidenceFile.
 * On the second call, return the "FINDING PROVEN" text response. This ensures
 * evidenceFile goes into loopResult.fileContents → forensicFileContents
 * without relying on plan-prefetch (which filters fixture/test paths).
 */
function readThenAnswerStrategy(
  evidenceFile: string,
  modelResponse: string,
  calls: { count: number },
): unknown {
  let readIssued = false;
  return {
    providerId: "openrouter",
    supportsNativeStream: false,
    call: vi.fn(async (_messages: unknown, opts: { tools?: Array<{ function: { name: string } }> }) => {
      calls.count += 1;
      if (!readIssued && opts.tools?.some((t) => t.function.name === "read_file")) {
        readIssued = true;
        return {
          content: "",
          toolCalls: [{
            id: "read-evidence",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: evidenceFile }),
            },
          }],
          model: "initial-model",
          usage: {},
        };
      }
      return {
        content: JSON.stringify({ response: modelResponse, sources: [evidenceFile] }),
        toolCalls: [],
        model: "initial-model",
        usage: {},
      };
    }),
    stream: vi.fn(),
  };
}

// Plain-text question that does not trigger isExplicitBehaviorQueryRequest, so
// the behavior-evidence gate is bypassed and the model's verdict text reaches
// the scoped-label seam without being overridden.
const MESSAGE = "Summarize the issues found in this file.";

// Use the canonical underscore form "FINDING_PROVEN" — the form providers emit
// when following the forensic JSON prompt verbatim. The seam must normalise
// FINDING_PROVEN → FINDING PROVEN for production scope, and must replace it
// with the scoped label for fixture/test scope.
const FINDING_PROVEN_RESPONSE =
  "Analysis complete. FINDING_PROVEN — the eval call on user input is unsafe.";

describe("chat() scoped-verdict seam (EI-029/030)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("replaces bare FINDING PROVEN with the fixture-local scoped label when evidence is fixture-scoped", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-scoped-verdict-fx-"));
    const FIXTURE_FILE = "tests/fixtures/defect.ts";
    await fs.mkdir(path.join(rootPath, "tests", "fixtures"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, FIXTURE_FILE),
      "export function evaluate(expr: string) { return eval(expr); }",
      "utf8",
    );

    const calls = { count: 0 };
    await mockChatProviders(
      readThenAnswerStrategy(FIXTURE_FILE, FINDING_PROVEN_RESPONSE, calls),
      emptyPlan(),
    );

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
      });

      expect(calls.count).toBeGreaterThan(0);
      // The seam must replace FINDING_PROVEN (underscore, canonical forensic form)
      // with the fixture-local scoped label.
      expect(result.response).toContain("FIXTURE-LOCAL FINDING PROVEN");
      expect(result.response).toContain("PRODUCTION REACHABILITY NOT PROVEN");
      // Neither the bare-space nor the underscore form must survive.
      const withoutScoped = result.response.replace(
        /FIXTURE-LOCAL FINDING PROVEN[^\n]*/g,
        "",
      );
      expect(withoutScoped).not.toMatch(/\bFINDING[_ ]PROVEN\b/);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("retains the bare FINDING PROVEN label when evidence is production-scoped (non-TS, .py)", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-scoped-verdict-py-"));
    const PY_FILE = "src/service.py";
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, PY_FILE),
      "def evaluate(expr):\n    return eval(expr)\n",
      "utf8",
    );

    const calls = { count: 0 };
    await mockChatProviders(
      readThenAnswerStrategy(PY_FILE, FINDING_PROVEN_RESPONSE, calls),
      emptyPlan(),
    );

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
      });

      expect(calls.count).toBeGreaterThan(0);
      // Production-scoped evidence must NOT produce a scoped label.
      expect(result.response).not.toContain("FIXTURE-LOCAL FINDING PROVEN");
      expect(result.response).not.toContain("TEST-LOCAL FINDING PROVEN");
      // FINDING_PROVEN (underscore) must be normalised away — the user-facing
      // text must always use the space form "FINDING PROVEN".
      expect(result.response).not.toContain("FINDING_PROVEN");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
