/**
 * Adaptive query-planning acceptance through the real chat() path.
 *
 * These cases deliberately do not call scheduleSubQueries(), executeHierarchical(),
 * or the planner in isolation. The mocked planner only supplies the server-owned
 * fallback envelope; chat() owns scheduling, bounded tool loops, synthesis, and
 * objective finalization.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";
import type { QueryPlan } from "../agents/query-planner.js";

const originalApiKey = process.env.GROQ_API_KEY;
type ChatFunction = typeof import("../agents/chat-agent.js")["chat"];

const ACCEPTANCE = "src/acceptance/gate.ts";
const EVIDENCE = "src/evidence/producer.ts";
const COUNTEREVIDENCE = "tests/counterevidence.test.ts";
const MISSING = "src/evidence/missing-producer.ts";

const TARGET_BY_INTENT = [
  ["Inspect the acceptance gate contract.", ACCEPTANCE],
  ["Inspect the evidence producer flow.", EVIDENCE],
  ["Inspect counterevidence tests.", COUNTEREVIDENCE],
] as const;

const OBJECTIVE_REPORT = [
  "## 1) Executive Verdict",
  "The provider adapter is present.",
  "## 2) Evidence Map",
  `File: \`${MISSING}\``,
  "Evidence: the provider reported the requested source.",
  "## 3) Findings",
  "No additional finding was asserted.",
  "## 4) Repair Plan",
  "No repair is proposed.",
  "## 5) Validation Checklist",
  "- Confirm the provider adapter source is retained.",
  "## 6) Final Judgment",
  "PROVEN — the required provider adapter claim is complete.",
].join("\n");

function makeContext(): ProjectContext {
  return {
    project: "test | adaptive query planning chat e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

function fallbackPlan(missingTarget?: string): QueryPlan {
  return {
    originalIntent: "Review the architecture and identify verified gaps.",
    targetFiles: [ACCEPTANCE, missingTarget ?? EVIDENCE, COUNTEREVIDENCE],
    targetEntities: [],
    scopeEstimate: "broad",
    suggestedIterations: 40,
    requiresToolUse: true,
    subQueries: TARGET_BY_INTENT.map(([intent]) => intent),
    compoundParts: [],
    planStatus: "fallback",
    planDiagnostics: ["planner timed out or returned no response"],
  };
}

async function makeRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-adaptive-query-"));
  for (const [file, marker] of [
    [ACCEPTANCE, "ACCEPTANCE_GATE_EVIDENCE"],
    [EVIDENCE, "EVIDENCE_PRODUCER_EVIDENCE"],
    [COUNTEREVIDENCE, "COUNTEREVIDENCE_TEST_EVIDENCE"],
  ] as const) {
    const fullPath = path.join(rootPath, file);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, `export const MARKER = "${marker}";\n`, "utf8");
  }
  return rootPath;
}

type Scenario = {
  rootPath: string;
  missingTarget?: string;
  objective?: ObjectiveContract;
};

async function configureChat(
  fakeStrategy: unknown,
  plan: QueryPlan,
): Promise<ChatFunction> {
  vi.resetModules();
  vi.doUnmock("../tools/file-tools.js");
  vi.doUnmock("../tools/git-tools.js");
  vi.doMock("../provider-registry.js", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
    return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
  });
  vi.doMock("../agents/query-planner.js", async () => {
    const actual = await vi.importActual<typeof import("../agents/query-planner.js")>(
      "../agents/query-planner.js",
    );
    return {
      ...actual,
      // The failure is represented by the same server-owned fallback envelope
      // produced by planQuery after a timeout/provider failure.
      planQuery: vi.fn().mockResolvedValue(plan),
    };
  });
  vi.doMock("../model-selection/decision-engine.js", () => ({
    resolveExecutionDecision: vi.fn((scope: string) => ({
      taskProfile: { taskType: scope },
    })),
  }));
  vi.doMock("../model-selection/provider-strategy.js", () => ({
    resolveExecutionProvider: vi.fn((_, provider: string) => ({
      providerId: provider,
    })),
  }));
  vi.doMock("../model-selection/model-resolver.js", () => ({
    resolveExecutionModel: vi.fn(() => ({
      model: "adaptive-test-model",
      powerModel: "adaptive-test-model",
      fallbackChain: ["adaptive-test-model"],
    })),
  }));
  vi.doMock("../openrouter/model-resolver.js", () => ({
    resolveFallbackChain: vi.fn(() => [{ id: "adaptive-test-model" }]),
  }));
  vi.doMock("../agents/speculative-prefetch.js", async () => {
    const actual = await vi.importActual<typeof import("../agents/speculative-prefetch.js")>(
      "../agents/speculative-prefetch.js",
    );
    return {
      ...actual,
      // The acceptance case must observe each sub-query's own read rather than
      // a shared plan-prefetch cache hit.
      prefetchFileList: vi.fn(async () => ({
        injectedMessages: [],
        sources: [],
        cacheEntries: [],
        failedFiles: [],
      })),
      speculativePrefetch: vi.fn(async () => ({
        injectedMessages: [],
        sources: [],
        cacheEntries: [],
      })),
    };
  });

  const { chat } = await import("../agents/chat-agent.js");
  return chat;
}

function makeStrategy(options: {
  missingTarget?: string;
  synthesisResponse?: string;
}) {
  const subqueryReads = new Map<string, number>();
  const providerCalls: Array<{ kind: "subquery" | "synthesis"; target?: string }> = [];

  const strategy = {
    providerId: "openrouter",
    supportsNativeStream: false,
    ownsModelFallback: true,
    call: vi.fn(async (messages: unknown[]) => {
      const serialized = JSON.stringify(messages);
      const synthesis = serialized.includes("You are a synthesis agent.");
      if (synthesis) {
        providerCalls.push({ kind: "synthesis" });
        return {
          content:
            options.synthesisResponse ??
            "CURRENT_STATE: verified acceptance and evidence reads are available.\n" +
              "GAPS: no additional gap was proven.\n" +
              "PRIORITIES: retain the bounded evidence before making changes.",
          toolCalls: [],
          model: "adaptive-test-model",
          usage: {},
        };
      }

      const targetEntry = TARGET_BY_INTENT.find(([intent]) => serialized.includes(intent));
      if (!targetEntry) {
        if (!options.missingTarget) {
          throw new Error("adaptive fixture received an unexpected sub-query prompt");
        }
        const reads = subqueryReads.get(options.missingTarget) ?? 0;
        providerCalls.push({ kind: "subquery", target: options.missingTarget });
        if (!serialized.includes('"role":"tool"') && reads === 0) {
          subqueryReads.set(options.missingTarget, reads + 1);
          return {
            content: "",
            toolCalls: [
              {
                id: `read-${options.missingTarget}`,
                type: "function" as const,
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: options.missingTarget }),
                },
              },
            ],
            model: "adaptive-test-model",
            usage: {},
          };
        }
        return {
          content: JSON.stringify({
            response: OBJECTIVE_REPORT,
            sources: [options.missingTarget],
          }),
          toolCalls: [],
          model: "adaptive-test-model",
          usage: {},
        };
      }

      const [intent, plannedTarget] = targetEntry;
      const target = plannedTarget === EVIDENCE
        ? (options.missingTarget ?? plannedTarget)
        : plannedTarget;
      const reads = subqueryReads.get(target) ?? 0;
      const hasToolOutput = serialized.includes('"role":"tool"');
      providerCalls.push({ kind: "subquery", target });

      if (!hasToolOutput && reads === 0) {
        subqueryReads.set(target, reads + 1);
        return {
          content: "",
          toolCalls: [
            {
              id: `read-${target}`,
              type: "function" as const,
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: target }),
              },
            },
          ],
          model: "adaptive-test-model",
          usage: {},
        };
      }

      // A missing source is intentionally terminal for the bounded subtask.
      // The hierarchical executor preserves that receipt for synthesis instead
      // of retrying indefinitely or treating the error as evidence.
      if (target === options.missingTarget) {
        return {
          content: "NOT PROVEN — the requested source could not be read.",
          toolCalls: [],
          model: "adaptive-test-model",
          usage: {},
        };
      }

      return {
        content: `Verified ${intent} from ${target}.`,
        toolCalls: [],
        model: "adaptive-test-model",
        usage: {},
      };
    }),
    stream: vi.fn(),
  };

  return { strategy, subqueryReads, providerCalls };
}

async function runScenario(scenario: Scenario) {
  const fixture = makeStrategy({
    missingTarget: scenario.missingTarget,
    synthesisResponse: scenario.objective
      ? "PROVEN — every requested objective claim is complete."
      : undefined,
  });
  const chat = await configureChat(
    fixture.strategy,
    fallbackPlan(scenario.missingTarget),
  );
  const steps: AgentStep[] = [];
  const result = await chat({
    message: "Current project components and primary flow",
    history: [],
    projectContext: makeContext(),
    rootPath: scenario.rootPath,
    provider: "openrouter",
    apiKey: "test-or-key",
    objective: scenario.objective,
    onStep: (step: AgentStep) => steps.push(step),
  });
  return { ...fixture, result, steps };
}

describe("chat() adaptive fallback planning and bounded evidence", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("uses a fallback plan, executes independent sub-query scopes, and synthesizes their retained reads", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, steps, providerCalls, subqueryReads } = await runScenario({ rootPath });

      const planActivity = steps.find(
        (step): step is Extract<AgentStep, { kind: "plan_activity" }> =>
          step.kind === "plan_activity" && step.stage === "plan",
      );
      expect(planActivity?.resultSummary).toContain("queryPlanStatus=fallback");
      expect(planActivity?.resultSummary).toContain("planner timed out");

      const subqueryTargets = providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target);
      expect(new Set(subqueryTargets)).toEqual(new Set([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]));
      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);

      expect(result.response).toContain("CURRENT_STATE");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps a missing sub-query bounded and refuses PROVEN when its required claim is incomplete", async () => {
    const rootPath = await makeRoot();
    try {
      const objective: ObjectiveContract = {
        objectiveType: "PRODUCTION_REACHABILITY",
        goal: "Prove that the provider adapter is present.",
        requiredEvidencePaths: [MISSING],
        requiredClaims: [
          {
            claimId: "provider-adapter-present",
            text: "The provider adapter is present.",
            requiredEvidencePaths: [MISSING],
          },
        ],
        requiredEvidenceEdges: [],
      };

      const { result, steps, subqueryReads, strategy } = await runScenario({
        rootPath,
        missingTarget: MISSING,
        objective,
      });

      // The missing path is part of the server-owned objective manifest, but
      // it is not read successfully. The fixture must not spin in recovery.
      const missingReadAttempts = subqueryReads.get(MISSING) ?? 0;
      expect(missingReadAttempts).toBeGreaterThan(0);
      expect(missingReadAttempts).toBeLessThanOrEqual(3);
      expect(strategy.call.mock.calls.length).toBeLessThanOrEqual(6);

      expect(result.response).toMatch(/BLOCKED|NOT PROVEN|ANALYSIS_INCOMPLETE|محظور/);
      expect(result.response).not.toMatch(/Final Judgment\s*\n\s*PROVEN\b/i);
      expect(
        steps.some((step) => step.kind === "diagnostic" && step.code === "OBJECTIVE_BLOCKED"),
      ).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});