/**
 * Task #56 — FEG-017: say WHY an investigation never reached evidence instead
 * of a flat NOT_PROVEN.
 *
 * A bare NOT_PROVEN conflates very different failures. This test locks the
 * four-way classification used to explain the terminal:
 *   - INVESTIGATION_NOT_STARTED            (0-read run — never NO_EVIDENCE_FOUND)
 *   - EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED
 *   - INVESTIGATION_BUDGET_EXHAUSTED
 *   - NO_EVIDENCE_FOUND
 *
 * It covers:
 *   1. the deterministic classifier precedence for all four kinds (unit);
 *   2. a claim-unclosed NOT_PROVEN run propaged through chat() end to end so
 *      a `forensic_terminal` AgentStep with EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED
 *      is emitted on the final return path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import { classifyForensicTerminal } from "../audit-telemetry.js";

const originalApiKey = process.env.GROQ_API_KEY;

describe("classifyForensicTerminal precedence (task #56 / FEG-017)", () => {
  it("a 0-evidence run is INVESTIGATION_NOT_STARTED, never NO_EVIDENCE_FOUND", () => {
    // Zero reads beats every other signal: even a budget-exhausted 0-read run
    // must not masquerade as "searched and found nothing".
    expect(classifyForensicTerminal({
      evidenceAcquired: false,
      budgetExhausted: false,
      claimsUnclosedButEvidenceAvailable: false,
    })).toBe("INVESTIGATION_NOT_STARTED");
    expect(classifyForensicTerminal({
      evidenceAcquired: false,
      budgetExhausted: true,
      claimsUnclosedButEvidenceAvailable: false,
    })).toBe("INVESTIGATION_NOT_STARTED");
    expect(classifyForensicTerminal({
      evidenceAcquired: false,
      budgetExhausted: true,
      claimsUnclosedButEvidenceAvailable: true,
    })).toBe("INVESTIGATION_NOT_STARTED");
  });

  it("retained evidence with an unclosed required claim is EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED", () => {
    expect(classifyForensicTerminal({
      evidenceAcquired: true,
      budgetExhausted: false,
      claimsUnclosedButEvidenceAvailable: true,
    })).toBe("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");
    // The unclosed-claim explanation wins over the budget explanation when both
    // are true: an inventory that never closed a claim is not a budget story.
    expect(classifyForensicTerminal({
      evidenceAcquired: true,
      budgetExhausted: true,
      claimsUnclosedButEvidenceAvailable: true,
    })).toBe("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");
  });

  it("evidence plus a budget cap is INVESTIGATION_BUDGET_EXHAUSTED", () => {
    expect(classifyForensicTerminal({
      evidenceAcquired: true,
      budgetExhausted: true,
      claimsUnclosedButEvidenceAvailable: false,
    })).toBe("INVESTIGATION_BUDGET_EXHAUSTED");
  });

  it("ran to a normal end with evidence but no proof is NO_EVIDENCE_FOUND", () => {
    expect(classifyForensicTerminal({
      evidenceAcquired: true,
      budgetExhausted: false,
      claimsUnclosedButEvidenceAvailable: false,
    })).toBe("NO_EVIDENCE_FOUND");
  });
});

// ── chat() end-to-end harness (reuses the task #53 claim-unclosed pattern) ──

function makeContext(): ProjectContext {
  return {
    project: "test | terminal-kind e2e",
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

const FILE = "src/loop.ts";
const FILE_CONTENT = [
  "export const MAX_ITERATIONS = 20;",
  "export function run() {",
  "  return MAX_ITERATIONS;",
  "}",
].join("\n");

const PLAN = {
  targetFiles: [FILE],
  targetEntities: [],
  scopeEstimate: "narrow",
  suggestedIterations: 8,
  requiresToolUse: true,
  subQueries: [],
};

describe("chat() emits a forensic_terminal step explaining a NOT_PROVEN run (task #56)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("surfaces EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED when evidence is retained but no claim is closed", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-terminal-kind-"));
    await fs.mkdir(path.join(rootPath, "src"), { recursive: true });
    await fs.writeFile(path.join(rootPath, FILE), FILE_CONTENT, "utf8");

    // The model cites NO exact source excerpt, so grounding yields zero evidence
    // references even though the plan-prefetch retained a real source body — the
    // run ends NOT PROVEN with evidence available but the claim unclosed.
    const ungroundedResponse = "The loop runs up to its configured limit without exceeding it.";
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      call: vi.fn(async () => ({
        content: JSON.stringify({ response: ungroundedResponse, sources: [FILE] }),
        toolCalls: [],
        model: "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy, PLAN);

    try {
      const steps: AgentStep[] = [];
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: "Does the loop run at most 20 iterations?",
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => steps.push(step),
      });

      // The run is NOT proven — the inventory alone cannot close the claim.
      expect(result.response).toMatch(/^NOT PROVEN/);

      // FEG-017: a forensic_terminal step carrying the EXPLANATION kind is
      // emitted on the final NOT_PROVEN return path — not a flat bubble.
      const terminal = [...steps].reverse().find((s) => s.kind === "forensic_terminal");
      expect(terminal?.kind).toBe("forensic_terminal");
      if (terminal?.kind === "forensic_terminal") {
        expect(terminal.terminalKind).toBe("EVIDENCE_AVAILABLE_BUT_CLAIM_UNCLOSED");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
