/**
 * Task 174 — Golden Repair Matrix.
 *
 * These cases deliberately exercise the repair state machine with hostile or
 * interrupted child behavior. They do not call a live provider: every
 * terminal result is derived from server-owned validation, cancellation, or
 * patch evidence.
 */

import { describe, expect, it } from "vitest";
import { rebasePatchHunks } from "../patch-contract.js";
import {
  executeExecutionNodePlan,
  type ExecutionNodeOutcome,
} from "../execution-node-coordinator.js";
import type { ExecutionNode } from "../task-session-state.js";
import { EXECUTION_LIMITS, runBoundedCommand } from "../execution-kernel.js";

function node(
  id: string,
  overrides: Partial<ExecutionNode> = {},
): ExecutionNode {
  return {
    id,
    title: id,
    status: "queued",
    allowedFiles: [`src/${id}.ts`],
    dependencies: [],
    validationProfile: "ai-orchestrator-tests",
    attempts: 0,
    validationAttempts: 0,
    ...overrides,
  };
}

function pass(detail = "validation evidence passed"): ExecutionNodeOutcome {
  return { status: "passed", detail };
}

describe("Task 174 — Golden Repair Matrix", () => {
  it("recovers an interrupted repair, learns from failure, and only then reaches passed", async () => {
    const events: string[] = [];
    const failures: Array<{ attempt: number; detail: string } | undefined> = [];
    const result = await executeExecutionNodePlan({
      nodes: [node("repair", { status: "running", attempts: 1 })],
      runNode: async (_current, context) => {
        failures.push(context.previousFailure);
        return context.attempt === 2
          ? pass("repair validation passed after recovery")
          : { status: "failed", detail: "validation failed" };
      },
      onChange: ({ event, nodeId }) => events.push(`${event}:${nodeId ?? "plan"}`),
    });

    expect(result.status).toBe("passed");
    expect(result.nodes[0]).toMatchObject({ status: "passed", attempts: 2 });
    expect(failures).toEqual([undefined]);
    expect(events).toEqual([
      "recovered:repair",
      "retry_queued:repair",
      "started:repair",
      "passed:repair",
    ]);
  });

  it("never converts repeated validation failure into false success", async () => {
    const outcomes: string[] = [];
    const result = await executeExecutionNodePlan({
      nodes: [node("false-success")],
      runNode: async () => ({ status: "failed", detail: "validation still failed" }),
      onChange: ({ event, nodeId }) => {
        if (event === "passed" || event === "blocked") outcomes.push(`${event}:${nodeId}`);
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.nodes[0]).toMatchObject({ status: "blocked", attempts: 3 });
    expect(outcomes).toEqual(["blocked:false-success"]);
    expect(result.completedNodeIds).toEqual([]);
  });

  it("preserves in-flight work for recovery when cancellation interrupts a wave", async () => {
    const controller = new AbortController();
    let childStarted = false;
    const resultPromise = executeExecutionNodePlan({
      nodes: [node("cancelled")],
      signal: controller.signal,
      runNode: async () => {
        childStarted = true;
        controller.abort();
        return pass("late provider response must not prove success");
      },
    });

    const result = await resultPromise;
    expect(childStarted).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(result.nodes[0]).toMatchObject({ status: "running", attempts: 1 });
    expect(result.completedNodeIds).toEqual([]);
  });

  it("does not start queued work after cancellation is already requested", async () => {
    const controller = new AbortController();
    controller.abort();
    let runCount = 0;

    const result = await executeExecutionNodePlan({
      nodes: [node("never-started")],
      signal: controller.signal,
      runNode: async () => {
        runCount += 1;
        return pass();
      },
    });

    expect(result).toMatchObject({
      status: "cancelled",
      completedNodeIds: [],
      blockedNodeIds: [],
    });
    expect(runCount).toBe(0);
    expect(result.nodes[0]?.status).toBe("queued");
  });

  it("blocks dependent work when an adversarial prerequisite cannot be proven", async () => {
    const started: string[] = [];
    const result = await executeExecutionNodePlan({
      nodes: [
        node("evidence", { allowedFiles: ["src/evidence.ts"] }),
        node("apply", { allowedFiles: ["src/apply.ts"], dependencies: ["evidence"] }),
      ],
      runNode: async (current) => {
        started.push(current.id);
        return { status: "blocked", detail: "required evidence unavailable" };
      },
    });

    expect(result.status).toBe("blocked");
    expect(started).toEqual(["evidence"]);
    expect(result.blockedNodeIds).toEqual(["evidence", "apply"]);
    expect(result.nodes.find((candidate) => candidate.id === "apply")?.status).toBe("blocked");
  });

  it("fails closed on an ambiguous drift conflict instead of overwriting user edits", () => {
    const result = rebasePatchHunks(
      "export const value = 1;\nexport const value = 1;\n",
      [{
        startLine: 1,
        endLine: 1,
        expectedText: "export const value = 1;",
        replacementText: "export const value = 2;",
        reason: "approved repair",
      }],
    );

    expect(result).toMatchObject({
      ok: false,
      kind: "hunk_mismatch",
    });
  });

  it("contains timeout output and never treats a timed-out command as validation success", async () => {
    const result = await runBoundedCommand({
      command: "node",
      args: ["-e", "process.stdout.write('x'.repeat(100000)); setTimeout(() => {}, 10000)"],
      rootPath: process.cwd(),
      allowedCommands: new Set(["node"]),
      timeoutMs: 50,
      maxOutputBytes: 1_000,
    });

    expect(["timed_out", "failed"]).toContain(result.status);
    expect(result.status).not.toBe("passed");
    expect(Buffer.byteLength(result.combinedOutput, "utf8")).toBeLessThanOrEqual(1_000);
    // Timeout may win before the first output chunk; either way the output
    // remains bounded and the result cannot become validation proof.
    expect(typeof result.truncated).toBe("boolean");
  });

  it("propagates cancellation into the bounded command boundary", async () => {
    const controller = new AbortController();
    const resultPromise = runBoundedCommand({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"],
      rootPath: process.cwd(),
      allowedCommands: new Set(["node"]),
      timeoutMs: 2_000,
      maxOutputBytes: 100,
      signal: controller.signal,
    });

    controller.abort();
    const result = await resultPromise;
    expect(result.status).toBe("cancelled");
    expect(EXECUTION_LIMITS.maxTimeoutMs).toBe(1_800_000);
  });
});