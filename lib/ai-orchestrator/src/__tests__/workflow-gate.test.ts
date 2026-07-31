/**
 * AI-003: metrics gate tests for orchestrateWorkflow.
 *
 * We mock `agentComplete` (the lowest layer that makes the real AI call) so
 * that `decide` returns whatever we configure, without needing a GROQ_API_KEY.
 * This is the correct pattern for ESM: mock the import boundary that `decide`
 * itself crosses, not the exported `decide` symbol (which can't be spied on
 * within the same module in ESM/vitest without __esModule tricks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectContext } from "../context-builder.js";

// ── agentComplete mock ────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file by vitest.
// The factory runs before any imports, so _mockContent is initialised via
// vi.hoisted() first.
const { _mockContent } = vi.hoisted(() => ({
  _mockContent: { value: '{"action":"advance","reasoning":"ok","nextPhase":"build"}' },
}));

vi.mock("../agent-complete.js", () => ({
  agentComplete: vi.fn(() =>
    Promise.resolve({ content: _mockContent.value, model: "mock", usage: null }),
  ),
}));

import { orchestrateWorkflow } from "../agents/workflow-orchestrator.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const phases = [
  { name: "plan",   steps: ["write spec"] },
  { name: "build",  steps: ["implement"] },
  { name: "verify", steps: ["test"] },
];

function makeContext(metricsVerified: boolean): ProjectContext {
  return {
    project:
      "TestProject | Language: TypeScript | Status: active | Quality: 80/100 | Path: /workspace | Last scan: 2026-07-24 [completed]",
    recentTasks: "No tasks yet",
    latestMetrics: metricsVerified
      ? "Overall: 80.0/100 | (as of 2026-07-24)"
      : "Overall: 80.0/100 | (as of 2026-07-24)\n⚠ WARNING: unverified",
    graphSummary: "Knowledge graph empty — run a scan first",
    recentEvents: "No recent events",
    workflows: "No workflows defined yet",
    metricsVerified,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("orchestrateWorkflow — metrics gate (AI-003)", () => {
  beforeEach(() => {
    // Default: model proposes "advance" to "build".
    _mockContent.value = '{"action":"advance","reasoning":"ok","nextPhase":"build"}';
  });

  it("blocks 'advance' and downgrades to 'wait' when metricsVerified=false", async () => {
    const result = await orchestrateWorkflow({
      workflowName: "test-wf",
      phases,
      currentPhase: "plan",
      completedPhases: [],
      projectContext: makeContext(false),
    });

    expect(result.action).toBe("wait");
    expect(result.reasoning).toMatch(/metrics gate/i);
    expect((result as unknown as { blockers?: string[] }).blockers?.[0]).toMatch(/metrics/i);
  });

  it("blocks 'complete' and downgrades to 'wait' when metricsVerified=false", async () => {
    _mockContent.value = '{"action":"complete","reasoning":"done"}';

    const result = await orchestrateWorkflow({
      workflowName: "test-wf",
      phases,
      currentPhase: "verify",
      completedPhases: ["plan", "build"],
      projectContext: makeContext(false),
    });

    expect(result.action).toBe("wait");
  });

  it("allows 'advance' through when metricsVerified=true", async () => {
    const result = await orchestrateWorkflow({
      workflowName: "test-wf",
      phases,
      currentPhase: "plan",
      completedPhases: [],
      projectContext: makeContext(true),
    });

    expect(result.action).toBe("advance");
  });

  it("does not block 'wait' regardless of metricsVerified", async () => {
    _mockContent.value = '{"action":"wait","reasoning":"blocked on CI"}';

    const result = await orchestrateWorkflow({
      workflowName: "test-wf",
      phases,
      currentPhase: "plan",
      completedPhases: [],
      projectContext: makeContext(false),
    });

    expect(result.action).toBe("wait");
    // The "blocked on CI" reasoning must pass through — this is a genuine wait,
    // not a gate-forced one. (Gate-forced waits say "Metrics gate: ...")
    expect(result.reasoning).toBe("blocked on CI");
  });

  it("does not block 'fail' regardless of metricsVerified", async () => {
    _mockContent.value = '{"action":"fail","reasoning":"build error"}';

    const result = await orchestrateWorkflow({
      workflowName: "test-wf",
      phases,
      currentPhase: "build",
      completedPhases: ["plan"],
      projectContext: makeContext(false),
    });

    expect(result.action).toBe("fail");
  });
});
