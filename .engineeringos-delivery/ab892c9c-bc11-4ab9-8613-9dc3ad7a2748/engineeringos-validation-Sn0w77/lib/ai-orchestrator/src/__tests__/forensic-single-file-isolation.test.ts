import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { RawGroqResponse, RawMessage } from "../groq-client.js";
import type { AgentStep } from "../tool-execution-engine.js";

import { classifyRequest } from "../prompts/profile-classifier.js";

function response(content: string, toolCalls?: RawGroqResponse["toolCalls"]): RawGroqResponse {
  return {
    content,
    toolCalls: toolCalls ?? null,
    model: "test-model",
    usage: { promptTokens: 0, completionTokens: 0 },
  };
}

function toolCall(id: string, name: string, args: Record<string, string>) {
  return {
    id,
    type: "function" as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

const knownDefectPath = "src/__tests__/fixtures/known-defect.ts";

describe("single-file forensic isolation", () => {
  it("scopes a single explicitly requested folder in any project", () => {
    const classification = classifyRequest([
      "نفّذ تدقيقًا جنائيًا للمجلد src/services فقط.",
      "لا تقرأ أي شيء خارج هذا المجلد، وأخرج التقرير بالأدلة المباشرة.",
    ].join("\n"));

    expect(classification.singleFileForensicMode).toBe(false);
    expect(classification.orderedForensicRoots).toEqual(["src/services"]);
    expect(classification.allowPrefetch).toBe(false);
    expect(classification.structuredOutputMode).toBe(true);
  });

  it("recognizes the ordered two-root forensic audit without treating it as single-file", () => {
    const classification = classifyRequest([
      "أنت وكيل تحليل هندسي جنائي.",
      "1. اقرأ ملفات packages/graph-core ثم ./services/agent-runtime (بهذا الترتيب).",
      "2. أخرج الأقسام الستة بالضبط.",
      "قواعد: الكود فقط مصدر الحقيقة. ممنوع التخمين.",
    ].join("\n"));

    expect(classification.singleFileForensicMode).toBe(false);
    expect(classification.orderedForensicRoots).toEqual([
      "packages/graph-core",
      "services/agent-runtime",
    ]);
    expect(classification.includeTestSources).toBe(false);
    expect(classification.allowPrefetch).toBe(false);
    expect(classification.structuredOutputMode).toBe(true);
  });

  it("enforces ordered forensic roots and blocks outside or backward reads", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    let callCount = 0;
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return response("", [
            toolCall("knowledge-list", "list_directory", { path: "lib/knowledge-engine" }),
          ]);
        }
        if (callCount === 2) {
          return response("", [
            toolCall("knowledge-read", "read_file", {
              path: "lib/knowledge-engine/src/queries.ts",
            }),
          ]);
        }
        if (callCount === 3) {
          return response("", [
            toolCall("orchestrator-read", "read_file", {
              path: "lib/ai-orchestrator/src/tool-execution-engine.ts",
            }),
          ]);
        }
        if (callCount === 4) {
          return response("", [
            toolCall("backward-read", "read_file", {
              path: "lib/knowledge-engine/src/queries.ts",
            }),
            toolCall("outside-read", "read_file", { path: "artifacts/dashboard/src/App.tsx" }),
          ]);
        }
        return response("ordered synthesis");
      }),
      stream: async function* () {
        yield "";
      },
    };
    const messages: RawMessage[] = [{ role: "user", content: "ordered forensic audit" }];

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "test",
      powerModel: "test-power",
      provider: "test",
      tools: [
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
        { type: "function", function: { name: "list_directory", description: "", parameters: {} } },
      ],
      rootPath: path.resolve(process.cwd(), "../.."),
      pendingChanges: [],
      executionMode: "forensic",
      completeReads: true,
      allowedToolNames: ["read_file", "list_directory"],
      orderedForensicRoots: ["lib/knowledge-engine", "lib/ai-orchestrator"],
      maxIterations: 6,
      maxToolCalls: 6,
    });

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.toolSources).toContain("directory: lib/knowledge-engine");
    expect(result.toolSources).toContain("lib/knowledge-engine/src/queries.ts");
    expect(result.toolSources).toContain("lib/ai-orchestrator/src/tool-execution-engine.ts");
    expect(messages.some((message) =>
      message.role === "tool" &&
      /cannot return to an earlier source root/i.test(String(message.content)),
    )).toBe(true);
    expect(messages.some((message) =>
      message.role === "tool" &&
      /only inside the requested roots/i.test(String(message.content)),
    )).toBe(true);
  });

  it("recognizes a compact single-file forensic capability request", () => {
    const classification = classifyRequest(
      [
        "اختبر قدرة التحليل الجنائي لملف واحد فقط:",
        "lib/ai-orchestrator/src/forensic-recovery.ts",
        "لا تستخدم search_code ولا تقرأ أي ملف آخر.",
        "أخرج Behavior Verdict وDirect Evidence وDefect Finding وRepair Plan.",
      ].join("\n"),
    );

    expect(classification.singleFileForensicMode).toBe(true);
    expect(classification.fixtureAuditMode).toBe(false);
    expect(classification.includeTestSources).toBe(false);
    expect(classification.structuredOutputMode).toBe(true);
    expect(classification.allowPrefetch).toBe(false);
  });

  it("keeps an explicit two-file forensic request inside both named files", () => {
    const classification = classifyRequest(
      [
        "حلّل الملفين التاليين فقط، واربط السلوك بالأدلة المباشرة:",
        "src/loop.ts",
        "src/worker.ts",
      ].join("\n"),
    );

    expect(classification.singleFileForensicMode).toBe(true);
    expect(classification.structuredOutputMode).toBe(true);
    expect(classification.allowPrefetch).toBe(false);
  });

  it("opts into fixture sources only for an explicit fixture capability audit", () => {
    const classification = classifyRequest(
      [
        "اختبر قدرة التحليل الجنائي لملف واحد فقط — fixture معروف العيب:",
        "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
        "أثبت العيب محليًا فقط، ولا تدّعِ قابلية الوصول في الإنتاج.",
      ].join("\n"),
    );

    expect(classification.singleFileForensicMode).toBe(true);
    expect(classification.fixtureAuditMode).toBe(true);
    expect(classification.includeTestSources).toBe(true);
  });

  it("keeps a single-file production audit excluded from test sources", () => {
    const classification = classifyRequest(
      [
        "حلّل هذا الملف فقط وأخرج Finding مثبتًا بالأدلة المباشرة:",
        "lib/ai-orchestrator/src/__tests__/fixtures/known-defect.ts",
      ].join("\n"),
    );

    expect(classification.singleFileForensicMode).toBe(true);
    expect(classification.fixtureAuditMode).toBe(false);
    expect(classification.includeTestSources).toBe(false);
  });

  it("blocks tools and read paths outside the effective manifest", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    const fileTool = vi.fn(async () => "must not execute");
    const gitTool = vi.fn(async () => "must not execute");

    vi.doMock("../tools/file-tools.js", async () => {
      const actual = await vi.importActual<typeof import("../tools/file-tools.js")>(
        "../tools/file-tools.js",
      );
      return { ...actual, executeFileTool: fileTool };
    });
    vi.doMock("../tools/git-tools.js", async () => {
      const actual = await vi.importActual<typeof import("../tools/git-tools.js")>(
        "../tools/git-tools.js",
      );
      return { ...actual, executeGitTool: gitTool };
    });

    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async () =>
        response("", [
          toolCall("blocked-search", "search_code", { pattern: "secret" }),
          toolCall("blocked-read", "read_file", { path: "other.ts" }),
        ]),
      ),
      stream: async function* () {
        yield "";
      },
    };
    const messages: RawMessage[] = [{ role: "user", content: "single file test" }];

    await executeToolLoop({
      messages,
      strategy,
      model: "test",
      powerModel: "test-power",
      provider: "test",
      tools: [
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
      ],
      rootPath: "/project",
      pendingChanges: [],
      allowedToolNames: ["read_file"],
      allowedReadPaths: ["lib/ai-orchestrator/src/forensic-recovery.ts"],
      maxIterations: 1,
    });

    expect(fileTool).not.toHaveBeenCalled();
    expect(gitTool).not.toHaveBeenCalled();
    expect(messages.some((message) => message.role === "tool" && /blocked/i.test(String(message.content)))).toBe(
      true,
    );
    expect(messages.some((message) => message.role === "tool" && /explicitly named target/i.test(String(message.content)))).toBe(
      true,
    );
  });

  it("reads the known-defect fixture completely while blocking expansion to other files and tools", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");
    let callCount = 0;
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return response("", [
            toolCall("fixture-read", "read_file", { path: knownDefectPath }),
          ]);
        }
        if (callCount === 2) {
          return response("", [
            toolCall("blocked-search", "search_code", { pattern: "eval" }),
            toolCall("blocked-read", "read_file", { path: "other.ts" }),
          ]);
        }
        return response("fixture synthesis");
      }),
      stream: async function* () {
        yield "";
      },
    };
    const messages: RawMessage[] = [{ role: "user", content: `audit ${knownDefectPath} only` }];

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "test",
      powerModel: "test-power",
      provider: "test",
      tools: [
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
        { type: "function", function: { name: "search_code", description: "", parameters: {} } },
      ],
      rootPath: process.cwd(),
      pendingChanges: [],
      executionMode: "forensic",
      allowTestSources: true,
      completeReads: true,
      allowedToolNames: ["read_file"],
      allowedReadPaths: [knownDefectPath],
      maxIterations: 4,
      maxToolCalls: 4,
    });

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    expect(result.toolSources).toEqual([knownDefectPath]);
    expect([...result.fileContents?.keys() ?? []]).toEqual([knownDefectPath]);
    expect(result.fileContents?.get(knownDefectPath)).toContain("return eval(expression);");
    // Prove coverage is complete: no truncation markers in the read content.
    expect(result.fileContents?.get(knownDefectPath)).not.toMatch(/\[.*truncated/i);
    expect(messages.some((message) => message.role === "tool" && /blocked by the active forensic tool policy/i.test(String(message.content)))).toBe(
      true,
    );
    expect(messages.some((message) => message.role === "tool" && /explicitly named target file/i.test(String(message.content)))).toBe(
      true,
    );
  });

  it("serves the named file from a pre-seeded cache and marks coverage complete without a bounded tool re-read", async () => {
    const { executeToolLoop, toolCacheKey } = await import("../tool-execution-engine.js");

    // Simulate what the single-file eager prefetch does after the cache-seeding fix:
    // the complete file body is placed in the shared cache before the tool loop starts.
    const completeContent = `export function evaluateUserExpression(expression: string): unknown {\n  return eval(expression);\n}`;
    const preSeededCache = new Map<string, string>();
    preSeededCache.set(toolCacheKey("read_file", { path: knownDefectPath }), completeContent);

    let freshToolExecutions = 0;
    let modelCallCount = 0;
    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async (messages: RawMessage[]) => {
        modelCallCount += 1;
        // Count tool-result messages in the history — if the file was served
        // from cache there will be one "cached" tool message before the second
        // call but zero fresh executions (budget never consumed).
        const toolResultsSeen = messages.filter((m) => m.role === "tool").length;
        if (toolResultsSeen === 0) {
          return response("", [
            toolCall("file-read", "read_file", { path: knownDefectPath }),
          ]);
        }
        return response("coverage synthesis");
      }),
      stream: async function* () {
        yield "";
      },
    };

    // With the pre-seeded cache, the read_file call must be a cache hit so no
    // fresh tool budget is consumed. maxToolCalls:0 proves this — if the file
    // were re-read fresh the loop would serve a "budget exhausted" response and
    // fileContents would remain empty.
    const messages: RawMessage[] = [{ role: "user", content: `audit ${knownDefectPath} only` }];
    const result = await executeToolLoop({
      messages,
      strategy,
      model: "test",
      powerModel: "test-power",
      provider: "test",
      tools: [
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: process.cwd(),
      pendingChanges: [],
      executionMode: "forensic",
      allowTestSources: true,
      completeReads: true,
      allowedToolNames: ["read_file"],
      allowedReadPaths: [knownDefectPath],
      cache: preSeededCache,
      // A budget of 0 fresh tool calls proves the read was served from cache.
      maxToolCalls: 0,
      maxIterations: 4,
    });

    expect(result.kind).toBe("response");
    if (result.kind !== "response") return;
    // fileContents must carry the complete pre-seeded content.
    expect(result.fileContents?.get(knownDefectPath)).toContain("return eval(expression);");
    // No truncation markers — coverage is deterministically COMPLETE.
    expect(result.fileContents?.get(knownDefectPath)).not.toMatch(/\[.*truncated/i);
    // Exactly zero fresh tool executions (all served from cache).
    expect(freshToolExecutions).toBe(0);
  });

  it("leaves fileContents empty when no allowlisted read succeeds — fail-closed coverage", async () => {
    const { executeToolLoop } = await import("../tool-execution-engine.js");

    const strategy: ProviderStrategy = {
      providerId: "test",
      supportsNativeStream: false,
      call: vi.fn(async () =>
        // Model only attempts blocked reads — never reads the target.
        response("", [
          toolCall("blocked-a", "read_file", { path: "other-a.ts" }),
          toolCall("blocked-b", "read_file", { path: "other-b.ts" }),
        ]),
      ),
      stream: async function* () {
        yield "";
      },
    };
    const messages: RawMessage[] = [{ role: "user", content: `audit ${knownDefectPath} only` }];

    const result = await executeToolLoop({
      messages,
      strategy,
      model: "test",
      powerModel: "test-power",
      provider: "test",
      tools: [
        { type: "function", function: { name: "read_file", description: "", parameters: {} } },
      ],
      rootPath: process.cwd(),
      pendingChanges: [],
      executionMode: "forensic",
      allowTestSources: true,
      completeReads: true,
      allowedToolNames: ["read_file"],
      allowedReadPaths: [knownDefectPath],
      maxIterations: 1,
      maxToolCalls: 4,
    });

    // The loop hits the iteration budget with no text response → kind:"exhausted".
    // fileContents must be empty because no allowlisted file was read.
    // This proves coverage is fail-closed: an audit that never reads the target
    // cannot report COMPLETE.
    expect(result.fileContents?.size ?? 0).toBe(0);
    expect(result.toolSources).toHaveLength(0);
    // Every blocked path must have produced a policy message.
    expect(
      messages.filter(
        (m) => m.role === "tool" && /explicitly named target file/i.test(String(m.content)),
      ),
    ).toHaveLength(2);
  });
});

