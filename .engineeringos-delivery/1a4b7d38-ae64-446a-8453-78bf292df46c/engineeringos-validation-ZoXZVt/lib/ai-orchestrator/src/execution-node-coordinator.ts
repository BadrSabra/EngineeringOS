import {
  ExecutionNodeSchema,
  getRunnableExecutionNodes,
  transitionExecutionNode,
  type ExecutionNode,
} from "./task-session-state.js";
import { MAX_REPAIR_ATTEMPTS } from "./tools/execution-tools.js";

export type ExecutionNodeOutcome = {
  /**
   * `passed` must only be returned after the caller has observed the required
   * validation evidence. The coordinator never infers success from a callback
   * resolving or from an HTTP response.
   */
  status: Extract<ExecutionNode["status"], "passed" | "failed" | "blocked">;
  detail?: string;
  /** Number of validation calls consumed by this child loop. */
  validationAttempts?: number;
};

export type ExecutionNodeRunContext = {
  attempt: number;
  signal?: AbortSignal;
  /**
   * Bounded server-owned context from the previous failed attempt. This is
   * intentionally separate from the node definition: retries may learn from a
   * validation failure, but they may not expand the approved scope or rewrite
   * the plan.
   */
  previousFailure?: {
    attempt: number;
    detail: string;
  };
};

export type ExecutionNodeCoordinatorEvent =
  | "recovered"
  | "started"
  | "passed"
  | "failed"
  | "retry_queued"
  | "blocked"
  | "cancelled";

export type ExecutionNodeCoordinatorOptions = {
  nodes: readonly ExecutionNode[];
  runNode: (
    node: ExecutionNode,
    context: ExecutionNodeRunContext,
  ) => Promise<ExecutionNodeOutcome>;
  maxParallelNodes?: number;
  signal?: AbortSignal;
  onChange?: (args: {
    nodes: ExecutionNode[];
    event: ExecutionNodeCoordinatorEvent;
    nodeId?: string;
    attempt?: number;
    validationAttempts?: number;
    detail?: string;
  }) => void;
};

export type ExecutionNodeCoordinatorResult = {
  nodes: ExecutionNode[];
  status: "passed" | "blocked" | "cancelled";
  completedNodeIds: string[];
  blockedNodeIds: string[];
};

const DEFAULT_MAX_PARALLEL_NODES = 3;
const MAX_PARALLEL_NODES = 8;
const TERMINAL_STATUSES = new Set<ExecutionNode["status"]>(["passed", "blocked"]);

function emit(
  opts: ExecutionNodeCoordinatorOptions,
  nodes: ExecutionNode[],
  event: ExecutionNodeCoordinatorEvent,
  nodeId?: string,
  detail?: string,
): void {
  try {
    const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) : undefined;
    opts.onChange?.({
      nodes,
      event,
      ...(nodeId ? { nodeId } : {}),
      ...(node ? { attempt: node.attempts, validationAttempts: node.validationAttempts } : {}),
      ...(detail ? { detail } : {}),
    });
  } catch {
    // Progress observers must not change execution semantics.
  }
}

function setLastFailure(
  nodes: ExecutionNode[],
  nodeId: string,
  status: "failed" | "blocked",
  detail: string,
): ExecutionNode[] {
  return nodes.map((node) => node.id === nodeId
    ? ExecutionNodeSchema.parse({
        ...node,
        lastFailure: {
          status,
          attempt: Math.max(1, node.attempts),
          validationAttempts: node.validationAttempts,
          detail: detail.slice(0, 4_000),
        },
      })
    : node);
}

function clearLastFailure(nodes: ExecutionNode[], nodeId: string): ExecutionNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const { lastFailure: _lastFailure, ...withoutFailure } = node;
    return ExecutionNodeSchema.parse(withoutFailure);
  });
}

function clampParallelism(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_PARALLEL_NODES;
  return Math.max(1, Math.min(Math.floor(value as number), MAX_PARALLEL_NODES));
}

function updateNode(
  nodes: ExecutionNode[],
  nodeId: string,
  nextStatus: ExecutionNode["status"],
): ExecutionNode[] {
  return transitionExecutionNode(nodes, nodeId, nextStatus);
}

