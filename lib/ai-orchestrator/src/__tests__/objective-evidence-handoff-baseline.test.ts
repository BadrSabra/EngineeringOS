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
import { buildProjectQueryObjective, resolveProjectQueryTarget } from "../project-query-target.js";
import { resolveTurnIntent } from "../turn-intent.js";
import type { ObjectiveContract } from "../schemas/chat.schema.js";
import type { AnalysisCorrelation } from "../tools/analysis-tools.js";

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
      expect(capturedOptions?.objectiveEvidenceSources).toBeInstanceOf(Map);
      expect(
        [...(capturedOptions?.objectiveEvidenceSources as Map<string, string>).keys()],
      ).toContain(REQUIRED_PATHS[0]);

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

  it("closes the embedded-AI objective when retained evidence and behavioral flow are complete", async () => {
    const completeFileContents = new Map<string, string>([
      [
        REQUIRED_PATHS[0],
        [
          'import { resolveTurnIntent } from "turn-intent";',
          "export async function chatWithFallback(provider: string) {",
          "  const turnIntent = resolveTurnIntent(provider);",
          "  return { provider, turnIntent };",
          "}",
        ].join("\n"),
      ],
      [
        REQUIRED_PATHS[1],
        [
          "export function resolveTurnIntent(message: string) {",
          "  const turnIntent = message ? { kind: 'PROJECT_QUERY' } : { kind: 'CHAT' };",
          "  return turnIntent;",
          "}",
        ].join("\n"),
      ],
      [
        REQUIRED_PATHS[2],
        [
          "export async function executeToolLoop() {",
          "  const loopResult = await readSources();",
          "  return synthesize(loopResult);",
          "}",
        ].join("\n"),
      ],
    ]);
    const response =
      "The chat route uses resolveTurnIntent to resolve the turn intent before selecting the execution path. " +
      "The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis. " +
      "The route dispatches provider requests through chatWithFallback before final response validation. " +
      "First, routing selects the project-query execution path; then the tool loop retains source results; " +
      "finally, provider dispatch sends the retained result through final validation.";

    vi.doMock("../tool-execution-engine.js", async () => {
      const actual = await vi.importActual<typeof import("../tool-execution-engine.js")>(
        "../tool-execution-engine.js",
      );
      return {
        ...actual,
        executeToolLoop: vi.fn(async () => ({
          kind: "response" as const,
          result: {
            content: JSON.stringify({ response, sources: [...REQUIRED_PATHS] }),
            toolCalls: [],
            model: "objective-model",
            usage: {},
          },
          toolSources: [...REQUIRED_PATHS],
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
            prefetchReads: REQUIRED_PATHS.length,
            dependencyReads: 0,
            duplicateReads: 0,
            firstEvidenceAcquired: true,
            iterationsUntilFirstRead: 0,
            iterationsWithoutEvidence: 0,
            planningIterations: 0,
            evidenceIterations: REQUIRED_PATHS.length,
            crossFileQueriesBeforeFirstRead: 0,
            prefetchBeforeFirstRead: true,
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
              choices: [{ message: { content: JSON.stringify({ response, sources: [...REQUIRED_PATHS] }) } }],
              model: "objective-model",
              usage: {},
            }),
          },
        };
      },
    }));

    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-embedded-accepted-"));
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

      const finalIntegrity = [...steps]
        .reverse()
        .find((step) => step.kind === "evidence_integrity");
      const finalDecision = [...steps]
        .reverse()
        .find((step) => step.kind === "decision_trace");
      const materialization = steps.find(
        (step) => step.kind === "diagnostic" && step.code === "PROJECT_QUERY_CLAIM_MATERIALIZATION",
      );
      expect(result.response).toContain("uses resolveTurnIntent");
      expect(result.response).not.toMatch(/BLOCKED|محظور/);
      expect(materialization?.details).toEqual(
        expect.arrayContaining([
          "manifestComplete=true",
          "requiredClaims=3",
          "materializedClaims=3",
          "missingClaims=none",
        ]),
      );

      const integrity = finalIntegrity;
      expect(integrity).toMatchObject({
        acceptedClaimCount: 3,
        completionGateResult: "PROVEN",
        finalAnswerType: "BEHAVIORAL_ANSWER",
      });

      const decision = finalDecision;
      expect(decision).toMatchObject({
        trace: {
          objectiveVerdict: "ANSWER_COMPLETE",
          finalState: "VERIFIED",
        },
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("builds a complete Arabic fallback for the real embedded-AI behavioral contract", async () => {
    const { buildProjectQueryEvidenceSynthesis } = await import("../agents/chat-agent.js");
    const target = resolveProjectQueryTarget("اشرح آلية عمل وكيل الذكاء الاصطناعي داخل المشروع");
    expect(target?.id).toBe("embedded-ai");
    const objective = buildProjectQueryObjective(target!, "اشرح آلية عمل وكيل الذكاء الاصطناعي داخل المشروع");
    const evidence = objective.requiredClaims.map((claim, index) => ({
      claimId: claim.claimId,
      source: claim.requiredEvidencePaths?.[0] ?? "embedded-ai-source.ts",
      excerpt: `${claim.evidenceNeedles?.[0] ?? claim.text}\nsource behavior ${index + 1}`,
      sourceSpan: { startLine: index + 1, endLine: index + 2 },
    }));

    const response = buildProjectQueryEvidenceSynthesis(objective, evidence, "ar");

    for (const claim of objective.requiredClaims) {
      expect(response).toContain(claim.text);
    }
    expect(response.length).toBeGreaterThanOrEqual(240);
    expect(response).toContain("أولاً");
    expect(response).toContain("ثم");
    expect(response).toContain("بعد ذلك");
  });

  it("closes the real embedded-AI objective from materialized evidence when provider synthesis fails", async () => {
    const message = "اشرح آلية عمل وكيل الذكاء الاصطناعي داخل المشروع";
    const target = resolveProjectQueryTarget(message);
    expect(target?.id).toBe("embedded-ai");
    const objective = buildProjectQueryObjective(target!, message);
    const completeFileContents = new Map<string, string>([
      [
        REQUIRED_PATHS[0],
        [
          "import { resolveTurnIntent } from './turn-intent';",
          "export async function chatWithFallback(provider: string) {",
          "  const turnIntent = resolveTurnIntent(provider);",
          "  return { provider, turnIntent };",
          "}",
        ].join("\n"),
      ],
      [
        REQUIRED_PATHS[1],
        [
          "export function resolveTurnIntent(message: string) {",
          "  const turnIntent = message ? { kind: 'PROJECT_QUERY' } : { kind: 'CHAT' };",
          "  return turnIntent;",
          "}",
        ].join("\n"),
      ],
      [
        REQUIRED_PATHS[2],
        [
          "export async function executeToolLoop() {",
          "  const loopResult = await readSources();",
          "  return synthesize(loopResult);",
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
            content: JSON.stringify({ response: "", sources: [] }),
            toolCalls: [],
            model: "provider-failure-model",
            usage: {},
          },
          toolSources: [...REQUIRED_PATHS],
          fileContents: completeFileContents,
          evidenceWindows: [],
          sourceRetrieval: {
            readAttempts: REQUIRED_PATHS.length,
            readPaths: [...REQUIRED_PATHS],
            uniqueReads: REQUIRED_PATHS.length,
            truncatedReads: 0,
            targetedReads: 0,
            redundantReads: 0,
            cachedReads: 0,
            evidenceWindows: 0,
            prefetchReads: REQUIRED_PATHS.length,
            dependencyReads: 0,
            duplicateReads: 0,
            firstEvidenceAcquired: true,
            iterationsUntilFirstRead: 0,
            iterationsWithoutEvidence: 0,
            planningIterations: 0,
            evidenceIterations: REQUIRED_PATHS.length,
            crossFileQueriesBeforeFirstRead: 0,
            prefetchBeforeFirstRead: true,
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
            create: vi.fn().mockRejectedValue(
              Object.assign(new Error("fixture provider failure"), {
                code: "FIXTURE_PROVIDER_FAILURE",
                status: 401,
                response: { status: 401 },
              }),
            ),
          },
        };
      },
    }));

    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-embedded-provider-failure-"));
    try {
      for (const [requiredPath, content] of completeFileContents) {
        const absolutePath = path.join(rootPath, requiredPath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf8");
      }

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
        objective,
        turnIntent,
        onStep: (step) => steps.push(step as unknown as Record<string, unknown>),
      });

      expect(result.response).toContain(objective.requiredClaims[0].text);
      expect(result.response).toContain("أولاً");

      const materialization = steps.find(
        (step) => step.kind === "diagnostic" && step.code === "PROJECT_QUERY_CLAIM_MATERIALIZATION",
      );
      expect(materialization?.details).toEqual(
        expect.arrayContaining([
          "manifestComplete=true",
          "requiredClaims=3",
          "materializedClaims=3",
          "missingClaims=none",
        ]),
      );

      const synthesisDiagnostics = steps.filter(
        (step) => step.kind === "diagnostic" && step.code === "PROJECT_QUERY_NO_TOOLS_SYNTHESIS",
      );
      expect(synthesisDiagnostics.some((step) =>
        (step.details as string[] | undefined)?.some((detail) => detail.includes("provider synthesis failed")),
      )).toBe(true);

      const binding = steps.find(
        (step) => step.kind === "diagnostic" && step.code === "PROJECT_QUERY_RESPONSE_BINDING",
      );
      expect(binding?.details).toEqual(
        expect.arrayContaining([
          "overridePresent=true",
          "responseUsesOverride=true",
          "responseClaims=ai-routing:true,ai-tool-loop:true,ai-provider-dispatch:true",
          "materializedClaims=3",
        ]),
      );

      const closure = steps.find(
        (step) => step.kind === "diagnostic" && step.code === "PROJECT_QUERY_OBJECTIVE_CLOSURE",
      );
      expect(closure?.details).toEqual(
        expect.arrayContaining([
          "closedClaims=ai-routing,ai-tool-loop,ai-provider-dispatch",
          "acceptedEvidenceCount=3",
          "gateStatus=PROVEN",
        ]),
      );

      const integrity = [...steps]
        .reverse()
        .find((step) => step.kind === "evidence_integrity");
      expect(integrity).toMatchObject({
        // Two claims use chat.ts; the ledger count is accepted evidence
        // records after the source-read projection, not the claim count.
        acceptedEvidenceCount: 2,
        acceptedClaimCount: 3,
        completionGateResult: "PROVEN",
        finalAnswerType: "BEHAVIORAL_ANSWER",
        missingClaims: [],
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("keeps an Arabic embedded-AI run incomplete when the provider emits no usable evidence action", async () => {
    const message = "اشرح آلية عمل وكيل الذكاء الاصطناعي داخل المشروع";
    const target = resolveProjectQueryTarget(message);
    expect(target?.id).toBe("embedded-ai");
    const objective = buildProjectQueryObjective(target!, message);
    const correlation: AnalysisCorrelation = {
      operationId: "operation-arabic-embedded-ai",
      projectId: "project-arabic-embedded-ai",
      projectRevision: "revision-arabic-embedded-ai",
      rootAvailable: true,
      evidenceProvenance: "project-analysis",
    };
    let capturedCorrelation: AnalysisCorrelation | undefined;

    vi.doMock("../tool-execution-engine.js", async () => {
      const actual = await vi.importActual<typeof import("../tool-execution-engine.js")>(
        "../tool-execution-engine.js",
      );
      const executeToolLoop = vi.fn(async (...args: Parameters<typeof actual.executeToolLoop>) => {
        capturedCorrelation = args[0].analysisCorrelation;
        return actual.executeToolLoop(...args);
      });
      return { ...actual, executeToolLoop };
    });
    vi.doMock("groq-sdk", () => ({
      default: class {
        chat = {
          completions: {
            create: vi.fn().mockResolvedValue({
              // This fixture deliberately emits a response without a usable
              // read action. It must not be treated as evidence, especially
              // not as a server-generated 1..200 head window.
              choices: [{
                message: {
                  content: JSON.stringify({
                    response: "لا أستطيع إكمال التحليل من دون أدلة مصدر قابلة للتحقق.",
                    sources: [],
                  }),
                },
              }],
              model: "arabic-objective-model",
              usage: {},
            }),
          },
        };
      },
    }));

    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-embedded-arabic-incomplete-"));
    try {
      const requiredEvidencePaths = objective.requiredEvidencePaths ?? [];
      for (const requiredPath of requiredEvidencePaths) {
        const absolutePath = path.join(rootPath, requiredPath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(
          absolutePath,
          Array.from({ length: 240 }, (_, index) => `export const fixtureLine${index + 1} = ${index + 1};`).join("\n"),
          "utf8",
        );
      }

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
        objective,
        turnIntent,
        analysisCorrelation: correlation,
        onStep: (step) => steps.push(step as unknown as Record<string, unknown>),
      });

      expect(result.response).toMatch(/ANALYSIS_INCOMPLETE|محظور/);
      expect(result.response).toMatch(/لم تكتمل|غير مكتملة/);
      expect(steps.some((step) =>
        step.kind === "tool_call" &&
        step.tool === "read_file_range" &&
        step.args &&
        (step.args as Record<string, string>).startLine === "1" &&
        (step.args as Record<string, string>).endLine === "200",
      )).toBe(false);

      const integrity = [...steps]
        .reverse()
        .find((step) => step.kind === "evidence_integrity");
      expect(integrity).toMatchObject({
        objectiveType: "PROJECT_QUERY_EMBEDDED-AI",
        acceptedEvidenceCount: 0,
        acceptedClaimCount: 0,
        completionGateResult: expect.not.stringMatching(/^PROVEN$/),
        finalAnswerType: "NO_ANSWER",
        missingClaims: expect.arrayContaining(objective.requiredClaims.map((claim) => claim.claimId)),
      });

      const decision = [...steps]
        .reverse()
        .find((step) => step.kind === "decision_trace");
      expect(decision).toMatchObject({
        trace: {
          finalState: expect.not.stringMatching(/^VERIFIED$/),
          objectiveVerdict: expect.not.stringMatching(/^ANSWER_COMPLETE$/),
        },
      });
      expect(capturedCorrelation).toEqual(correlation);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