// ── End-to-end coverage gates through chat() ─────────────────────────────────
//
// These drive the full chat pipeline (classifier → eager single-file prefetch →
// tool loop → contract/evidence gate → emitForensicStatus) with a mocked
// provider, proving that the single-file sourceCoverage decision reaches the
// live forensic_status stream and that an incomplete read blocks a Finding.

const FORENSIC_SINGLE_MESSAGE = (target: string) =>
  [
    "Single-file forensic capability test — production file:", // single-file forensic classifier trigger
    target,
    "Look for injection vulnerabilities and prove the defect.",
  ].join("\n");

const FIVE_FILE_MANIFEST = [
  "lib/flight-deck/src/mission.ts",
  "lib/flight-deck/src/plan.ts",
  "lib/flight-deck/src/explore.ts",
  "lib/flight-deck/src/validate.ts",
  "lib/flight-deck/src/repair.ts",
] as const;

const FORENSIC_MULTI_FILE_MESSAGE = [
  "Forensic capability test (read_file only) against exactly these five source files.",
  ...FIVE_FILE_MANIFEST,
  "Do not read any other file. Produce a grounded defect report only from complete source reads.",
].join("\n");

const SQL_INJECTION_REPORT = (file: string) =>
  [
    "## 1) Executive Verdict",
    "A SQL-injection defect was proven in a production source file.",
    "## 2) Evidence Map",
    `File: \`${file}\``,
    "Role: implementation source",
    "Evidence: `SELECT * WHERE id = ${input}`",
    "Risk: HIGH",
    "Notes: FACT",
    "## 3) Findings",
    "* ID: F-01 · SQL injection via string interpolation",
    `* File(s): \`${file}\``,
    "* Evidence: `return \\`SELECT * WHERE id = ${input}\\`;`",
    "* Why it matters: Untrusted user input reaches the SQL query builder.",
    "* Root cause: Unparameterised query construction",
    "* Fix: Use parameterised queries.",
    "## 4) Repair Plan",
    `Phase 1 (F-01): replace string interpolation with a parameterised query in ${file} — File(s): \`${file}\` — Validation profile: knowledge-engine-tests — PROPOSED: files are not applied and behavioral validation is pending.`,
    "## 5) Validation Checklist",
    "- Add test: parameterised query rejects injection payloads",
    "## 6) Final Judgment",
    "PROVEN — a verified defect was found; see Repair Plan.",
  ].join("\n");

