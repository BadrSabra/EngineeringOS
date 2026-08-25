/**
 * Task #57 — FEG-018: fixed regression benchmark guarding BOTH extremes of the
 * evidence-read equation:
 *
 *   ❌ 91 reads  — broad prefetch / graph / cross-file speculation before or
 *                  instead of a single targeted first read (wasteful, slow).
 *   ❌ 0 reads   — over-restriction that never acquires source evidence.
 *
 * The target profile the benchmark locks is "1 primary read → minimal proven
 * dependencies → claim closure → behavioral answer". Four focused tests each
 * drive the WHOLE chat() pipeline (mocked provider registry + a real tmpdir)
 * and assert the acceptance-criteria table from the observable runtime surface:
 *
 *   - Test A (Explicit File): query names a file → the FIRST source read is
 *     that file, evidence acquired, self-consistent, no over-read.
 *   - Test B (Explicit Symbol): query names an entity → a targeted source read
 *     of the defining file, first evidence acquired.
 *   - Test C (Cross-File Behavioral): primary read → exactly ONE dependency,
 *     no prefetch, no duplicates, self-consistent telemetry.
 *   - Test D (Negative Scope): analyze the target only — decoy provider /
 *     workflow / prompt files are never read; read set stays scoped.
 *
 * Every test enforces the shared acceptance table so a regression toward EITHER
 * 91 reads or 0 reads fails loudly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ProjectContext } from "../context-builder.js";
import type { AgentStep, SourceRetrievalTelemetry } from "../tool-execution-engine.js";

const originalApiKey = process.env.GROQ_API_KEY;

function makeContext(): ProjectContext {
  return {
    project: "test | feg-018 regression benchmark",
    workflows: "No workflows defined yet",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

/** A plain `.ts` production path that defines the queried symbol. */
const TARGET = "src/executor.ts";
const TARGET_CONTENT = [
  'import { MAX_LOOPS } from "./caller";',
  "export function executeToolLoop(opts?: { maxIterations?: number }) {",
  "  let iter = 0;",
  "  const cap = opts?.maxIterations ?? MAX_LOOPS;",
  "  while (iter < cap) iter += 1;",
  "  return iter;",
  "}",
].join("\n");

/**
 * A single DEEPER file that src/executor.ts references via an import. The
 * primary read (TARGET) names the dependency, so a subsequent read of CALLER
 * carries an evidence-grounded dependency proof (from_file=TARGET whose body
 * literally contains the import line) rather than an unjustified read.
 */
const CALLER = "src/caller.ts";
const CALLER_CONTENT = "export const MAX_LOOPS = 20;\n";

/** Decoys that a negative-scope run must NEVER read. */
const DECOYS = [
  "src/provider.ts",
  "src/workflow.ts",
  "src/prompt.ts",
  "src/unrelated.ts",
];
const DECOY_CONTENT = (n: string) => `export const ${path.basename(n).replace(/\W/g, "")} = 1;\n`;

