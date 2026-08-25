/**
 * Task #49 — First-Evidence Gate (FEG) end to end.
 *
 * Acceptance: a BEHAVIOR_QUERY that names an explicit source file performs its
 * FIRST source read of that file directly, before any graph expansion,
 * cross-file trace, dependency discovery, or broad prefetch. The task contract
 * carries Allowed First Action + Primary Evidence Target + Traversal Policy and
 * these demonstrably drive the runtime's first read and the emitted diagnostic.
 *
 * This harness:
 *   1. Asserts the classifier carries the FEG contract for an explicit-file
 *      behavior query (DIRECT_READ + FILE target + PRIMARY_FIRST).
 *   2. Drives chat() end to end with a mocked provider registry and a real
 *      target file, asserting the FIRST source read emitted is the named file
 *      (prefetched directly by the gate) and that FIRST_EVIDENCE_READ_ALLOWED
 *      is surfaced before any cross-file-trace step.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep } from "../tool-execution-engine.js";
import { classifyRequest } from "../prompts/profile-classifier.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | ep4-feg first-read e2e",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

// A plain `.ts` production path; the FEG target the gate must read first.
const FILE = "src/executor.ts";
const FILE_CONTENT = [
  "export function run(input: string): string {",
  "  return eval(input);",
  "}",
].join("\n");

/** A BEHAVIOR_QUERY naming an explicit file — but NOT single-file forensic mode. */
const BEHAVIOR_MESSAGE =
  `What happens when ${FILE}'s run() is called with an empty string? Answer with evidence from the file.`;

const GROUNDED_ANSWER = (file: string) =>
  JSON.stringify({
    response: `run() returns the input unchanged, then eval evaluates it. Evidence: \`return eval(input)\` in ${file}.`,
    sources: [file],
  });