function recordValidationAttempts(
  nodes: ExecutionNode[],
  nodeId: string,
  consumed: number | undefined,
): ExecutionNode[] {
  if (!Number.isInteger(consumed) || consumed === undefined || consumed <= 0) return nodes;
  return nodes.map((node) => node.id === nodeId
    ? ExecutionNodeSchema.parse({
        ...node,
        validationAttempts: Math.min(
          MAX_REPAIR_ATTEMPTS,
          node.validationAttempts + consumed,
        ),
      })
    : node);
}

function transitionToBlocked(
  nodes: ExecutionNode[],
  nodeId: string,
  opts: ExecutionNodeCoordinatorOptions,
  detail: string,
): ExecutionNode[] {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.status === "blocked" || node.status === "passed") return nodes;
  const next = updateNode(nodes, nodeId, "blocked");
  emit(opts, next, "blocked", nodeId, detail);
  return next;
}

/**
 * Recover a plan after a process restart or a previously interrupted worker.
 * A node that was running never wrote directly to the workspace in this
 * execution model, so it is safe to retry it from its bounded attempt count.
 */
function recoverInterruptedNodes(
  initialNodes: readonly ExecutionNode[],
  opts: ExecutionNodeCoordinatorOptions,
): ExecutionNode[] {
  let nodes = initialNodes.map((node) => ({ ...node }));
  for (const node of [...nodes]) {
    if (node.status === "running") {
      nodes = updateNode(nodes, node.id, "failed");
      emit(opts, nodes, "recovered", node.id, "running node recovered after interruption");
       if (node.attempts < MAX_REPAIR_ATTEMPTS) {
        nodes = updateNode(nodes, node.id, "queued");
        emit(opts, nodes, "retry_queued", node.id, "recovered node returned to the queue");
      } else {
        nodes = transitionToBlocked(nodes, node.id, opts, "recovered node exhausted its attempt budget");
      }
    } else if (node.status === "failed") {
       if (node.attempts < MAX_REPAIR_ATTEMPTS) {
        nodes = updateNode(nodes, node.id, "queued");
        emit(opts, nodes, "retry_queued", node.id, "failed node returned to the queue");
      } else {
        nodes = transitionToBlocked(nodes, node.id, opts, "failed node exhausted its attempt budget");
      }
    }
  }
  return nodes;
}

/**
 * Block queued nodes whose dependency can no longer pass. Unknown dependency
 * IDs are also blocked instead of leaving the execution permanently queued.
 */
function blockImpossibleNodes(
  initialNodes: ExecutionNode[],
  opts: ExecutionNodeCoordinatorOptions,
): ExecutionNode[] {
  let nodes = initialNodes;
  const ids = new Set(nodes.map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of [...nodes]) {
      if (node.status !== "queued") continue;
      const impossibleDependency = node.dependencies.find((dependency) => {
        const dependencyNode = nodes.find((candidate) => candidate.id === dependency);
        return !ids.has(dependency) || dependencyNode?.status === "blocked";
      });
      if (impossibleDependency) {
        nodes = transitionToBlocked(
          nodes,
          node.id,
          opts,
          `dependency ${impossibleDependency} cannot pass`,
        );
        changed = true;
      }
    }
  }
  return nodes;
}

function blockStalledNodes(
  initialNodes: ExecutionNode[],
  opts: ExecutionNodeCoordinatorOptions,
): ExecutionNode[] {
  let nodes = initialNodes;
  for (const node of [...nodes]) {
    if (node.status === "queued") {
      nodes = transitionToBlocked(
        nodes,
        node.id,
        opts,
        "node could not become runnable because its dependency graph is stalled",
      );
    }
  }
  return nodes;
}

/**
 * Execute a server-owned plan with bounded, dependency-aware parallelism.
 *
 * The callback is the only place where a child does real work. It must return
 * `passed` only after validation has actually passed. The coordinator owns all
 * node transitions, retries, dependency blocking, and progress snapshots.
 */