const GROUNDED_TARGET_ANSWER = (file: string) =>
  JSON.stringify({
    response:
      `Source: \`${file}\`\n` +
      "`while (iter < cap) iter += 1;` is the loop advance, so the loop stops exactly when `iter` reaches `cap`.",
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

async function makeRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(tmpdir(), "eos-feg018-bench-"));
  for (const rel of [TARGET, CALLER, ...DECOYS]) {
    const full = path.join(rootPath, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const content =
      rel === TARGET ? TARGET_CONTENT : rel === CALLER ? CALLER_CONTENT : DECOY_CONTENT(rel);
    await fs.writeFile(full, content, "utf8");
  }
  return rootPath;
}

// ── Shared acceptance-criteria table (FEG-018) ───────────────────────────
// A helper every test calls so both extreme regressions fail loudly. Each row
// is asserted against the run's terminal telemetry + step ordering.
function assertAcceptanceTable(
  o: {
    steps: AgentStep[];
    telemetry?: SourceRetrievalTelemetry;
    behavioralAnswerAccepted: boolean;
    scopedReadSet: string[]; // distinct source files actually read (tool_result.source)
    expectedReadSet: string[]; // the EXACT set the scenario may read — no more, no less
    maxUniqueReads: number; // telemetry upper bound on uniqueReads for the scenario
    maxDependencyReads?: number; // expected upper bound on dependency reads (default: unlimited)
  },
): void {
  const tel = o.telemetry;

  // ── 0-read extreme (over-restriction) ─────────────────────────────────
  // The run MUST have acquired source evidence: first read is not null and the
  // run is not classified as incomplete-before-evidence.
  expect(tel?.firstEvidenceAcquired).toBe(true);
  expect(tel?.iterationsUntilFirstSourceRead).not.toBeNull();
  expect(tel?.incompleteBeforeEvidence).toBeFalsy();

  // The first source read must land within the first 2 iterations (or the
  // prefetch sentinel) — never a hunt through the budget before evidence.
  const firstRead = tel?.iterationsUntilFirstSourceRead;
  if (typeof firstRead === "number") {
    expect(firstRead).toBeLessThanOrEqual(2);
  }

  // soft-limit-before-first-evidence ✗ — a run that acquired evidence may never
  // be labelled as a zero-read soft-limit.
  expect(tel?.investigationStartSla).not.toBe("soft_limit_with_zero_reads");

  // ── 91-read extreme (broad prefetch) ──────────────────────────────────
  // No source is read before the first evidence read (prefetch is only the
  // eager primary target; never a broad scan).
  expect(tel?.crossFileQueriesBeforeFirstRead).toBe(0);

  // No duplicate reads — each evidence path is read at most once.
  expect(tel?.duplicateReads).toBe(0);

  // ── Exact read-scope bound (the core 91-read guard) ───────────────────
  // The set of files actually read must be EXACTLY the scenario's allowed set.
  // A regression toward 91 distinct, retained reads (or any off-scope read)
  // fails here, regardless of duplicate/consistency telemetry.
  const normalizedRead = [...o.scopedReadSet].sort();
  const normalizedExpected = [...o.expectedReadSet].sort();
  expect(normalizedRead).toEqual(normalizedExpected);
  expect(o.scopedReadSet.length).toBe(o.expectedReadSet.length);

  // Telemetry MUST agree with the scope's upper bound: unique reads can never
  // exceed the allowed set size, and dependency reads stay within their bound.
  expect(tel?.uniqueReads ?? 0).toBeLessThanOrEqual(o.maxUniqueReads);
  expect(tel?.uniqueReads ?? 0).toBeLessThanOrEqual(o.expectedReadSet.length);
  if (o.maxDependencyReads !== undefined) {
    expect(tel?.dependencyReads ?? 0).toBeLessThanOrEqual(o.maxDependencyReads);
  }

  // Behavioral answer accepted — the query resolved to a grounded answer.
  expect(o.behavioralAnswerAccepted).toBe(true);
}

/** Extract the terminal `done` step's sourceRetrieval telemetry. */
function terminalTelemetry(steps: AgentStep[]): SourceRetrievalTelemetry | undefined {
  const done = [...steps].reverse().find((s) => s.kind === "done");
  return done?.kind === "done" ? done.sourceRetrieval : undefined;
}

/** Ordered, de-duplicated set of source files read (from tool_result.source). */
function readScope(steps: AgentStep[]): string[] {
  const seen = new Set<string>();
  for (const s of steps) {
    if (s.kind === "tool_result" && typeof s.source === "string" && s.source) {
      seen.add(s.source.replace(/^(\.\/)+/, ""));
    }
  }
  return [...seen];
}

describe("FEG-018 regression benchmark: never 91 reads, never 0 reads (task #57)", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  // ── Test A (Explicit File) ────────────────────────────────────────────
  it("A: a query naming the file performs the FIRST read of that file, acquires evidence, and does not broad-read", async () => {
    const rootPath = await makeRoot();
    const message = `What does ${TARGET}'s executeToolLoop do when maxIterations is 20? Answer with evidence from the file.`;

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: GROUNDED_TARGET_ANSWER(TARGET),
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
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => void steps.push(step),
      });

      // primary target FIRST: the first source read is the named file.
      const firstRead = steps.find((s) => s.kind === "tool_result" && s.source !== undefined);
      expect(firstRead?.kind).toBe("tool_result");
      if (firstRead?.kind === "tool_result") {
        expect(firstRead.source).toBe(TARGET);
      }

      // The FEG gate surfaced and precedes any cross-file trace.
      const fegIndex = steps.findIndex(
        (s) => s.kind === "diagnostic" && s.code === "FIRST_EVIDENCE_READ_ALLOWED",
      );
      expect(fegIndex).toBeGreaterThanOrEqual(0);
      const firstCrossFile = steps.findIndex((s) => s.kind === "cross_file_trace");
      if (firstCrossFile !== -1) expect(fegIndex).toBeLessThan(firstCrossFile);

      // Evidence was acquired, telemetry CONSISTENT, run finished with a
      // behavioral answer (0-read and telemetry extremes).
      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
        expect(integrity.consistent).toBe(true);
      }
      expect(result.taskResult?.kind).toBe("BEHAVIOR_ANSWER_RESULT");

      assertAcceptanceTable({
        steps,
        telemetry: terminalTelemetry(steps),
        behavioralAnswerAccepted: result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT",
        scopedReadSet: readScope(steps),
        expectedReadSet: [TARGET],
        maxUniqueReads: 1,
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  // ── Test B (Explicit Symbol) ──────────────────────────────────────────
  it("B: a query naming a SYMBOL triggers a targeted source read of its defining file", async () => {
    const rootPath = await makeRoot();
    const message = "What does executeToolLoop do after exhausting its iterations? Answer with evidence.";

    // The mock resolves the symbol the way a well-behaved tool loop does: it
    // issues read_file of the defining file first, then grounds the answer.
    let issuedRead = false;
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        if (!issuedRead) {
          issuedRead = true;
          return {
            content: "",
            toolCalls: [
              {
                id: "sym-read",
                type: "function" as const,
                function: { name: "read_file", arguments: JSON.stringify({ path: TARGET }) },
              },
            ],
            model: "initial-model",
            usage: {},
          };
        }
        return {
          content: GROUNDED_TARGET_ANSWER(TARGET),
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };
    await mockChatProviders(fakeStrategy);

    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => void steps.push(step),
      });

      // The symbol's defining file was read (targeted source read).
      const readPaths = readScope(steps);
      expect(readPaths).toContain(TARGET);

      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
      }

      // Evidence acquired (not 0 reads), first read within budget, no duplicates,
      // and the read scope is EXACTLY the symbol's defining file.
      assertAcceptanceTable({
        steps,
        telemetry: terminalTelemetry(steps),
        behavioralAnswerAccepted: result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT",
        scopedReadSet: readPaths,
        expectedReadSet: [TARGET],
        maxUniqueReads: 1,
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  // ── Test C (Cross-File Behavioral) ────────────────────────────────────
  it("C: a cross-file behavioral query reads the primary then EXACTLY ONE dependency, with no prefetch or duplicates", async () => {
    const rootPath = await makeRoot();
    // Starts with a BEHAVIOR_QUERY_PATTERN keyword so the run is classified as
    // an explicit behavior query (semanticBehaviorAnswer is then assembled) and
    // names TARGET so the FEG gate prefetches the primary source first.
    const message =
      `What does ${TARGET}'s executeToolLoop draw from ./caller to cap its iterations when maxIterations is exhausted? ` +
      "Answer with evidence from the import dependency.";

    const calls: { count: number } = { count: 0 };
    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => {
        calls.count += 1;
        // The FEG gate already prefetched the named src/executor.ts as the
        // FIRST source read. The loop's one remaining read is the DEPENDENCY
        // (src/caller.ts), carrying the evidence-grounded proof: from_file is
        // the already-read TARGET whose retained body literally contains the
        // import line that names the dependency (the reference MUST occur in
        // that body or the read is treated as unjustified and blocked).
        if (calls.count === 1) {
          return {
            content: "",
            toolCalls: [
              {
                id: "c2",
                type: "function" as const,
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({
                    path: CALLER,
                    from_file: TARGET,
                    from_symbol: "MAX_LOOPS",
                    reference: 'import { MAX_LOOPS } from "./caller";',
                    why_required:
                      "executeToolLoop in src/executor.ts caps its loop with MAX_LOOPS imported from src/caller.ts",
                  }),
                },
              },
            ],
            model: "initial-model",
            usage: {},
          };
        }
        return {
          content: JSON.stringify({
            response:
              `Source: \`${TARGET}\` / \`${CALLER}\`\n` +
              "`executeToolLoop` imports `MAX_LOOPS` from `./caller`; its `while (iter < cap) iter += 1;` loop advance stops when `iter` reaches `cap`, and when `maxIterations` is absent `export const MAX_LOOPS = 20;` bounds the returned count at 20.",
            sources: [TARGET, CALLER],
          }),
          toolCalls: [],
          model: opts.model ?? "initial-model",
          usage: {},
        };
      }),
      stream: vi.fn(),
    };
    await mockChatProviders(fakeStrategy);

    let steps: AgentStep[] = [];
    try {
      const { chat } = await import("../agents/chat-agent.js");
      steps = [];
      const result = await chat({
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => void steps.push(step),
      });

      expect(calls.count).toBeGreaterThan(0);

      // Primary read first, then the single caller dependency.
      const firstRead = steps.find((s) => s.kind === "tool_result" && s.source !== undefined);
      expect(firstRead?.kind).toBe("tool_result");
      if (firstRead?.kind === "tool_result") expect(firstRead.source).toBe(TARGET);

      const readPaths = readScope(steps);
      const tel = terminalTelemetry(steps);

      // EXACTLY ONE dependency was proven; no prefetch-before-read broad scan;
      // no duplicates; and telemetry agrees with the exact read-set bound.
      expect(tel?.dependencyReads).toBe(1);
      expect(tel?.duplicateReads).toBe(0);

      const integrity = [...steps].reverse().find((s) => s.kind === "evidence_integrity");
      expect(integrity?.kind).toBe("evidence_integrity");
      if (integrity?.kind === "evidence_integrity") {
        expect(integrity.code).toBe("TELEMETRY_CONSISTENT");
        // uniqueFilesRead matches evidenceFileCount → self-consistent.
        expect(integrity.uniqueFilesRead).toBe(integrity.evidenceFileCount);
      }

      assertAcceptanceTable({
        steps,
        telemetry: tel,
        behavioralAnswerAccepted: result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT",
        scopedReadSet: readPaths,
        expectedReadSet: [TARGET, CALLER],
        maxUniqueReads: 2,
        maxDependencyReads: 1,
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  // ── Test D (Negative Scope) ───────────────────────────────────────────
  it("D: a negative-scope query reads ONLY the target — never provider/workflow/prompt decoys", async () => {
    const rootPath = await makeRoot();
    const message =
      `Analyze ${TARGET}'s executeToolLoop behavior ONLY. Do not inspect any other file. Answer with evidence.`;

    const fakeStrategy = {
      providerId: "openrouter",
      supportsNativeStream: false,
      ownsModelFallback: true,
      call: vi.fn(async (_messages: unknown, opts: { model?: string }) => ({
        content: GROUNDED_TARGET_ANSWER(TARGET),
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
        message,
        history: [],
        projectContext: makeContext(),
        rootPath,
        provider: "openrouter",
        apiKey: "test-or-key",
        onStep: (step) => void steps.push(step),
      });

      const readPaths = readScope(steps);
      const tel = terminalTelemetry(steps);

      // The read scope is bounded AND correct: the decoys were never read and
      // the global read count stays minimal (guards the 91-read extreme).
      expect(readPaths.length).toBeGreaterThan(0);
      assertAcceptanceTable({
        steps,
        telemetry: tel,
        behavioralAnswerAccepted: result.taskResult?.kind === "BEHAVIOR_ANSWER_RESULT",
        scopedReadSet: readPaths,
        expectedReadSet: [TARGET],
        maxUniqueReads: 1,
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
