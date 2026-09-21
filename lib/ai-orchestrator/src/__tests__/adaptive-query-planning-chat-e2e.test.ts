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
const ADAPTER = "src/provider/adapter.ts";
const CLIENT = "src/provider/client.ts";
const CONNECTOR = "src/provider/connector.ts";
const GENERAL = "docs/system-overview.md";

type TargetMap = readonly (readonly [string, string])[];

const TARGET_BY_INTENT = [
  ["Inspect the acceptance gate contract.", ACCEPTANCE],
  ["Inspect the evidence producer flow.", EVIDENCE],
  ["Inspect counterevidence tests.", COUNTEREVIDENCE],
] as const satisfies TargetMap;

const INDEPENDENT_TARGET_BY_INTENT = [
  ["Inspect the provider adapter transport.", ADAPTER],
  ["Inspect the provider adapter client.", CLIENT],
  ["Inspect the provider adapter connector.", CONNECTOR],
] as const satisfies TargetMap;

const CASCADE_TARGET_BY_INTENT = [
  ["Inspect the acceptance gate contract.", ACCEPTANCE],
  ["Inspect the evidence producer flow.", EVIDENCE],
  ["Inspect deployment notes.", GENERAL],
  ["Inspect counterevidence tests.", COUNTEREVIDENCE],
] as const satisfies TargetMap;

const PARTIAL_OBJECTIVE_TARGET_BY_INTENT = [
  ["Inspect the acceptance gate contract.", ACCEPTANCE],
  ["Inspect the evidence producer flow.", EVIDENCE],
  ["Inspect supporting implementation source.", MISSING],
] as const satisfies TargetMap;

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

function independentProviderPlan(): QueryPlan {
  return {
    originalIntent: "Inspect independent provider adapter surfaces.",
    targetFiles: [ADAPTER, CLIENT, CONNECTOR],
    targetEntities: [],
    scopeEstimate: "broad",
    suggestedIterations: 40,
    requiresToolUse: true,
    subQueries: INDEPENDENT_TARGET_BY_INTENT.map(([intent]) => intent),
    compoundParts: [],
    planStatus: "fallback",
    planDiagnostics: ["planner timed out or returned no response"],
  };
}

function dependencyCascadePlan(): QueryPlan {
  return {
    originalIntent: "Review the acceptance, evidence, deployment, and counterevidence paths.",
    targetFiles: [ACCEPTANCE, EVIDENCE, GENERAL, COUNTEREVIDENCE],
    targetEntities: [],
    scopeEstimate: "broad",
    suggestedIterations: 40,
    requiresToolUse: true,
    subQueries: CASCADE_TARGET_BY_INTENT.map(([intent]) => intent),
    compoundParts: [],
    planStatus: "fallback",
    planDiagnostics: ["planner timed out or returned no response"],
  };
}

function partialObjectivePlan(): QueryPlan {
  return {
    originalIntent: "Prove that the evidence producer and supporting implementation are present.",
    targetFiles: [ACCEPTANCE, EVIDENCE, MISSING],
    targetEntities: [],
    scopeEstimate: "broad",
    suggestedIterations: 40,
    requiresToolUse: true,
    subQueries: PARTIAL_OBJECTIVE_TARGET_BY_INTENT.map(([intent]) => intent),
    compoundParts: [],
    planStatus: "fallback",
    planDiagnostics: ["planner timed out or returned no response"],
  };
}