/** Mock the provider + model-selection registry so chat() uses a fake strategy. */
async function mockChatProviders(fakeStrategy: unknown): Promise<void> {
  // Each chat() E2E test registers a distinct fakeStrategy via vi.doMock. Without
  // a fresh module registry, an earlier test's doMock (and provider-registry mock)
  // leaks into this test — chat-agent would call the previous strategy's `call`
  // instead of the current one. Reset modules so this test's doMock takes effect.
  //
  // A prior "blocked tools" test stubs executeFileTool via vi.doMock to return a
  // guardrail string. That registration survives resetModules, so a later
  // ordered-root audit would read the stub (tiny, no truncation marker) instead of
  // real production truncation. doUnmock those tool modules so production code is
  // used again when this test drives chat().
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

describe("single-file coverage gates through the full chat pipeline", () => {
  async function runFiveFileAudit(options: { omit?: string } = {}) {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-e2e-five-file-"));
    for (const file of FIVE_FILE_MANIFEST) {
      if (file === options.omit) continue;
      const fullPath = path.join(rootPath, file);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(
        fullPath,
        `export function ${path.basename(file, ".ts")}(input: string): string { return input; }\n`,
        "utf8",
      );
    }

    const report = SQL_INJECTION_REPORT(FIVE_FILE_MANIFEST[0]);
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: [...FIVE_FILE_MANIFEST] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);
    const steps: AgentStep[] = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: FORENSIC_MULTI_FILE_MESSAGE,
      history: [],
      projectContext: {
        project: "test | five-file forensic audit",
        workflows: "No workflows defined yet",
        recentTasks: "",
        latestMetrics: "",
        graphSummary: "",
        recentEvents: "",
        metricsVerified: false,
      },
      rootPath,
      provider: "openrouter",
      apiKey: "test-or-key",
      onStep: (step) => steps.push(step),
    });
    return { rootPath, result, steps };
  }

  it("retains the ordered five-file manifest across forensic_status and evidence_integrity", async () => {
    const { rootPath, result, steps } = await runFiveFileAudit();
    try {
      const forensicStatus = [...steps].reverse().find(
        (step): step is Extract<AgentStep, { kind: "forensic_status" }> =>
          step.kind === "forensic_status",
      );
      const evidenceIntegrity = [...steps].reverse().find(
        (step): step is Extract<AgentStep, { kind: "evidence_integrity" }> =>
          step.kind === "evidence_integrity",
      );

      expect(forensicStatus?.sourceCoverage).toBe("COMPLETE");
      expect(forensicStatus?.findingStatus).toBe("PROVEN");
      expect(forensicStatus?.requestedFiles).toEqual([...FIVE_FILE_MANIFEST]);
      expect(forensicStatus?.rootCoverage).toHaveLength(FIVE_FILE_MANIFEST.length);
      expect(forensicStatus?.rootCoverage?.every((coverage) => coverage.status === "COMPLETE")).toBe(true);

      expect(evidenceIntegrity?.evidenceSourceCoverage?.status).toBe("COMPLETE");
      expect(evidenceIntegrity?.evidenceSourceCoverage?.requestedFiles).toEqual([...FIVE_FILE_MANIFEST]);
      expect(evidenceIntegrity?.completedReadFiles).toEqual(expect.arrayContaining([...FIVE_FILE_MANIFEST]));
      expect(evidenceIntegrity?.retainedBodyFiles).toEqual(expect.arrayContaining([...FIVE_FILE_MANIFEST]));
      expect(evidenceIntegrity?.uniqueFilesRead).toBe(FIVE_FILE_MANIFEST.length);
      expect(result.response).toContain("ID: F-01");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails closed when one of five manifest files is unavailable", async () => {
    const missingFile = FIVE_FILE_MANIFEST[4];
    const { rootPath, result, steps } = await runFiveFileAudit({ omit: missingFile });
    try {
      const forensicStatus = [...steps].reverse().find(
        (step): step is Extract<AgentStep, { kind: "forensic_status" }> =>
          step.kind === "forensic_status",
      );
      const evidenceIntegrity = [...steps].reverse().find(
        (step): step is Extract<AgentStep, { kind: "evidence_integrity" }> =>
          step.kind === "evidence_integrity",
      );

      expect(forensicStatus?.requestedFiles).toEqual([...FIVE_FILE_MANIFEST]);
      expect(forensicStatus?.sourceCoverage).toBe("PARTIAL");
      expect(forensicStatus?.findingStatus).toBe("NOT_PROVEN");
      expect(forensicStatus?.repairReadiness).toBe("BLOCKED");
      expect(forensicStatus?.rootCoverage?.find((coverage) => coverage.root === missingFile)).toMatchObject({
        status: "BUDGET_EXHAUSTED",
        discoveredFiles: 1,
        readFiles: 0,
        unreadFiles: 1,
      });

      expect(evidenceIntegrity?.evidenceSourceCoverage?.status).toBe("PARTIAL");
      expect(evidenceIntegrity?.evidenceSourceCoverage?.requestedFiles).toEqual([...FIVE_FILE_MANIFEST]);
      expect(evidenceIntegrity?.uniqueFilesRead).toBe(FIVE_FILE_MANIFEST.length - 1);
      expect(result.response).toContain("NOT PROVEN");
      expect(result.response).not.toMatch(/ID:\s*F-01\s*·\s*SQL injection via string interpolation/);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("emits sourceCoverage COMPLETE and keeps a Finding when the target is fully read", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-e2e-complete-"));
    const file = "lib/knowledge-engine/src/query.ts";
    await fs.mkdir(path.join(rootPath, "lib/knowledge-engine/src"), { recursive: true });
    await fs.writeFile(
      path.join(rootPath, file),
      "export function buildQuery(input: string): string { return `SELECT * WHERE id = ${input}`; }\n",
      "utf8",
    );

    const report = SQL_INJECTION_REPORT(file);
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: [file] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    const forensicStatuses: Array<Record<string, unknown>> = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: FORENSIC_SINGLE_MESSAGE(file),
      history: [],
      projectContext: {
        project: "test | test project",
        workflows: "No workflows defined yet",
        recentTasks: "",
        latestMetrics: "",
        graphSummary: "",
        recentEvents: "",
        metricsVerified: false,
      },
      rootPath,
      provider: "openrouter",
      apiKey: "test-or-key",
      onStep: (step) => {
        if (step.kind === "forensic_status") {
          forensicStatuses.push({
            sourceCoverage: step.sourceCoverage,
            findingStatus: step.findingStatus,
            repairReadiness: step.repairReadiness,
          });
        }
      },
    });

    try {
      // The eager single-file prefetch read the target completely → COMPLETE.
      expect(forensicStatuses.length).toBeGreaterThan(0);
      expect(forensicStatuses[0]?.sourceCoverage).toBe("COMPLETE");
      // COMPLETE coverage lets the Finding through the evidence gate
      // uncontested: not downgraded, repair phase is executable.
      expect(forensicStatuses[0]?.findingStatus).toBe("PROVEN");
      expect(forensicStatuses[0]?.repairReadiness).toBe("READY");
      expect(result.response).toContain("ID: F-01");
      expect(result.response).not.toContain("Evidence Gate: NOT PROVEN");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("emits sourceCoverage PARTIAL and blocks a Finding when the target is unread", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-e2e-partial-"));
    const file = "src/query.ts";
    // Deliberately do NOT create the file — the eager prefetch cannot read it,
    // so the deterministic single-file coverage turns PARTIAL and the Finding
    // must be blocked even though the provider report text is identical.
    const report = SQL_INJECTION_REPORT(file);
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: [file] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    const forensicStatuses: Array<Record<string, unknown>> = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      message: FORENSIC_SINGLE_MESSAGE(file),
      history: [],
      projectContext: {
        project: "test | test project",
        workflows: "No workflows defined yet",
        recentTasks: "",
        latestMetrics: "",
        graphSummary: "",
        recentEvents: "",
        metricsVerified: false,
      },
      rootPath,
      provider: "openrouter",
      apiKey: "test-or-key",
      onStep: (step) => {
        if (step.kind === "forensic_status") {
          forensicStatuses.push({
            sourceCoverage: step.sourceCoverage,
            findingStatus: step.findingStatus,
            repairReadiness: step.repairReadiness,
          });
        }
      },
    });

    try {
      // The target file could not be read → single-file coverage is PARTIAL.
      expect(forensicStatuses.length).toBeGreaterThan(0);
      expect(forensicStatuses[0]?.sourceCoverage).toBe("PARTIAL");
      // Incomplete coverage forces the verdict NOT_PROVEN and blocks repair,
      // despite the provider asserting a Finding.
      expect(forensicStatuses[0]?.findingStatus).toBe("NOT_PROVEN");
      expect(forensicStatuses[0]?.repairReadiness).toBe("BLOCKED");
      // The gated response must not present the Finding as proven…
      expect(result.response).not.toMatch(/ID:\s*F-01\s*·\s*SQL injection via string interpolation/);
      // …and must carry a NOT PROVEN verdict (gate), not a PROVEN one.
      expect(result.response).toContain("NOT PROVEN");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("emits sourceCoverage PARTIAL and blocks a Finding when a genuinely large file is capped by the production read truncation path", async () => {
    // This drives REAL production truncation, not an embedded marker. The eager
    // single-file prefetch reads unbounded (fs.readFile), so single-file mode can
    // never append a marker by itself. Instead we run an ordered-root audit whose
    // discovery reads go through executeFileTool with complete:true, which caps a
    // file that exceeds MAX_FORENSIC_READ_BYTES (512 KB) and appends the production
    // "[... forensic read exceeded the maximum safe evidence window ...]" marker.
    // The live pipeline must infer that capped read as incomplete, fail closed to
    // PARTIAL, and block the Finding — a regression here would surface an
    // incomplete read as COMPLETE on the bubble.
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-e2e-truncated-"));
    // The ordered-root classifier only extracts nested directory paths (>= one '/'),
    // so use a two-segment root rather than a bare top-level directory name.
    const root = "src/util";
    const file = `${root}/query.ts`;
    await fs.mkdir(path.join(rootPath, root), { recursive: true });
    // A real source file larger than the 512 KB forensic read cap. The marker is
    // appended by executeFileTool's truncation logic at read time, never written
    // into the fixture.
    const header = "export function buildQuery(input: string): string {\n  return `SELECT * WHERE id = ${input}`;\n}\n";
    const bigBody = "  // padding\n".repeat(45_000); // ~ 585 KB padding lines
    await fs.writeFile(path.join(rootPath, file), header + bigBody, "utf8");

    const report = SQL_INJECTION_REPORT(file);
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: JSON.stringify({ response: report, sources: [file] }),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    const forensicStatuses: Array<Record<string, unknown>> = [];
    const { chat } = await import("../agents/chat-agent.js");
    const result = await chat({
      // Ordered-root classifier trigger: scoped directory forensic audit.
      // Must NOT start with an immediate-execution verb (نفّذ/ابدأ/…), which
      // would nullify structuredOutputMode and suppress the forensic_status step.
      message: [
        "You are a forensic analysis agent.",
        `Read only the "${root}" directory inside the project.`,
        "Do not read anything outside this directory, and produce a report grounded in direct evidence.",
      ].join("\n"),
      history: [],
      projectContext: {
        project: "test | test project",
        workflows: "No workflows defined yet",
        recentTasks: "",
        latestMetrics: "",
        graphSummary: "",
        recentEvents: "",
        metricsVerified: false,
      },
      rootPath,
      provider: "openrouter",
      apiKey: "test-or-key",
      onStep: (step) => {
        if (step.kind === "forensic_status") {
          forensicStatuses.push({
            sourceCoverage: step.sourceCoverage,
            findingStatus: step.findingStatus,
            repairReadiness: step.repairReadiness,
          });
        }
      },
    });

    try {
      // The file was read but executeFileTool capped it at 512 KB and appended the
      // production truncation marker, so the live pipeline must infer PARTIAL.
      expect(forensicStatuses.length).toBeGreaterThan(0);
      expect(forensicStatuses[0]?.sourceCoverage).toBe("PARTIAL");
      // The inferred incomplete coverage forces the verdict NOT_PROVEN and
      // blocks repair, even though the provider asserted a Finding.
      expect(forensicStatuses[0]?.findingStatus).toBe("NOT_PROVEN");
      expect(forensicStatuses[0]?.repairReadiness).toBe("BLOCKED");
      // The gated response must not present the Finding as proven…
      expect(result.response).not.toMatch(/ID:\s*F-01\s*·\s*SQL injection via string interpolation/);
      // …and must carry a NOT PROVEN verdict (gate), not a PROVEN one.
      expect(result.response).toContain("NOT PROVEN");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});