export async function executeExecutionNodePlan(
  opts: ExecutionNodeCoordinatorOptions,
): Promise<ExecutionNodeCoordinatorResult> {
  const maxParallelNodes = clampParallelism(opts.maxParallelNodes);
  const previousFailures = new Map<string, ExecutionNodeRunContext["previousFailure"]>();
  for (const node of opts.nodes) {
    if (node.lastFailure) {
      previousFailures.set(node.id, {
        attempt: node.lastFailure.attempt,
        detail: node.lastFailure.detail,
      });
    }
  }
  let nodes = recoverInterruptedNodes(opts.nodes, opts);

  while (true) {
    nodes = blockImpossibleNodes(nodes, opts);

    if (opts.signal?.aborted) {
      emit(opts, nodes, "cancelled", undefined, "execution cancellation requested");
      return {
        nodes,
        status: "cancelled",
        completedNodeIds: nodes.filter((node) => node.status === "passed").map((node) => node.id),
        blockedNodeIds: nodes.filter((node) => node.status === "blocked").map((node) => node.id),
      };
    }

    if (nodes.every((node) => TERMINAL_STATUSES.has(node.status))) break;

    const runnable = getRunnableExecutionNodes(nodes);
    if (runnable.length === 0) {
      nodes = blockStalledNodes(nodes, opts);
      break;
    }

    const wave = runnable.slice(0, maxParallelNodes);
    for (const node of wave) {
      nodes = updateNode(nodes, node.id, "running");
      emit(opts, nodes, "started", node.id);
    }

    const outcomes = await Promise.all(wave.map(async (node) => {
      try {
        return {
          node,
          outcome: await opts.runNode(node, {
            attempt: node.attempts + 1,
            signal: opts.signal,
            ...(previousFailures.get(node.id)
              ? { previousFailure: previousFailures.get(node.id) }
              : {}),
          }),
        };
      } catch (error) {
        return {
          node,
          outcome: {
            status: "failed" as const,
            detail: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }));

    // A cancelled child may reject or return a partial result after the
    // provider observes the abort signal. Preserve the running snapshot so a
    // later resume can recover it; cancellation is not a proof that the node
    // is blocked or failed.
    if (opts.signal?.aborted) {
      emit(opts, nodes, "cancelled", undefined, "execution cancellation requested during wave");
      return {
        nodes,
        status: "cancelled",
        completedNodeIds: nodes.filter((node) => node.status === "passed").map((node) => node.id),
        blockedNodeIds: nodes.filter((node) => node.status === "blocked").map((node) => node.id),
      };
    }

    for (const { node, outcome } of outcomes) {
      const current = nodes.find((candidate) => candidate.id === node.id);
      if (!current || current.status !== "running") continue;
      nodes = recordValidationAttempts(nodes, node.id, outcome.validationAttempts);

      if (outcome.status === "passed") {
        nodes = clearLastFailure(updateNode(nodes, node.id, "passed"), node.id);
        emit(opts, nodes, "passed", node.id, outcome.detail);
      } else if (outcome.status === "blocked") {
        nodes = updateNode(nodes, node.id, "blocked");
        if (outcome.detail) nodes = setLastFailure(nodes, node.id, "blocked", outcome.detail);
        emit(opts, nodes, "blocked", node.id, outcome.detail);
      } else {
        nodes = updateNode(nodes, node.id, "failed");
        nodes = setLastFailure(
          nodes,
          node.id,
          "failed",
          outcome.detail ?? "The execution node failed.",
        );
        emit(opts, nodes, "failed", node.id, outcome.detail);
        const failed = nodes.find((candidate) => candidate.id === node.id);
        if (
          failed &&
          failed.attempts < MAX_REPAIR_ATTEMPTS &&
          failed.validationAttempts < MAX_REPAIR_ATTEMPTS &&
          !opts.signal?.aborted
        ) {
          previousFailures.set(node.id, {
            attempt: failed.attempts,
            detail: (outcome.detail ?? "The previous execution attempt failed.").slice(0, 4_000),
          });
          nodes = updateNode(nodes, node.id, "queued");
          emit(opts, nodes, "retry_queued", node.id, outcome.detail);
        } else {
          nodes = transitionToBlocked(
            nodes,
            node.id,
            opts,
            outcome.detail ?? "node failed after its bounded attempts",
          );
        }
      }
    }
  }

  const hasBlocked = nodes.some((node) => node.status === "blocked");
  return {
    nodes,
    status: hasBlocked ? "blocked" : "passed",
    completedNodeIds: nodes.filter((node) => node.status === "passed").map((node) => node.id),
    blockedNodeIds: nodes.filter((node) => node.status === "blocked").map((node) => node.id),
  };
}