function compoundFallbackPlan(): QueryPlan {
  return {
    originalIntent: "Summarize the current state, gaps, and priorities.",
    targetFiles: [ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE],
    targetEntities: [],
    scopeEstimate: "broad",
    suggestedIterations: 40,
    requiresToolUse: true,
    subQueries: TARGET_BY_INTENT.map(([intent]) => intent),
    compoundParts: [
      {
        id: "current-state",
        kind: "CURRENT_STATE",
        question: "What is the current verified state?",
        requiresCitation: true,
      },
      {
        id: "gaps",
        kind: "GAPS",
        question: "Which gaps remain unproven?",
        requiresCitation: true,
      },
      {
        id: "priorities",
        kind: "PRIORITIES",
        question: "What should be prioritized next?",
        requiresCitation: true,
      },
    ],
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
    [ADAPTER, "PROVIDER_ADAPTER_EVIDENCE"],
    [CLIENT, "PROVIDER_CLIENT_EVIDENCE"],
    [CONNECTOR, "PROVIDER_CONNECTOR_EVIDENCE"],
    [GENERAL, "SYSTEM_OVERVIEW_EVIDENCE"],
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
  synthesisResponse?: string;
  plan?: QueryPlan;
  targetByIntent?: TargetMap;
  signal?: AbortSignal;
  abortController?: AbortController;
  providerFailureTarget?: string;
  providerFailureAfterReadTarget?: string;
  remapEvidenceTarget?: boolean;
  synthesisFailure?: "throw" | "tool_call";
  abortAfterSubqueryTarget?: string;
  subqueryDelayMs?: number;
  toolCallPathByTarget?: Record<string, string>;
  toolCallNameByTarget?: Record<string, "read_file" | "read_file_range">;
  correctAfterScopeBlock?: boolean;
  scopeCorrectionPathByTarget?: Record<string, string>;
  additionalToolCallPathByTarget?: Record<string, string>;
  correctAfterRangeError?: boolean;
  invalidRangeFirstByTarget?: Record<string, boolean>;
  abortAfterRangeCorrection?: boolean;
  repeatInvalidRangeCorrection?: boolean;
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
  targetByIntent?: TargetMap;
  abortController?: AbortController;
  providerFailureTarget?: string;
  providerFailureAfterReadTarget?: string;
  remapEvidenceTarget?: boolean;
  synthesisFailure?: "throw" | "tool_call";
  abortAfterSubqueryTarget?: string;
  subqueryDelayMs?: number;
  toolCallPathByTarget?: Record<string, string>;
  toolCallNameByTarget?: Record<string, "read_file" | "read_file_range">;
  correctAfterScopeBlock?: boolean;
  scopeCorrectionPathByTarget?: Record<string, string>;
  additionalToolCallPathByTarget?: Record<string, string>;
  correctAfterRangeError?: boolean;
  invalidRangeFirstByTarget?: Record<string, boolean>;
  abortAfterRangeCorrection?: boolean;
  repeatInvalidRangeCorrection?: boolean;
}) {
  const subqueryReads = new Map<string, number>();
  const providerCalls: Array<{ kind: "subquery" | "synthesis"; target?: string }> = [];
  const correctedScopeTargets = new Set<string>();
  const correctedRangeTargets = new Set<string>();
  let activeSubqueries = 0;
  let maxConcurrentSubqueries = 0;
  const targetByIntent = options.targetByIntent ?? TARGET_BY_INTENT;

  const strategy = {
    providerId: "openrouter",
    supportsNativeStream: false,
    ownsModelFallback: true,
    call: vi.fn(async (messages: unknown[]) => {
      const serialized = JSON.stringify(messages);
      const synthesis = serialized.includes("You are a synthesis agent.");
      if (synthesis) {
        providerCalls.push({ kind: "synthesis" });
        if (options.abortController) {
          options.abortController.abort();
          throw new Error("simulated adaptive synthesis cancellation");
        }
        if (options.synthesisFailure === "throw") {
          throw new Error("simulated adaptive synthesis provider failure");
        }
        if (options.synthesisFailure === "tool_call") {
          return {
            content: "",
            toolCalls: [
              {
                id: "synthesis-tool-call",
                type: "function" as const,
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: ADAPTER }),
                },
              },
            ],
            model: "adaptive-test-model",
            usage: {},
          };
        }
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

      const targetEntry = targetByIntent.find(([intent]) => serialized.includes(intent));
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
      const target = plannedTarget === EVIDENCE && options.remapEvidenceTarget !== false
        ? (options.missingTarget ?? plannedTarget)
        : plannedTarget;
      if (options.subqueryDelayMs) {
        activeSubqueries += 1;
        maxConcurrentSubqueries = Math.max(maxConcurrentSubqueries, activeSubqueries);
        await new Promise((resolve) => setTimeout(resolve, options.subqueryDelayMs));
        activeSubqueries -= 1;
      }
      if (options.providerFailureTarget === target) {
        providerCalls.push({ kind: "subquery", target });
        throw new Error(`simulated provider failure for ${target}`);
      }
      const reads = subqueryReads.get(target) ?? 0;
      const hasToolOutput = serialized.includes('"role":"tool"');
      providerCalls.push({ kind: "subquery", target });

      if (options.providerFailureAfterReadTarget === target && hasToolOutput) {
        throw new Error(`simulated provider failure after reading ${target}`);
      }

      if (
        options.correctAfterScopeBlock &&
        hasToolOutput &&
        serialized.includes("explicitly named target file") &&
        !correctedScopeTargets.has(target)
      ) {
        correctedScopeTargets.add(target);
        return {
          content: "",
          toolCalls: [
            {
              id: `corrected-read-${target}`,
              type: "function" as const,
              function: {
                name: "read_file",
                arguments: JSON.stringify({
                  path: options.scopeCorrectionPathByTarget?.[target] ?? target,
                }),
              },
            },
          ],
          model: "adaptive-test-model",
          usage: {},
        };
      }

      const hasRangeContractError =
        hasToolOutput &&
        serialized.includes("must be positive integers with startLine <= endLine");
      if (
        options.correctAfterRangeError &&
        hasRangeContractError &&
        (!correctedRangeTargets.has(target) || options.repeatInvalidRangeCorrection)
      ) {
        const firstCorrection = !correctedRangeTargets.has(target);
        correctedRangeTargets.add(target);
        if (firstCorrection && options.abortAfterRangeCorrection) {
          options.abortController?.abort();
        }
        return {
          content: "",
          toolCalls: [
            {
              id: `corrected-range-read-${target}`,
              type: "function" as const,
              function: {
                name: "read_file_range",
                arguments: JSON.stringify({
                  path: target,
                    ...(options.repeatInvalidRangeCorrection
                      ? { startLine: 5, endLine: 2 }
                      : { startLine: 1, endLine: 5 }),
                }),
              },
            },
          ],
          model: "adaptive-test-model",
          usage: {},
        };
      }

      if (!hasToolOutput && reads === 0) {
        subqueryReads.set(target, reads + 1);
          const toolName = options.toolCallNameByTarget?.[target] ?? "read_file";
          const toolArguments = {
            path: options.toolCallPathByTarget?.[target] ?? target,
            ...(toolName === "read_file_range"
              ? (options.invalidRangeFirstByTarget?.[target]
                ? { startLine: 5, endLine: 2 }
                : { startLine: 1, endLine: 5 })
              : {}),
          };
        return {
          content: "",
          toolCalls: [
            {
              id: `read-${target}`,
              type: "function" as const,
              function: {
                name: toolName,
                arguments: JSON.stringify(toolArguments),
              },
            },
            ...(options.additionalToolCallPathByTarget?.[target]
              ? [{
                  id: `out-of-scope-read-${target}`,
                  type: "function" as const,
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({
                      path: options.additionalToolCallPathByTarget[target],
                    }),
                  },
                }]
              : []),
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

      const completedResponse = {
        content: `Verified ${intent} from ${target}.`,
        toolCalls: [],
        model: "adaptive-test-model",
        usage: {},
      };
      if (options.abortAfterSubqueryTarget === target && hasToolOutput) {
        options.abortController?.abort();
      }
      return completedResponse;
    }),
    stream: vi.fn(),
  };

  return { strategy, subqueryReads, providerCalls, get maxConcurrentSubqueries() {
    return maxConcurrentSubqueries;
  } };
}

