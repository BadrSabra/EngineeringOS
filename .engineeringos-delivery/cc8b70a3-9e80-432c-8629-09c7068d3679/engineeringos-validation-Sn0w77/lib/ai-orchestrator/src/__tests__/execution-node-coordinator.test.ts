import { describe, expect, it } from "vitest";
import {
  executeExecutionNodePlan,
  type ExecutionNodeOutcome,
} from "../execution-node-coordinator.js";
import type { ExecutionNode } from "../task-session-state.js";

function makeNode(
  id: string,
  allowedFiles: string[],
  dependencies: string[] = [],
  overrides: Partial<ExecutionNode> = {},
): ExecutionNode {
  return {
    id,
    title: id,
    status: "queued",
    allowedFiles,
    dependencies,
    validationProfile: "ai-orchestrator-tests",
    attempts: 0,
    validationAttempts: 0,
    ...overrides,
  };
}

function successful(): ExecutionNodeOutcome {
  return { status: "passed", detail: "validation passed" };
}

describe("executeExecutionNodePlan", () => {
  it("runs independent disjoint nodes in parallel and records every transition", async () => {
    const snapshots: string[] = [];
    let active = 0;
    let maxActive = 0;

    const result = await executeExecutionNodePlan({
      nodes: [
        makeNode("A", ["src/a.ts"]),
        makeNode("B", ["src/b.ts"]),
        makeNode("C", ["src/c.ts"]),
      ],
      maxParallelNodes: 2,
      runNode: async (node) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 8));
        active -= 1;
        return { ...successful(), detail: `${node.id} validated` };
      },
      onChange: ({ nodes, event, nodeId }) => {
        snapshots.push(`${event}:${nodeId ?? "plan"}:${nodes.map((node) => node.status).join(",")}`);
      },
    });

    expect(result.status).toBe("passed");
    expect(maxActive).toBe(2);
    expect(result.completedNodeIds).toEqual(["A", "B", "C"]);
    expect(snapshots.some((snapshot) => snapshot.startsWith("started:A"))).toBe(true);
    expect(snapshots.some((snapshot) => snapshot.startsWith("passed:C"))).toBe(true);
  });

  it("waits for dependencies and blocks dependents after a terminal child failure", async () => {
    const runIds: string[] = [];
    const result = await executeExecutionNodePlan({
      nodes: [
        makeNode("blocked-parent", ["src/a.ts"]),
        makeNode("independent", ["src/b.ts"]),
        makeNode("dependent", ["src/c.ts"], ["blocked-parent"]),
      ],
      runNode: async (node) => {
        runIds.push(node.id);
        return node.id === "blocked-parent"
          ? { status: "blocked", detail: "required evidence unavailable" }
          : successful();
      },
    });

    expect(result.status).toBe("blocked");
    expect(runIds).toEqual(["blocked-parent", "independent"]);
    expect(result.completedNodeIds).toEqual(["independent"]);
    expect(result.blockedNodeIds).toEqual(["blocked-parent", "dependent"]);
    expect(result.nodes.find((node) => node.id === "dependent")?.status).toBe("blocked");
  });

  it("retries a failed child without preventing later independent work", async () => {
    const attempts: number[] = [];
    const previousFailures: Array<{ attempt: number; detail: string } | undefined> = [];
    const retryEvents: Array<{ attempt?: number; validationAttempts?: number }> = [];
    const result = await executeExecutionNodePlan({
      nodes: [
        makeNode("flaky", ["src/flaky.ts"]),
        makeNode("stable", ["src/stable.ts"]),
      ],
      maxParallelNodes: 1,
      runNode: async (node, context) => {
        if (node.id === "flaky") {
          attempts.push(context.attempt);
          previousFailures.push(context.previousFailure);
          return context.attempt < 3
            ? { status: "failed", detail: "validation failed" }
            : successful();
        }
        return successful();
      },
      onChange: ({ event, nodeId, attempt, validationAttempts }) => {
        if (event === "retry_queued" && nodeId === "flaky") {
          retryEvents.push({ attempt, validationAttempts });
        }
      },
    });

    expect(result.status).toBe("passed");
    expect(attempts).toEqual([1, 2, 3]);
    expect(previousFailures).toEqual([
      undefined,
      { attempt: 1, detail: "validation failed" },
      { attempt: 2, detail: "validation failed" },
    ]);
    expect(retryEvents).toEqual([
      { attempt: 1, validationAttempts: 0 },
      { attempt: 2, validationAttempts: 0 },
    ]);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "flaky", status: "passed", attempts: 3 }),
      expect.objectContaining({ id: "stable", status: "passed", attempts: 1 }),
    ]));
  });

  it("blocks a child after three failures and never reports plan success", async () => {
    let calls = 0;
    const result = await executeExecutionNodePlan({
      nodes: [makeNode("always-fails", ["src/failing.ts"])],
      runNode: async () => {
        calls += 1;
        return { status: "failed", detail: "same validation failure" };
      },
    });

    expect(calls).toBe(3);
    expect(result.status).toBe("blocked");
    expect(result.blockedNodeIds).toEqual(["always-fails"]);
    expect(result.nodes[0]).toMatchObject({
      status: "blocked",
      attempts: 3,
      lastFailure: {
        status: "failed",
        attempt: 3,
        validationAttempts: 0,
        detail: "same validation failure",
      },
    });
  });

  it("restores bounded failure context when resuming a failed node", async () => {
    const contexts: Array<{ attempt: number; previousFailure?: { attempt: number; detail: string } }> = [];
    const result = await executeExecutionNodePlan({
      nodes: [
        makeNode("resumed", ["src/resumed.ts"], [], {
          status: "failed",
          attempts: 1,
          lastFailure: {
            status: "failed",
            attempt: 1,
            validationAttempts: 1,
            detail: "bounded validation failure",
          },
        }),
      ],
      runNode: async (_node, context) => {
        contexts.push(context);
        return successful();
      },
    });

    expect(result.status).toBe("passed");
    expect(contexts).toEqual([{
      attempt: 2,
      previousFailure: {
        attempt: 1,
        detail: "bounded validation failure",
      },
    }]);
    expect(result.nodes[0]).not.toHaveProperty("lastFailure");
  });

  it("recovers running and failed nodes from a durable checkpoint", async () => {
    const recovered: string[] = [];
    const result = await executeExecutionNodePlan({
      nodes: [
        makeNode("interrupted", ["src/a.ts"], [], { status: "running", attempts: 1 }),
        makeNode("failed", ["src/b.ts"], [], { status: "failed", attempts: 2 }),
        makeNode("exhausted", ["src/c.ts"], [], { status: "failed", attempts: 3 }),
      ],
      runNode: async (node) => {
        recovered.push(node.id);
        return successful();
      },
      onChange: ({ event, nodeId }) => {
        if (event === "recovered" || event === "retry_queued") recovered.push(`${event}:${nodeId}`);
      },
    });

    expect(result.status).toBe("blocked");
    expect(recovered).toEqual(expect.arrayContaining([
      "recovered:interrupted",
      "retry_queued:interrupted",
      "retry_queued:failed",
      "interrupted",
      "failed",
    ]));
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "interrupted", status: "passed", attempts: 2 }),
      expect.objectContaining({ id: "failed", status: "passed", attempts: 3 }),
      expect.objectContaining({ id: "exhausted", status: "blocked", attempts: 3 }),
    ]));
  });

  it("returns cancelled without starting queued work when cancellation is already requested", async () => {
    const controller = new AbortController();
    controller.abort();
    let runCount = 0;

    const result = await executeExecutionNodePlan({
      nodes: [makeNode("queued", ["src/a.ts"])],
      signal: controller.signal,
      runNode: async () => {
        runCount += 1;
        return successful();
      },
    });

    expect(result.status).toBe("cancelled");
    expect(runCount).toBe(0);
    expect(result.nodes[0].status).toBe("queued");
  });

  it("preserves running nodes for recovery when cancellation arrives during a wave", async () => {
    const controller = new AbortController();
    let started = false;
    const resultPromise = executeExecutionNodePlan({
      nodes: [makeNode("in-flight", ["src/a.ts"])],
      signal: controller.signal,
      runNode: async () => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return successful();
      },
    });

    const result = await resultPromise;
    expect(started).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(result.nodes[0]).toMatchObject({ status: "running", attempts: 1 });
  });
});