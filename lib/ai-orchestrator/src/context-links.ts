import type { LoadedProjectContext } from "./context-loader.js";
import type {
  ContextLink,
  ContextLinkSource,
} from "./context-contract.js";

export const CONTEXT_LINK_LIMITS = {
  perTurn: 48,
  perAnchor: 12,
  sourceRefsPerLink: 8,
  maxPathLength: 256,
  maxReasonLength: 160,
} as const;

function relativePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  if (
    !normalized ||
    normalized.length > CONTEXT_LINK_LIMITS.maxPathLength ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) return undefined;
  return normalized;
}

function link(
  anchor: string,
  source: ContextLinkSource,
  direction: ContextLink["direction"],
  reason: string,
  refs: string[],
  options: Partial<Pick<ContextLink, "status" | "freshness" | "confidence" | "layer" | "failureCode">> = {},
): ContextLink {
  return {
    anchor: anchor.slice(0, 160),
    source,
    layer: options.layer ?? "derived",
    direction,
    status: options.status ?? "loaded",
    freshness: options.freshness ?? "fresh",
    rowCount: 1,
    loadedAt: Date.now(),
    admissionDecision: "ADMIT",
    lifetimeStage: "fresh",
    linkReason: reason.slice(0, CONTEXT_LINK_LIMITS.maxReasonLength),
    sourceRefs: [...new Set(refs)].slice(0, CONTEXT_LINK_LIMITS.sourceRefsPerLink),
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    ...(options.failureCode ? { failureCode: options.failureCode } : {}),
  };
}

function addBounded(
  links: ContextLink[],
  perAnchor: Map<string, number>,
  candidate: ContextLink,
): void {
  if (links.length >= CONTEXT_LINK_LIMITS.perTurn) return;
  const count = perAnchor.get(candidate.anchor) ?? 0;
  if (count >= CONTEXT_LINK_LIMITS.perAnchor) return;
  const signature = `${candidate.anchor}|${candidate.source}|${candidate.direction}|${candidate.sourceRefs.join(",")}`;
  if (links.some((existing) =>
    `${existing.anchor}|${existing.source}|${existing.direction}|${existing.sourceRefs.join(",")}` === signature
  )) return;
  links.push(candidate);
  perAnchor.set(candidate.anchor, count + 1);
}

/**
 * Build deterministic links solely from server-loaded, project-scoped rows.
 * Planner suggestions and session memory are intentionally not inputs.
 */
export function buildContextLinks(loaded: LoadedProjectContext): ContextLink[] {
  const links: ContextLink[] = [];
  const perAnchor = new Map<string, number>();
  const entitiesByPath = new Map<string, Array<{ id: string; confidence: number | undefined }>>();
  for (const entity of loaded.entities) {
    const path = relativePath(entity.path);
    if (!path) continue;
    const existing = entitiesByPath.get(path) ?? [];
    existing.push({ id: entity.id, confidence: entity.confidence ?? undefined });
    entitiesByPath.set(path, existing);
  }

  const eventsByTask = new Map<string, number>();
  const eventsByWorkflow = new Map<string, number>();
  for (const event of loaded.recentEvents) {
    if (event.taskId) eventsByTask.set(event.taskId, (eventsByTask.get(event.taskId) ?? 0) + 1);
    if (event.workflowId) eventsByWorkflow.set(event.workflowId, (eventsByWorkflow.get(event.workflowId) ?? 0) + 1);
  }

  for (const task of loaded.rawTasks) {
    const anchor = `task:${task.id}`;
    for (const rawPath of task.relatedFiles) {
      const path = relativePath(rawPath);
      if (!path) continue;
      const refs = [anchor, `file:${path}`];
      addBounded(links, perAnchor, link(
        anchor,
        "file",
        "outbound",
        "Task declares this project-relative file.",
        refs,
        { layer: "direct" },
      ));
      for (const entity of entitiesByPath.get(path) ?? []) {
        addBounded(links, perAnchor, link(
          anchor,
          "graph",
          "outbound",
          "Task file resolves to a project-owned graph entity.",
          [...refs, `graph:${entity.id}`],
          { confidence: entity.confidence, layer: "derived" },
        ));
      }
    }
    if ((eventsByTask.get(task.id) ?? 0) > 0) {
      addBounded(links, perAnchor, link(
        anchor,
        "event",
        "related",
        "Recent project event references this task.",
        [anchor, `event:task:${task.id}`],
        { layer: "derived" },
      ));
    }
  }

  for (const workflow of loaded.rawWorkflows) {
    const anchor = `workflow:${workflow.id}`;
    if ((eventsByWorkflow.get(workflow.id) ?? 0) > 0) {
      addBounded(links, perAnchor, link(
        anchor,
        "event",
        "related",
        "Recent project event references this workflow.",
        [anchor, `event:workflow:${workflow.id}`],
        { layer: "derived" },
      ));
    }
    for (const phase of Array.isArray(workflow.phases) ? workflow.phases.slice(0, 12) : []) {
      const phaseName = typeof phase?.name === "string" ? phase.name.slice(0, 80) : "";
      if (!phaseName) continue;
      addBounded(links, perAnchor, link(
        anchor,
        "workflow",
        "outbound",
        `Workflow phase "${phaseName}" is part of this project workflow.`,
        [anchor, `phase:${phaseName}`],
        { layer: "direct" },
      ));
    }
  }

  const metricMeta = loaded.sliceMetadata.get("metrics");
  if (loaded.latestMetric && metricMeta?.status === "loaded") {
    addBounded(links, perAnchor, link(
      "project",
      "metric",
      "related",
      "Latest metric snapshot belongs to the current project context.",
      ["project", "metric:latest"],
      { layer: "direct" },
    ));
  }
  const scanMeta = loaded.sliceMetadata.get("project");
  if (loaded.scanVerified && scanMeta?.status === "loaded") {
    addBounded(links, perAnchor, link(
      "project",
      "scan",
      "related",
      "Completed scan establishes the current project evidence baseline.",
      ["project", "scan:latest"],
      { layer: "direct" },
    ));
  }
  return links;
}

export function contextLinkCollection(links: readonly ContextLink[]) {
  return {
    page: 1,
    pageSize: CONTEXT_LINK_LIMITS.perTurn,
    returnedCount: Math.min(links.length, CONTEXT_LINK_LIMITS.perTurn),
    totalKnown: false,
    hasMore: links.length >= CONTEXT_LINK_LIMITS.perTurn,
    truncated: links.length >= CONTEXT_LINK_LIMITS.perTurn,
  } as const;
}