async function runScenario(scenario: Scenario) {
  const fixture = makeStrategy({
    missingTarget: scenario.missingTarget,
    targetByIntent: scenario.targetByIntent,
    abortController: scenario.abortController,
    providerFailureTarget: scenario.providerFailureTarget,
    providerFailureAfterReadTarget: scenario.providerFailureAfterReadTarget,
    remapEvidenceTarget: scenario.remapEvidenceTarget,
    synthesisFailure: scenario.synthesisFailure,
    abortAfterSubqueryTarget: scenario.abortAfterSubqueryTarget,
    subqueryDelayMs: scenario.subqueryDelayMs,
    toolCallPathByTarget: scenario.toolCallPathByTarget,
    toolCallNameByTarget: scenario.toolCallNameByTarget,
    correctAfterScopeBlock: scenario.correctAfterScopeBlock,
    scopeCorrectionPathByTarget: scenario.scopeCorrectionPathByTarget,
    additionalToolCallPathByTarget: scenario.additionalToolCallPathByTarget,
    correctAfterRangeError: scenario.correctAfterRangeError,
    invalidRangeFirstByTarget: scenario.invalidRangeFirstByTarget,
    abortAfterRangeCorrection: scenario.abortAfterRangeCorrection,
    repeatInvalidRangeCorrection: scenario.repeatInvalidRangeCorrection,
    synthesisResponse: scenario.synthesisResponse
      ?? (scenario.objective
        ? "PROVEN — every requested objective claim is complete."
        : undefined),
  });
  const chat = await configureChat(
    fixture.strategy,
    scenario.plan ?? fallbackPlan(scenario.missingTarget),
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
    signal: scenario.signal,
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
      expect([...new Set(subqueryTargets)]).toEqual([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]);
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

  it("keeps a failed hierarchical sub-query bounded and carries its gap into synthesis", async () => {
    const rootPath = await makeRoot();
    await fs.rm(path.join(rootPath, EVIDENCE));
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        missingTarget: EVIDENCE,
        synthesisResponse:
          "CURRENT_STATE: acceptance and counterevidence were retained.\n" +
          "GAPS: NOT PROVEN — the evidence producer source could not be read.\n" +
          "PRIORITIES: recover the missing source before asserting completeness.",
      });

      const subqueryTargets = providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target);
      expect([...new Set(subqueryTargets)]).toEqual([ACCEPTANCE, EVIDENCE]);
      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("NOT PROVEN");
      expect(result.response).not.toContain("OBJECTIVE_BLOCKED");

      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toContain(ACCEPTANCE);
      expect(graphReads).not.toContain(EVIDENCE);
      expect(graphReads).not.toContain(COUNTEREVIDENCE);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("runs independent fallback sub-queries in one scheduler wave", async () => {
    const rootPath = await makeRoot();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
      });

      const subqueryTargets = providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target);
      expect([...new Set(subqueryTargets)]).toEqual([ADAPTER, CLIENT, CONNECTOR]);
      expect(subqueryReads).toEqual(new Map([
        [ADAPTER, 1],
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("CURRENT_STATE");

      const wave = info.mock.calls
        .map(([message]) => {
          if (typeof message !== "string") return undefined;
          try {
            return JSON.parse(message) as { code?: string; taskCount?: number; tasks?: unknown[] };
          } catch {
            return undefined;
          }
        })
        .find((event) => event?.code === "SCHEDULING_WAVE_STARTED");
      expect(wave?.taskCount).toBe(3);
      expect(wave?.tasks).toHaveLength(3);
    } finally {
      info.mockRestore();
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("executes independent adaptive sub-queries concurrently and synthesizes only after all receipts", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads, maxConcurrentSubqueries } = await runScenario({
        rootPath,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
        subqueryDelayMs: 5,
      });

      expect(maxConcurrentSubqueries).toBeGreaterThan(1);
      expect(subqueryReads).toEqual(new Map([
        [ADAPTER, 1],
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "subquery")).toHaveLength(6);
      expect(providerCalls.at(-1)?.kind).toBe("synthesis");
      expect(result.response).toContain("CURRENT_STATE");
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toEqual(
        expect.arrayContaining([ADAPTER, CLIENT, CONNECTOR]),
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects a sub-query tool read outside its server-declared target scope", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, subqueryReads, providerCalls } = await runScenario({
        rootPath,
        plan: fallbackPlan(),
        targetByIntent: TARGET_BY_INTENT,
        toolCallPathByTarget: { [ACCEPTANCE]: GENERAL },
        synthesisResponse:
          "CURRENT_STATE: the acceptance gate is verified in `src/acceptance/gate.ts`, " +
          "the evidence producer is verified in `src/evidence/producer.ts`, and the " +
          "counterevidence tests are verified in `src/evidence/counterevidence.test.ts`.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: ship the verified implementation.",
      });

      expect(subqueryReads).toEqual(new Map([[ACCEPTANCE, 1]]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain("citation is not a retained source window");
      expect(result.response).not.toContain(GENERAL);
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).not.toContain(GENERAL);
      expect(graphReads).not.toContain(ACCEPTANCE);
      expect(graphReads).not.toContain(EVIDENCE);
      expect(graphReads).not.toContain(COUNTEREVIDENCE);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("applies the same target boundary to out-of-scope read_file_range calls", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, subqueryReads } = await runScenario({
        rootPath,
        plan: fallbackPlan(),
        targetByIntent: TARGET_BY_INTENT,
        toolCallNameByTarget: { [ACCEPTANCE]: "read_file_range" },
        toolCallPathByTarget: { [ACCEPTANCE]: GENERAL },
        synthesisResponse:
          "CURRENT_STATE: the acceptance gate is verified in `src/acceptance/gate.ts`.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: ship the verified implementation.",
      });

      expect(subqueryReads).toEqual(new Map([[ACCEPTANCE, 1]]));
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain("citation is not a retained source window");
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toEqual([]);
      expect(result.response).not.toContain(GENERAL);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("adapts once after a server scope rejection and then retains the corrected evidence", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: fallbackPlan(),
        targetByIntent: TARGET_BY_INTENT,
        toolCallPathByTarget: { [ACCEPTANCE]: GENERAL },
        correctAfterScopeBlock: true,
        synthesisResponse:
          "CURRENT_STATE: the acceptance gate is verified in `src/acceptance/gate.ts`, " +
          "the evidence producer is verified in `src/evidence/producer.ts`, and the " +
          "counterevidence tests are verified in `tests/counterevidence.test.ts`.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: retain the corrected evidence before shipping.",
      });

      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ACCEPTANCE))
        .toHaveLength(3);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("CURRENT_STATE");
      expect(result.response).not.toContain(GENERAL);
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toEqual(expect.arrayContaining([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]));
      expect(graphReads).not.toContain(GENERAL);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails closed when the provider's one scope correction is still outside the task boundary", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: fallbackPlan(),
        targetByIntent: TARGET_BY_INTENT,
        toolCallPathByTarget: { [ACCEPTANCE]: GENERAL },
        correctAfterScopeBlock: true,
        scopeCorrectionPathByTarget: { [ACCEPTANCE]: ADAPTER },
        synthesisResponse:
          "CURRENT_STATE: every requested source is verified.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: ship the verified implementation.",
      });

      expect(subqueryReads).toEqual(new Map([[ACCEPTANCE, 1]]));
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ACCEPTANCE))
        .toHaveLength(3);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).not.toContain(GENERAL);
      expect(result.response).not.toContain(ADAPTER);
      expect(result.response).not.toContain("PROVEN");
      expect(result.evidenceGraph?.reads ?? []).toEqual([]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("isolates mixed valid and out-of-scope tool calls from the same provider turn", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: fallbackPlan(),
        targetByIntent: TARGET_BY_INTENT,
        additionalToolCallPathByTarget: { [ACCEPTANCE]: GENERAL },
        synthesisResponse:
          "CURRENT_STATE: the acceptance gate is verified in `src/acceptance/gate.ts`, " +
          "the evidence producer is verified in `src/evidence/producer.ts`, and the " +
          "counterevidence tests are verified in `tests/counterevidence.test.ts`.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: retain only the accepted evidence before shipping.",
      });

      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ACCEPTANCE))
        .toHaveLength(2);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("CURRENT_STATE");
      expect(result.response).not.toContain(GENERAL);
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toEqual(expect.arrayContaining([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]));
      expect(graphReads).not.toContain(GENERAL);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("repairs an invalid targeted range after the tool reports its argument contract", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: fallbackPlan(),
        targetByIntent: TARGET_BY_INTENT,
        toolCallNameByTarget: { [ACCEPTANCE]: "read_file_range" },
        invalidRangeFirstByTarget: { [ACCEPTANCE]: true },
        correctAfterRangeError: true,
        synthesisResponse:
          "CURRENT_STATE: the acceptance gate is verified in `src/acceptance/gate.ts`, " +
          "the evidence producer is verified in `src/evidence/producer.ts`, and the " +
          "counterevidence tests are verified in `tests/counterevidence.test.ts`.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: preserve the bounded targeted evidence.",
      });

      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ACCEPTANCE))
        .toHaveLength(3);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("CURRENT_STATE");
      expect(result.response).not.toContain("ANALYSIS_INCOMPLETE");
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toEqual(expect.arrayContaining([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]));
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("repairs one concurrent sibling's range contract without delaying the rest of the wave", async () => {
    const rootPath = await makeRoot();
    try {
      const {
        result,
        providerCalls,
        subqueryReads,
        maxConcurrentSubqueries,
      } = await runScenario({
        rootPath,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
        toolCallNameByTarget: { [ADAPTER]: "read_file_range" },
        invalidRangeFirstByTarget: { [ADAPTER]: true },
        correctAfterRangeError: true,
        subqueryDelayMs: 5,
        synthesisResponse:
          "CURRENT_STATE: the adapter, client, and connector are verified in " +
          "`src/provider/adapter.ts`, `src/provider/client.ts`, and `src/provider/connector.ts`.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: preserve all three bounded evidence receipts.",
      });

      expect(maxConcurrentSubqueries).toBeGreaterThan(1);
      expect(subqueryReads).toEqual(new Map([
        [ADAPTER, 1],
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ADAPTER))
        .toHaveLength(3);
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === CLIENT))
        .toHaveLength(2);
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === CONNECTOR))
        .toHaveLength(2);
      expect(providerCalls.at(-1)?.kind).toBe("synthesis");
      expect(result.response).toContain("CURRENT_STATE");
      expect(result.response).not.toContain("ANALYSIS_INCOMPLETE");
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toEqual(
        expect.arrayContaining([ADAPTER, CLIENT, CONNECTOR]),
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("stops fail-closed when cancellation wins during targeted-range recovery", async () => {
    const rootPath = await makeRoot();
    const abortController = new AbortController();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        abortController,
        signal: abortController.signal,
        plan: fallbackPlan(),
        targetByIntent: TARGET_BY_INTENT,
        toolCallNameByTarget: { [ACCEPTANCE]: "read_file_range" },
        invalidRangeFirstByTarget: { [ACCEPTANCE]: true },
        correctAfterRangeError: true,
        abortAfterRangeCorrection: true,
      });

      expect(subqueryReads).toEqual(new Map([[ACCEPTANCE, 1]]));
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ACCEPTANCE))
        .toHaveLength(2);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(0);
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).not.toContain("PROVEN");
      expect(result.evidenceGraph?.reads ?? []).toHaveLength(0);
      expect(providerCalls.map((call) => call.target)).not.toContain(EVIDENCE);
      expect(providerCalls.map((call) => call.target)).not.toContain(COUNTEREVIDENCE);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("continues independent siblings when one fallback source is missing", async () => {
    const rootPath = await makeRoot();
    await fs.rm(path.join(rootPath, ADAPTER));
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        missingTarget: ADAPTER,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
        synthesisResponse:
          "CURRENT_STATE: client and connector evidence were retained.\n" +
          "GAPS: NOT PROVEN — the provider adapter source could not be read.\n" +
          "PRIORITIES: recover the missing adapter source before asserting completeness.",
      });

      const subqueryTargets = providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target);
      expect([...new Set(subqueryTargets)]).toEqual([ADAPTER, CLIENT, CONNECTOR]);
      expect(subqueryReads).toEqual(new Map([
        [ADAPTER, 1],
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("NOT PROVEN");

      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toContain(CLIENT);
      expect(graphReads).toContain(CONNECTOR);
      expect(graphReads).not.toContain(ADAPTER);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("preserves every compound coverage part through fallback synthesis", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: compoundFallbackPlan(),
        synthesisResponse:
          "CURRENT_STATE: the verified current state is recorded in `src/acceptance/gate.ts`.\n" +
          "GAPS: the remaining evidence gap is recorded in `src/evidence/producer.ts`.\n" +
          "PRIORITIES: prioritize the counterevidence scenarios in `tests/counterevidence.test.ts`.",
      });

      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("CURRENT_STATE");
      expect(result.response).toContain("GAPS");
      expect(result.response).toContain("PRIORITIES");
      expect(result.response).not.toContain("the compound answer could not close every requested part");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("preserves collected subtask evidence when adaptive synthesis is cancelled", async () => {
    const rootPath = await makeRoot();
    const controller = new AbortController();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        signal: controller.signal,
        abortController: controller,
      });

      expect(controller.signal.aborted).toBe(true);
      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toMatch(/ANALYSIS_INCOMPLETE|NOT PROVEN|Verified/);
      expect(result.response).not.toContain("CURRENT_STATE: verified acceptance and evidence reads are available.");
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toEqual(
        expect.arrayContaining([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]),
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("stops wave advancement when cancellation arrives after a completed sub-query", async () => {
    const rootPath = await makeRoot();
    const controller = new AbortController();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        signal: controller.signal,
        abortController: controller,
        abortAfterSubqueryTarget: ACCEPTANCE,
      });

      expect(controller.signal.aborted).toBe(true);
      expect(subqueryReads).toEqual(new Map([[ACCEPTANCE, 1]]));
      expect(providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target)).toEqual([ACCEPTANCE, ACCEPTANCE]);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(0);
      expect(result.response).toMatch(/ANALYSIS_INCOMPLETE|cancelled|NOT PROVEN/i);
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toContain(ACCEPTANCE);
      expect(graphReads).not.toContain(EVIDENCE);
      expect(graphReads).not.toContain(COUNTEREVIDENCE);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("bounds a synthesis provider failure without replaying completed sub-queries", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, strategy, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        synthesisFailure: "throw",
      });

      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "subquery")).toHaveLength(6);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(strategy.call).toHaveBeenCalledTimes(7);
      expect(result.response).toContain("ANALYSIS_INCOMPLETE — synthesis did not complete.");
      expect(result.response).not.toContain("CURRENT_STATE: verified acceptance and evidence reads are available.");
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toEqual(
        expect.arrayContaining([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]),
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects a synthesis tool call and preserves the completed evidence boundary", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, strategy, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        synthesisFailure: "tool_call",
      });

      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(strategy.call).toHaveBeenCalledTimes(7);
      expect(result.response).toContain("ANALYSIS_INCOMPLETE — synthesis returned no usable report.");
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toEqual(
        expect.arrayContaining([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]),
      );
      expect(result.evidenceGraph?.reads.map((read) => read.path)).not.toContain(ADAPTER);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("rejects adaptive synthesis that cites a source outside retained evidence", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, subqueryReads } = await runScenario({
        rootPath,
        synthesisResponse:
          "CURRENT_STATE: FACT — the unverified implementation in `src/unverified.ts` is complete.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: ship the change immediately.",
      });

      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [COUNTEREVIDENCE, 1],
      ]));
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain("citation is not a retained source window");
      expect(result.response).not.toContain("src/unverified.ts");
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toEqual(
        expect.arrayContaining([ACCEPTANCE, EVIDENCE, COUNTEREVIDENCE]),
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps independent siblings running after a provider sub-query fails", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
        providerFailureTarget: ADAPTER,
        synthesisResponse:
          "CURRENT_STATE: client and connector behavior were verified in " +
          "`src/provider/client.ts` and `src/provider/connector.ts`.\n" +
          "GAPS: NOT PROVEN — the provider adapter sub-analysis failed before a source read.\n" +
          "PRIORITIES: retry the adapter analysis before making a complete claim.",
      });

      const subqueryTargets = providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target);
      expect([...new Set(subqueryTargets)]).toEqual([ADAPTER, CLIENT, CONNECTOR]);
      expect(subqueryReads).toEqual(new Map([
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("NOT PROVEN");

      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toContain(CLIENT);
      expect(graphReads).toContain(CONNECTOR);
      expect(graphReads).not.toContain(ADAPTER);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps failed-subquery diagnostics out of synthesis evidence and rejects fact claims about them", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads, strategy } = await runScenario({
        rootPath,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
        providerFailureTarget: ADAPTER,
        synthesisResponse:
          "CURRENT_STATE: FACT — Inspect the provider adapter transport. The adapter is complete.\n" +
          "GAPS: the client and connector were verified in `src/provider/client.ts` " +
          "and `src/provider/connector.ts`.\n" +
          "PRIORITIES: ship the provider integration.",
      });

      expect(subqueryReads).toEqual(new Map([
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);

      const synthesisMessages = strategy.call.mock.calls
        .map(([messages]) => messages)
        .find((messages) => JSON.stringify(messages).includes("You are a synthesis agent."));
      const serializedSynthesis = JSON.stringify(synthesisMessages);
      expect(serializedSynthesis).toContain("(No candidate findings; this receipt is diagnostic only.)");
      expect(serializedSynthesis).not.toContain("simulated provider failure");

      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain("a failed subtask was presented as a fact");
      expect(result.response).not.toContain(ADAPTER);
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toEqual(expect.arrayContaining([CLIENT, CONNECTOR]));
      expect(graphReads).not.toContain(ADAPTER);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("runs an independent second-wave branch while transitively skipping dependent sub-queries", async () => {
    const rootPath = await makeRoot();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await fs.rm(path.join(rootPath, EVIDENCE));
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        missingTarget: EVIDENCE,
        plan: dependencyCascadePlan(),
        targetByIntent: CASCADE_TARGET_BY_INTENT,
        synthesisResponse:
          "CURRENT_STATE: the acceptance gate was retained in `src/acceptance/gate.ts`; " +
          "the deployment notes were also inspected.\n" +
          "GAPS: NOT PROVEN — the evidence producer failed before it could provide a usable source.\n" +
          "PRIORITIES: rerun the evidence and counterevidence checks after recovery.",
      });

      const subqueryTargets = providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target);
      expect([...new Set(subqueryTargets)]).toEqual([ACCEPTANCE, EVIDENCE, GENERAL]);
      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [GENERAL, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("NOT PROVEN");

      const events = info.mock.calls
        .map(([message]) => {
          if (typeof message !== "string") return undefined;
          try {
            return JSON.parse(message) as {
              code?: string;
              taskCount?: number;
              reason?: string;
              intent?: string;
            };
          } catch {
            return undefined;
          }
        })
        .filter((event): event is NonNullable<typeof event> => Boolean(event));
      const skipped = events.filter((event) => event.code === "SUBTASK_SKIPPED");
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.reason).toBe("dependency_not_satisfied");
      expect(skipped[0]?.intent).toContain("counterevidence");
      expect(events.some((event) => event.code === "SCHEDULING_WAVE_STARTED" && event.taskCount === 2)).toBe(true);

      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toEqual(expect.arrayContaining([ACCEPTANCE, GENERAL]));
      expect(graphReads).not.toContain(EVIDENCE);
      expect(graphReads).not.toContain(COUNTEREVIDENCE);
    } finally {
      info.mockRestore();
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not promote a provider-failed sub-query's read attempt into synthesis evidence", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
        providerFailureAfterReadTarget: ADAPTER,
        synthesisResponse:
          "CURRENT_STATE: the adapter is complete in `src/provider/adapter.ts`, " +
          "and the client and connector are complete in `src/provider/client.ts` " +
          "and `src/provider/connector.ts`.\n" +
          "GAPS: none.\n" +
          "PRIORITIES: ship the provider integration.",
      });

      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ADAPTER)).toHaveLength(2);
      expect(subqueryReads).toEqual(new Map([
        [ADAPTER, 1],
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(result.response).toContain("ANALYSIS_INCOMPLETE");
      expect(result.response).toContain("citation is not a retained source window");
      expect(result.response).not.toContain(ADAPTER);

      const adapterClaim = result.evidenceGraph?.nodes.find((node) => node.id === "claim:subquery:0");
      expect(adapterClaim?.status).not.toBe("PROVEN");
      expect(result.evidenceGraph?.nodes.some((node) =>
        node.kind === "VERDICT" && node.status === "PROVEN",
      )).toBe(false);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("isolates a concurrent sibling failure after read while preserving the other siblings", async () => {
    const rootPath = await makeRoot();
    try {
      const {
        result,
        providerCalls,
        subqueryReads,
        maxConcurrentSubqueries,
      } = await runScenario({
        rootPath,
        plan: independentProviderPlan(),
        targetByIntent: INDEPENDENT_TARGET_BY_INTENT,
        subqueryDelayMs: 5,
        providerFailureAfterReadTarget: ADAPTER,
        synthesisResponse:
          "CURRENT_STATE: the client and connector are verified in `src/provider/client.ts` " +
          "and `src/provider/connector.ts`.\n" +
          "GAPS: NOT PROVEN — the provider adapter receipt failed after its read attempt.\n" +
          "PRIORITIES: recover the adapter evidence before making a complete claim.",
      });

      expect(maxConcurrentSubqueries).toBeGreaterThan(1);
      expect(subqueryReads).toEqual(new Map([
        [ADAPTER, 1],
        [CLIENT, 1],
        [CONNECTOR, 1],
      ]));
      expect(providerCalls.filter((call) => call.kind === "subquery" && call.target === ADAPTER))
        .toHaveLength(2);
      expect(providerCalls.filter((call) => call.kind === "synthesis")).toHaveLength(1);
      expect(result.response).toContain("NOT PROVEN");
      expect(result.response).not.toContain(ADAPTER);
      const graphReads = result.evidenceGraph?.reads.map((read) => read.path) ?? [];
      expect(graphReads).toEqual(expect.arrayContaining([CLIENT, CONNECTOR]));
      expect(graphReads).not.toContain(ADAPTER);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps mixed adaptive evidence incomplete when one sibling source remains unproven", async () => {
    const rootPath = await makeRoot();
    try {
      const { result, providerCalls, subqueryReads } = await runScenario({
        rootPath,
        missingTarget: MISSING,
        plan: partialObjectivePlan(),
        targetByIntent: PARTIAL_OBJECTIVE_TARGET_BY_INTENT,
        remapEvidenceTarget: false,
        synthesisResponse:
          "CURRENT_STATE: the evidence producer is verified in `src/evidence/producer.ts`.\n" +
          "GAPS: NOT PROVEN — the supporting implementation source could not be read.\n" +
          "PRIORITIES: recover the missing source before making a complete claim.",
      });

      const subqueryTargets = providerCalls
        .filter((call) => call.kind === "subquery")
        .map((call) => call.target);
      expect([...new Set(subqueryTargets)]).toEqual([ACCEPTANCE, EVIDENCE, MISSING]);
      expect(subqueryReads).toEqual(new Map([
        [ACCEPTANCE, 1],
        [EVIDENCE, 1],
        [MISSING, 1],
      ]));
      expect(result.response).toContain("NOT PROVEN");
      expect(result.response).not.toMatch(/^\s*PROVEN\b/im);
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toContain(EVIDENCE);
      expect(result.evidenceGraph?.reads.map((read) => read.path)).not.toContain(MISSING);
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