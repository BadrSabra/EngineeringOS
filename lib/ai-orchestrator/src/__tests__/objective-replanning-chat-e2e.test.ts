import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import type { ExecutionLedger } from "../execution-ledger.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

const originalApiKey = process.env.GROQ_API_KEY;

const PRIMARY = "src/primary.ts";
const SECONDARY = "src/secondary.ts";
const TERTIARY = "src/tertiary.ts";
const FOURTH = "src/fourth.ts";
const DECLARED_PATHS = [PRIMARY, SECONDARY, TERTIARY, FOURTH];

function makeContext(): ProjectContext {
  return {
    project: "test | objective replan chat e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

async function makeRoot(
  contentByPath: Readonly<Record<string, string>> = {},
): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-objective-replan-"));
  for (const [index, file] of DECLARED_PATHS.entries()) {
    const fullPath = path.join(rootPath, file);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(
      fullPath,
      contentByPath[file] ?? `export const VALUE_${index + 1} = ${index + 1};\n`,
      "utf8",
    );
  }
  return rootPath;
}

function objective(): ObjectiveContract {
  return {
    objectiveType: "PRODUCTION_REACHABILITY",
    goal: "Retain the declared source files before final validation.",
    requiredEvidencePaths: DECLARED_PATHS,
    requiredClaims: [
      {
        claimId: "secondary-source",
        text: "The secondary source is retained as objective evidence.",
        requiredEvidencePaths: [SECONDARY],
      },
    ],
    requiredEvidenceEdges: [],
  };
}

describe("chat() closed-loop objective replanning", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("replans only two declared paths and reuses one execution identity", async () => {
    const rootPath = await makeRoot();
    const createdLedgers: ExecutionLedger[] = [];
    const replanTargetsRead = new Set<string>();
    let replanDerivationCalls = 0;

    vi.resetModules();
    vi.doUnmock("../tools/file-tools.js");
    vi.doUnmock("../tools/git-tools.js");
    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../agents/query-planner.js", () => ({
      planQuery: vi.fn().mockResolvedValue(null),
    }));
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
        model: "initial-model",
        powerModel: "initial-model",
        fallbackChain: ["initial-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      resolveFallbackChain: vi.fn(() => [{ id: "initial-model" }]),
    }));
    vi.doMock("../objective-replanning.js", async () => {
      const actual = await vi.importActual<typeof import("../objective-replanning.js")>(
        "../objective-replanning.js",
      );
      return {
        ...actual,
        deriveObjectiveReplanTargets: vi.fn(() => {
          const path = DECLARED_PATHS[replanDerivationCalls + 1];
          replanDerivationCalls += 1;
          return path
            ? [{
                path,
                claimIds: [],
                edgeKeys: [],
                reason: "MISSING_REQUIRED_EVIDENCE_PATH" as const,
              }]
            : [];
        }),
      };
    });
    vi.doMock("../execution-ledger.js", async () => {
      const actual = await vi.importActual<typeof import("../execution-ledger.js")>(
        "../execution-ledger.js",
      );
      return {
        ...actual,
        createExecutionLedger: vi.fn((options) => {
          const ledger = actual.createExecutionLedger(options);
          createdLedgers.push(ledger);
          return ledger;
        }),
      };
    });

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (messages: unknown) => {
        const serialized = JSON.stringify(messages);
        const replanMarker = "Read only the server-declared target path: ";
        const markerIndex = serialized.lastIndexOf(replanMarker);
        const target =
          serialized.includes("Run one bounded objective-evidence replan.") &&
          markerIndex >= 0
            ? DECLARED_PATHS.find((candidate) =>
                serialized.startsWith(candidate, markerIndex + replanMarker.length),
              )
            : undefined;
        if (target) {
          if (!replanTargetsRead.has(target)) {
            replanTargetsRead.add(target);
            return {
              content: "",
              toolCalls: [
                {
                  id: `replan-${target}`,
                  type: "function" as const,
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({ path: target }),
                  },
                },
              ],
              model: "initial-model",
              usage: {},
            };
          }
        }
        return {
          content: JSON.stringify({
            response:
              "## 1) Executive Verdict\n" +
              "The declared evidence read is available.\n" +
              "## 2) Evidence Map\n" +
              `File: \`${PRIMARY}\`\n` +
              "## 3) Findings\nNo additional finding was asserted.\n" +
              "## 6) Final Judgment\nNOT PROVEN",
            sources: [PRIMARY],
          }),
          toolCalls: [],
          model: "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: AgentStep[] = [];
      const result = await chat({
        message: [
          "Single-file forensic capability test — production file:",
          PRIMARY,
          "Retain the declared evidence and explain the source behavior.",
        ].join("\n"),
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective: objective(),
        onStep: (step) => steps.push(step),
      });

      const replanDiagnostics = steps.filter(
        (step) => step.kind === "diagnostic" && step.code === "OBJECTIVE_REPLAN",
      );
      expect(replanDiagnostics).toHaveLength(2);
      expect(replanTargetsRead).toEqual(new Set([SECONDARY, TERTIARY]));
      expect(replanTargetsRead.has(FOURTH)).toBe(false);

      const readPaths = steps
        .filter((step): step is Extract<AgentStep, { kind: "tool_result" }> =>
          step.kind === "tool_result" && typeof step.source === "string",
        )
        .map((step) => step.source as string)
        .filter((source, index, all) => all.indexOf(source) === index);
      expect(readPaths.sort()).toEqual(DECLARED_PATHS.sort());

      expect(createdLedgers).toHaveLength(1);
      const executionIds = new Set(createdLedgers.map((ledger) => ledger.id));
      expect(executionIds.size).toBe(1);
      const ledger = createdLedgers[0];
      expect(ledger?.snapshot().counts.hierarchical_task).toBe(2);
      expect(
        ledger?.snapshot().events.filter(
          (event) =>
            event.kind === "hierarchical_task" &&
            event.operation === "objective_replan" &&
            event.status === "completed",
        ),
      ).toHaveLength(2);
      expect(result.response).toBeTypeOf("string");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("closes a missing claim only after bounded objective recovery retains its proof", async () => {
    const claimText = "The secondary source is retained as objective evidence.";
    const rootPath = await makeRoot({
      [SECONDARY]: [
        "export const VALUE_2 = 2;",
        claimText,
      ].join("\n"),
    });
    const createdLedgers: ExecutionLedger[] = [];
    let replanDerivationCalls = 0;
    let recoveryReads = 0;

    vi.resetModules();
    vi.doUnmock("../tools/file-tools.js");
    vi.doUnmock("../tools/git-tools.js");
    vi.doMock("../provider-registry.js", async () => {
      const actual = await vi.importActual<Record<string, unknown>>("../provider-registry.js");
      return { ...actual, getStrategy: vi.fn(() => fakeStrategy) };
    });
    vi.doMock("../agents/query-planner.js", () => ({
      // The planner failure is represented by the normal server-owned fallback
      // path. The proof loop must recover from the objective manifest, not ask
      // the planner for a second unconstrained plan.
      planQuery: vi.fn().mockResolvedValue(null),
    }));
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
        model: "initial-model",
        powerModel: "initial-model",
        fallbackChain: ["initial-model"],
      })),
    }));
    vi.doMock("../openrouter/model-resolver.js", () => ({
      resolveFallbackChain: vi.fn(() => [{ id: "initial-model" }]),
    }));
    vi.doMock("../objective-replanning.js", async () => {
      const actual = await vi.importActual<typeof import("../objective-replanning.js")>(
        "../objective-replanning.js",
      );
      return {
        ...actual,
        deriveObjectiveReplanTargets: vi.fn(() => {
          replanDerivationCalls += 1;
          return replanDerivationCalls === 1
            ? [{
                path: SECONDARY,
                claimIds: ["secondary-source"],
                edgeKeys: [],
                reason: "MISSING_REQUIRED_EVIDENCE_PATH" as const,
              }]
            : [];
        }),
      };
    });
    vi.doMock("../execution-ledger.js", async () => {
      const actual = await vi.importActual<typeof import("../execution-ledger.js")>(
        "../execution-ledger.js",
      );
      return {
        ...actual,
        createExecutionLedger: vi.fn((options) => {
          const ledger = actual.createExecutionLedger(options);
          createdLedgers.push(ledger);
          return ledger;
        }),
      };
    });

    const proofResponse =
      "## 1) Executive Verdict\n" +
      "The objective is proven.\n" +
      "## 2) Evidence Map\n" +
      `File: \`${SECONDARY}\`\n` +
      `Evidence: \`${claimText}\`\n` +
      "## 3) Findings\nNo additional finding was asserted.\n" +
      "## 4) Repair Plan\nNo repair is proposed.\n" +
      "## 5) Validation Checklist\n- Confirm the retained secondary source.\n" +
      "## 6) Final Judgment\nPROVEN — the required objective claim is complete.";
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (messages: unknown[]) => {
        const serialized = JSON.stringify(messages);
        const replanMarker = "Run one bounded objective-evidence replan.";
        const replanIndex = serialized.indexOf(replanMarker);
        const isReplan = replanIndex >= 0;
        const hasReplanToolOutput = isReplan &&
          serialized.slice(replanIndex).includes('"role":"tool"');
        if (isReplan && !hasReplanToolOutput) {
          recoveryReads += 1;
          return {
            content: "",
            toolCalls: [{
              id: `recovery-${recoveryReads}`,
              type: "function" as const,
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: SECONDARY }),
              },
            }],
            model: "initial-model",
            usage: {},
          };
        }
        if (isReplan && hasReplanToolOutput) {
          return {
            content: `Recovered and retained ${SECONDARY}.`,
            toolCalls: [],
            model: "initial-model",
            usage: {},
          };
        }
        return {
          content: JSON.stringify({
            response: proofResponse,
            sources: [SECONDARY],
          }),
          toolCalls: [],
          model: "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    try {
      const { chat } = await import("../agents/chat-agent.js");
      const steps: AgentStep[] = [];
      const result = await chat({
        message: "Explain how the secondary source is retained.",
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        objective: {
          objectiveType: "PROJECT_QUERY_BEHAVIOR",
          goal: "Explain how the secondary source is retained from source evidence.",
          requiredEvidencePaths: [PRIMARY, SECONDARY],
          requiredClaims: [{
            claimId: "secondary-source",
            text: claimText,
            requiredEvidencePaths: [SECONDARY],
            evidenceNeedlesByPath: {
              [SECONDARY]: [claimText],
            },
          }],
          requiredEvidenceEdges: [],
        },
        onStep: (step) => steps.push(step),
      });

      const replanDiagnostics = steps.filter(
        (step) => step.kind === "diagnostic" && step.code === "OBJECTIVE_REPLAN",
      );
      expect(replanDiagnostics.length).toBeGreaterThan(0);
      expect(recoveryReads).toBe(1);
      expect(replanDerivationCalls).toBe(2);
      expect(result.evidenceGraph?.reads.map((read) => read.path)).toContain(SECONDARY);
      expect(result.evidenceGraph?.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "claim:secondary-source",
            status: "PROVEN",
          }),
        ]),
      );
      expect(result.response).toMatch(/Final Judgment\s*\n\s*PROVEN\b/i);
      expect(result.response).not.toContain("OBJECTIVE_BLOCKED");
      expect(result.response).not.toContain("NOT PROVEN");
      expect(createdLedgers).toHaveLength(1);
      expect(createdLedgers[0]?.snapshot().counts.hierarchical_task).toBe(1);
      expect(
        createdLedgers[0]?.snapshot().events.filter(
          (event) =>
            event.kind === "hierarchical_task" &&
            event.operation === "objective_replan" &&
            event.status === "completed",
        ),
      ).toHaveLength(1);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});