/** Mock provider + model-selection registry so chat() uses the fake strategy. */
async function mockChatProviders(fakeStrategy: unknown): Promise<void> {
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

describe("First-Evidence Gate: an explicit-file behavior query reads its target first (task #49)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("classifier carries DIRECT_READ / FILE target / PRIMARY_FIRST for an explicit-file behavior query", () => {
    const classification = classifyRequest(BEHAVIOR_MESSAGE);
    expect(classification.taskType).toBe("BEHAVIOR_QUERY");
    expect(classification.singleFileForensicMode).toBe(false);
    expect(classification.firstEvidence.allowedFirstAction).toBe("DIRECT_READ");
    expect(classification.firstEvidence.primaryEvidenceTarget).toEqual({
      kind: "FILE",
      path: FILE,
    });
    expect(classification.firstEvidence.traversalPolicy).toBe("PRIMARY_FIRST");
  });

  it("classifier does NOT claim DIRECT_READ for vague or implementation-style queries", () => {
    const vague = classifyRequest("what happens to performance overall?");
    expect(vague.firstEvidence.allowedFirstAction).toBe("EXPLORE");
    expect(vague.firstEvidence.primaryEvidenceTarget).toBeNull();

    const impl = classifyRequest(
      "Task #123: implement the feature, done looks like tests passing, update src/widget.ts",
    );
    expect(impl.firstEvidence.allowedFirstAction).toBe("EXPLORE");
    expect(impl.firstEvidence.primaryEvidenceTarget).toBeNull();
  });

  it("classifier canonicalizes a `./`-prefixed target and requires EXACTLY one explicit file", () => {
    // Leading `./` must be canonicalized to the same project-relative target.
    const dotted = classifyRequest(
      "What happens when ./src/executor.ts's run() is called? Answer with evidence.",
    );
    expect(dotted.firstEvidence.allowedFirstAction).toBe("DIRECT_READ");
    expect(dotted.firstEvidence.primaryEvidenceTarget).toEqual({
      kind: "FILE",
      path: FILE, // canonicalized without `./`
    });

    // Two distinct explicit files must NOT collapse to DIRECT_READ on one of them.
    const multi = classifyRequest(
      "Compare src/executor.ts and src/parser.ts behavior. Answer with evidence.",
    );
    expect(multi.firstEvidence.allowedFirstAction).toBe("EXPLORE");
    expect(multi.firstEvidence.primaryEvidenceTarget).toBeNull();
  });

  it("chat() performs the FIRST source read of the named file directly, before any cross-file trace, and surfaces FIRST_EVIDENCE_READ_ALLOWED", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ep4-feg-chat-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: GROUNDED_ANSWER(FILE),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message: BEHAVIOR_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => void steps.push(step),
      });

      // The run must complete with a grounded (accepted) answer.
      expect(result.response.length).toBeGreaterThan(0);

      // 1. The gate surfaced its diagnostic — proof the contract fired.
      const fegDiagnostic = steps.find(
        (s) => s.kind === "diagnostic" && s.code === "FIRST_EVIDENCE_READ_ALLOWED",
      );
      expect(fegDiagnostic?.kind).toBe("diagnostic");

      // 2. The FIRST source read of this run is the named file, emitted as a
      //    direct prefetched read — the gate's eager first read, not a graph or
      //    dependency-triggered one.
      const firstRead = steps.find(
        (s) => s.kind === "tool_result" && s.source !== undefined,
      );
      expect(firstRead?.kind).toBe("tool_result");
      if (firstRead?.kind === "tool_result") {
        expect(firstRead.source).toBe(FILE);
      }
      // 3. The FEG diagnostic precedes ANY cross-file trace (graph output is
      //    candidate discovery only and must never run before the first read).
      const fegIndex = steps.findIndex(
        (s) => s.kind === "diagnostic" && s.code === "FIRST_EVIDENCE_READ_ALLOWED",
      );
      const firstCrossFile = steps.findIndex((s) => s.kind === "cross_file_trace");
      if (firstCrossFile !== -1) {
        expect(fegIndex).toBeLessThan(firstCrossFile);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  // Regression for FIRST_EVIDENCE_UNAVAILABLE: an explicit-file behavior query
  // that ALSO contains forensic-report template prose ("defect/repair",
  // "Finding/Repair Plan") used to have that prose parsed into bogus
  // orderedForensicRoots, which formed a restricting scope that dropped the very
  // file DIRECT_READ pinned. The run then starved to FIRST_EVIDENCE_UNAVAILABLE
  // despite one completed source body. The classifier denylist fix keeps those
  // prose slash-pairs OUT of orderedForensicRoots so the pinned read is admitted.
  const BEHAVIOR_WITH_PROSEROOTS_MESSAGE =
    "Behavioral verdict test. Inspect only src/executor.ts. " +
    "Does run() reference a forensic evidence pipeline? " +
    "The system MUST NOT reject merely because there is no defect/repair finding. " +
    "It must not require a Finding/Repair Plan for this behavioral question.";

  it("keeps forensic-template prose out of roots so a DIRECT_READ-pinned file stays admissible", () => {
    const classification = classifyRequest(BEHAVIOR_WITH_PROSEROOTS_MESSAGE);
    // The defect/repair + Finding/Repair prose must NOT leak into a roots
    // manifest (that would restrict scope and starve the read to UNAVAILABLE).
    expect(classification.orderedForensicRoots).toHaveLength(0);
    // The single named file is still pinned as the DIRECT_READ primary target.
    expect(classification.singleFileForensicMode).toBe(false);
    expect(classification.firstEvidence.allowedFirstAction).toBe("DIRECT_READ");
    expect(classification.firstEvidence.primaryEvidenceTarget).toEqual({
      kind: "FILE",
      path: FILE,
    });
  });

  it("chat() admits the DIRECT_READ-pinned file even when prose would otherwise form bogus roots", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ep4-feg-proseroot-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: GROUNDED_ANSWER(FILE),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);
    let diagnostics: string[] = [];
    let firstReadSource: string | undefined;
    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: BEHAVIOR_WITH_PROSEROOTS_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "diagnostic") diagnostics.push(step.code);
          if (step.kind === "tool_result" && step.source !== undefined) {
            firstReadSource = step.source;
          }
        },
      });

      // The run completes with a grounded answer…
      expect(result.response.length).toBeGreaterThan(0);
      // …the gate fired on the pinned file…
      expect(diagnostics).toContain("FIRST_EVIDENCE_READ_ALLOWED");
      // …the named file was actually read as the first source…
      expect(firstReadSource).toBe(FILE);
      // …and crucially the run NEVER starved to FIRST_EVIDENCE_UNAVAILABLE
      // despite the prose containing "defect/repair" and "Finding/Repair Plan".
      expect(diagnostics).not.toContain("FIRST_EVIDENCE_UNAVAILABLE");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("chat() emits the first read for a `./`-prefixed target in canonicalized form", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ep4-feg-dotted-"));
    const fullFile = path.join(rootPath, FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, FILE_CONTENT, "utf8");

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: GROUNDED_ANSWER(FILE),
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);

    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      await chat({
        message: `What happens when ./${FILE}'s run() is called? Answer with evidence from the file.`,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => void steps.push(step),
      });

      // The trace key must be the canonical project-relative path (no `./`),
      // matching the fileContents map, so the gate's first read is observable.
      const firstRead = steps.find(
        (s) => s.kind === "tool_result" && s.source !== undefined,
      );
      expect(firstRead?.kind).toBe("tool_result");
      if (firstRead?.kind === "tool_result") {
        expect(firstRead.source).toBe(FILE);
      }
      const fegDiagnostic = steps.find(
        (s) => s.kind === "diagnostic" && s.code === "FIRST_EVIDENCE_READ_ALLOWED",
      );
      expect(fegDiagnostic?.kind).toBe("diagnostic");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  // Deterministic E2E proof of the source-grounded behavioral verdict. The
  // completed single-file read must be able to reach an ACCEPTED NO_FINDING
  // verdict grounded in an exact quoted fragment of the read file, even when
  // the provider cannot produce an accepted Finding. This is the deterministic
  // path (buildSourceGroundedNoFindingEnvelope -> buildStructuredForensicReport)
  // that turns a complete read into a source-grounded behavioral answer instead
  // of degrading to NOT PROVEN / empty.
  const CLASSIFIER_FILE = "src/classifier.ts";
  const CLASSIFIER_CONTENT = [
    'export const PROSE_PSEUDO_PATH_DENYLIST = ["defect/repair", "finding/defect"];',
    "export function isPromptProsePath(candidate: string): boolean {",
    "  return candidate === 'defect/repair';",
    "}",
  ].join("\n");
  const BEHAVIORAL_VERDICT_MESSAGE =
    "Behavioral verdict — classifier scope fix verification. Infer what happens in " +
    "src/classifier.ts and detect whether isPromptProsePath rejects the 'defect/repair' " +
    "slash-pair so it never becomes a forensic directory root. Prove your answer from " +
    "the completed read body. A negative behavioral result is a valid result; it must " +
    "not require a Finding/Repair Plan.";

  it("classifier keeps behavior-verdict prose out of roots and still pins DIRECT_READ on the named classifier", () => {
    const classification = classifyRequest(BEHAVIORAL_VERDICT_MESSAGE);
    expect(classification.orderedForensicRoots).toHaveLength(0);
    expect(classification.firstEvidence.allowedFirstAction).toBe("DIRECT_READ");
    expect(classification.firstEvidence.primaryEvidenceTarget).toEqual({
      kind: "FILE",
      path: CLASSIFIER_FILE,
    });
  });

  it("chat() turns a completed single-file read into an accepted source-grounded NO_FINDING verdict via the deterministic path", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ep4-feg-detverdict-"));
    const fullFile = path.join(rootPath, CLASSIFIER_FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, CLASSIFIER_CONTENT, "utf8");

    // The provider deliberately returns an empty/unparseable completion so no
    // model-authored Finding is accepted; only the deterministic no-finding
    // fallback can produce the final source-grounded verdict.
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: "",
        toolCalls: [],
        model: opts.model ?? "initial-model",
        usage: {},
      })),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);
    let diagnostics: string[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: BEHAVIORAL_VERDICT_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "diagnostic") diagnostics.push(step.code);
        },
      });

      // 1. The completed read is admissible (the fix): the gate fired and the
      //    run never starved to FIRST_EVIDENCE_UNAVAILABLE.
      expect(diagnostics).toContain("FIRST_EVIDENCE_READ_ALLOWED");
      expect(diagnostics).not.toContain("FIRST_EVIDENCE_UNAVAILABLE");

      // 2. The deterministic no-finding fallback fired to produce the verdict.
      expect(diagnostics).toContain("FORENSIC_DETERMINISTIC_NO_FINDING");

      // 3. The final answer is a NON-EMPTY, source-grounded verdict that quotes
      //    an exact implementation fragment from the read file — the completed
      //    read reached an accepted behavioral verdict rather than an empty or
      //    NOT PROVEN dead end.
      expect(result.response.length).toBeGreaterThan(0);
      // buildSourceGroundedNoFindingEnvelope quotes the first implementation line,
      // so the PROSE_PSEUDO_PATH_DENYLIST declaration (the read file's line 1) must
      // appear in the verdict's Basis as an exact quoted fragment of the
      // completed read body — proof the verdict is grounded in that read.
      expect(result.response).toContain("PROSE_PSEUDO_PATH_DENYLIST");
      // The final judgment is a source-grounded NO FINDING, with a Basis naming
      // the inspected file — not an empty or NOT PROVEN dead end.
      expect(result.response).toMatch(/NO FINDING/);
      // The Basis names the inspected file and quotes its exact implementation
      // fragment — source-grounded, not an empty dead end.
      expect(result.response).toContain("Basis: src/classifier.ts");
      expect(result.response).toMatch(/\bBasis:\s*src\/classifier\.ts contains/i);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  // Task #75 — a provider-authored Recovery envelope whose noFindingBasis is
  // NOT source-grounded (it names the file but quotes a fragment absent from
  // the retained body) must be REJECTED and must never become the final
  // answer. The deterministic source-grounded NO_FINDING verdict must win.
  it("rejects a Recovery NO_FINDING envelope whose basis is not grounded in the read file, keeping the deterministic verdict", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-ep4-feg-unground-"));
    const fullFile = path.join(rootPath, CLASSIFIER_FILE);
    await fs.mkdir(path.dirname(fullFile), { recursive: true });
    await fs.writeFile(fullFile, CLASSIFIER_CONTENT, "utf8");

    // The provider looks plausible: it names the file and even uses backticks /
    // a negative verdict, but the quoted fragment does NOT occur in the actual
    // file body (line 3 is `return candidate === 'defect/repair';`, not
    // startsWith). hasSourceGroundedNoFindingBasis must therefore reject it.
    const UNGROUNDED_ENVELOPE = JSON.stringify({
      verdict: "NO_FINDING",
      findings: [],
      repairPlan: [],
      validationChecklist: ["Checked the quoted implementation fragment against the requested behavior."],
      noFindingBasis:
        "src/classifier.ts contains `return candidate.startsWith('both');` which is straightforward approval logic; no defect is verified from the completed reads.",
    });

    let callCount = 0;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        callCount += 1;
        // First (primary) call is empty so the run is forced into Recovery;
        // every subsequent (Recovery) call returns the ungrounded envelope.
        return {
          content: callCount === 1 ? "" : UNGROUNDED_ENVELOPE,
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };

    await mockChatProviders(fakeStrategy);
    let diagnostics: string[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      const result = await chat({
        message: BEHAVIORAL_VERDICT_MESSAGE,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => {
          if (step.kind === "diagnostic") diagnostics.push(step.code);
        },
      });

      // 1. The ungrounded provider envelope was surfaced and REJECTED.
      expect(diagnostics).toContain("FORENSIC_STRUCTURED_RECOVERY_REJECTED");

      // 2. The deterministic source-grounded path produced the final verdict.
      expect(diagnostics).toContain("FORENSIC_DETERMINISTIC_NO_FINDING");
      expect(diagnostics).toContain("FIRST_EVIDENCE_READ_ALLOWED");
      expect(diagnostics).not.toContain("FIRST_EVIDENCE_UNAVAILABLE");

      // 3. The final answer is the deterministic verdict grounded in the REAL
      //    file fragment — NOT the provider's fabricated `startsWith` basis.
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.response).toContain("PROSE_PSEUDO_PATH_DENYLIST");
      expect(result.response).toContain("Basis: src/classifier.ts");
      expect(result.response).not.toContain("startsWith('both')");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
