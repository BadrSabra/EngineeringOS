/**
 * Phase 0 baseline for the latest PROJECT_QUERY evidence failure.
 *
 * This test protects the chat-agent -> executeToolLoop handoff. The API/chat
 * layer has a required evidence manifest, and the engine must receive the
 * complete objective rather than only its scope policy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import { classifyRequest } from "../prompts/profile-classifier.js";
import { resolveTurnIntent } from "../turn-intent.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";

const originalGroqApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | latest project query evidence handoff",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

const REQUIRED_PATHS = [
  "artifacts/api-server/src/routes/ai/chat.ts",
  "lib/ai-orchestrator/src/turn-intent.ts",
  "lib/ai-orchestrator/src/agents/chat-agent.ts",
] as const;

const OBJECTIVE: ObjectiveContract = {
  objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
  requiredEvidencePaths: [...REQUIRED_PATHS],
  requiredClaims: [
    {
      claimId: "ai-routing",
      text: "resolveTurnIntent",
      requiredEvidencePaths: [
        "artifacts/api-server/src/routes/ai/chat.ts",
        "lib/ai-orchestrator/src/turn-intent.ts",
      ],
    },
    {
      claimId: "ai-tool-loop",
      text: "executeToolLoop",
      requiredEvidencePaths: ["lib/ai-orchestrator/src/agents/chat-agent.ts"],
    },
    {
      claimId: "ai-provider-dispatch",
      text: "chatWithFallback",
      requiredEvidencePaths: ["artifacts/api-server/src/routes/ai/chat.ts"],
    },
  ],
  requiredEvidenceEdges: [],
  scopePolicy: {
    primaryPaths: [
      "artifacts/api-server/src/routes/ai/chat.ts",
      "artifacts/api-server/src/lib/ai-execution-state.ts",
      "artifacts/api-server/src/lib/ai-execution-acceptance.ts",
      "lib/ai-orchestrator/src/turn-intent.ts",
      "lib/ai-orchestrator/src/agents/chat-agent.ts",
    ],
    allowedExpansionPaths: [
      "lib/ai-orchestrator/src",
      "artifacts/api-server/src/routes/ai",
      "artifacts/api-server/src/lib",
    ],
    forbiddenPaths: ["node_modules", "dist", "build"],
  },
};

describe("phase 0 baseline — PROJECT_QUERY objective evidence handoff", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.doUnmock("../tool-execution-engine.js");
    vi.doUnmock("groq-sdk");
    if (originalGroqApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqApiKey;
  });

  it("preserves the objective across the truncated-prefetch handoff", async () => {
    let capturedOptions: Record<string, unknown> | undefined;

    vi.doMock("../tool-execution-engine.js", async () => {
      const actual = await vi.importActual<typeof import("../tool-execution-engine.js")>(
        "../tool-execution-engine.js",
      );
      return {
        ...actual,
        executeToolLoop: vi.fn(async (options: Record<string, unknown>) => {
          capturedOptions = options;
          return {
            kind: "response" as const,
            result: {
              content: JSON.stringify({ response: "baseline", sources: [] }),
              toolCalls: [],
              model: "baseline-model",
              usage: {},
            },
            toolSources: [],
            fileContents: new Map<string, string>(),
          };
        }),
      };
    });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"response":"baseline","sources":[]}' } }],
              model: "baseline-model",
              usage: {},
            }),
          },
        };
      },
    }));

    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-phase0-handoff-"));
    try {
      for (const requiredPath of REQUIRED_PATHS) {
        const absolutePath = path.join(rootPath, requiredPath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(
          absolutePath,
          requiredPath.endsWith("/chat.ts")
            ? "x".repeat(256 * 1024 + 1)
            : `export const fixture = "${requiredPath}";\n`,
          "utf8",
        );
      }

      const message =
        "Explain how the embedded AI agent works by reading " +
        `${REQUIRED_PATHS[0]}, ${REQUIRED_PATHS[1]}, and ${REQUIRED_PATHS[2]}.`;
      const classification = classifyRequest(message);
      const turnIntent = resolveTurnIntent(message, {
        classification,
        resumed: false,
      });

      const { chat } = await import("../agents/chat-agent.js");
      await chat({
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "groq",
        apiKey: "test-key",
        objective: OBJECTIVE,
        turnIntent,
      });

      expect(turnIntent.kind).toBe("PROJECT_QUERY");
      expect(turnIntent.requiresEvidence).toBe(true);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions?.objectiveScopePolicy).toBeDefined();
      expect(capturedOptions?.initialReadStatuses).toEqual(
        new Map([[REQUIRED_PATHS[0], "READ_TRUNCATED"]]),
      );

      expect(capturedOptions?.objective).toMatchObject({
        goal: message,
        requiredEvidencePaths: OBJECTIVE.requiredEvidencePaths,
        requiredClaims: OBJECTIVE.requiredClaims.map((claim) => ({
          claimId: claim.claimId,
          requiredEvidencePaths: claim.requiredEvidencePaths,
        })),
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("does not accept a symbol inventory as an embedded-AI explanation", async () => {
    const completeFileContents = new Map<string, string>([
      [
        REQUIRED_PATHS[0],
        [
          'import { resolveTurnIntent } from "turn-intent";',
          "export async function chatWithFallback() {",
          "  if (true) return resolveTurnIntent;",
          "}",
        ].join("\n"),
      ],
      [
        REQUIRED_PATHS[1],
        [
          "export function resolveTurnIntent(message: string) {",
          "  if (message) return message;",
          "}",
        ].join("\n"),
      ],
      [
        REQUIRED_PATHS[2],
        [
          "export async function executeToolLoop() {",
          "  if (true) return;",
          "}",
        ].join("\n"),
      ],
    ]);

    vi.doMock("../tool-execution-engine.js", async () => {
      const actual = await vi.importActual<typeof import("../tool-execution-engine.js")>(
        "../tool-execution-engine.js",
      );
      return {
        ...actual,
        executeToolLoop: vi.fn(async () => ({
          kind: "response" as const,
          result: {
            content: JSON.stringify({
              response: "The embedded AI uses resolveTurnIntent, executeToolLoop, and chatWithFallback.",
              sources: [],
            }),
            toolCalls: [],
            model: "baseline-model",
            usage: {},
          },
          toolSources: [],
          fileContents: completeFileContents,
          sourceRetrieval: {
            readAttempts: REQUIRED_PATHS.length,
            readPaths: [...REQUIRED_PATHS],
            uniqueReads: REQUIRED_PATHS.length,
            truncatedReads: 0,
            targetedReads: 0,
            redundantReads: 0,
            cachedReads: 0,
            evidenceWindows: REQUIRED_PATHS.length,
            prefetchReads: 0,
            dependencyReads: 0,
            duplicateReads: 0,
            firstEvidenceAcquired: true,
            iterationsUntilFirstRead: 0,
            iterationsWithoutEvidence: 0,
            planningIterations: 0,
            evidenceIterations: REQUIRED_PATHS.length,
            crossFileQueriesBeforeFirstRead: 0,
            prefetchBeforeFirstRead: false,
            iterationsUntilFirstSourceRead: 0,
            progressForced: false,
            budgetAllocation: { planning: 1, evidence: 3, reasoning: 1 },
          },
        })),
      };
    });

    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: '{"response":"baseline","sources":[]}' } }],
              model: "baseline-model",
              usage: {},
            }),
          },
        };
      },
    }));

    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-embedded-materialization-"));
    try {
      const message = "Explain how the embedded AI agent works.";
      const classification = classifyRequest(message);
      const turnIntent = resolveTurnIntent(message, {
        classification,
        resumed: false,
      });
      const steps: Array<Record<string, unknown>> = [];

      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "groq",
        apiKey: "test-key",
        objective: OBJECTIVE,
        turnIntent,
        onStep: (step) => steps.push(step as unknown as Record<string, unknown>),
      });

      // Complete reads and exact symbol mentions are not enough for a
      // PROJECT_QUERY answer. The response must explain the behavioral flow.
      expect(result.response).toMatch(/BLOCKED|محظور/);

      const integrity = [...steps]
        .reverse()
        .find((step) => step.kind === "evidence_integrity");
      expect(integrity).toMatchObject({
        acceptedClaimCount: 3,
        finalAnswerType: "NO_ANSWER",
      });
      expect(integrity?.acceptedEvidenceCount).toBeGreaterThan(0);
      expect(steps.some((step) => step.kind === "forensic_terminal")).toBe(false);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});