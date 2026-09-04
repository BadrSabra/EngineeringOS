/**
 * Context Builder — pure coordinator.
 *
 * Pipeline:
 *   cache lookup → load (context-loader)
 *               → serialize (context-serializer)
 *               → wrap as ContextSlices
 *               → admit (context-admission)
 *               → assemble ProjectContext
 *               → cache
 *
 * This module owns NO ranking, sizing, or trimming rules.
 * All budget enforcement is delegated to the Admission Engine.
 */
import { randomUUID } from "node:crypto";
import type { AgentContext } from "./schemas/context.schema.js";
import { parseAgentContext } from "./schemas/context.schema.js";
import { buildContextCacheKey, getCachedContext, setCachedContext, hashExecutionPlan, type ContextCacheRuntime } from "./context-cache-manager.js";
import { loadProjectContext, type BuildProjectContextOptions, type ContextLoadSection } from "./context-loader.js";
import { buildProjectContextFromLoadedContext } from "./context-serializer.js";
import { resolveExecutionDecision } from "./model-selection/decision-engine.js";
import type { ExecutionPlan } from "./model-selection/execution-plan.js";
import {
  buildSlice,
  type ContextPlan,
  type ContextAdmissionIdentity,
  type SliceId,
  type AdmissionDecision,
  type ContextObject,
} from "./context-runtime/context-object.js";
import { runAdmission } from "./context-runtime/context-admission.js";
import { applyLifetime, DEFAULT_LIFETIME_POLICY, type LifetimePolicy, type SliceLifetimeState } from "./context-runtime/context-lifetime.js";
import { trimContextToFit, warnIfContextTooLarge } from "./context-compressor.js";
import { buildContextLinks, contextLinkCollection } from "./context-links.js";
import { projectContextProvenance } from "./context-provenance.js";
import { getFullAuthorizedToolManifest } from "./tool-policy.js";
import type { ContextIntent } from "./context-contract.js";
import { CONTEXT_SCHEMA_VERSION } from "./context-contract.js";

export { invalidateContextCache, invalidateContextSlice, hashExecutionPlan, setInvalidationNotifier, startContextInvalidationChannel } from "./context-cache-manager.js";
export type { BuildProjectContextOptions, ContextLoadSection } from "./context-loader.js";

/** The context object every agent prompt is built from. Shape enforced by AgentContextSchema. */
export type ProjectContext = AgentContext;

/**
 * Extended options that add an optional ExecutionPlan for budget-aware admission.
 * Fully backward-compatible: existing callers that pass only { sections: [...] }
 * receive normal-intensity admission by default.
 */
export type BuildContextOptions = BuildProjectContextOptions & {
  /** Execution plan controlling context depth and token budgets. Defaults to normal intensity. */
  plan?: Readonly<ExecutionPlan>;
  /** Optional per-slice age policy; defaults to the runtime policy. */
  lifetimePolicy?: LifetimePolicy;
  /** Deterministic size override for callers and validation. */
  maxChars?: number;
  /** Server-owned turn identity. Generated only for direct library callers. */
  operationId?: string;
  /** Server-owned resolved intent; never inferred from augmented prompt text. */
  intent?: ContextIntent;
  /** Server-owned available subset; the full manifest remains immutable. */
  availableToolNames?: readonly string[];
  /** Server-owned source root used to bind cached and admitted context. */
  sourceRoot?: string;
};

// ─── Slice configuration ──────────────────────────────────────────────────────

/** Maps a SliceId to the corresponding key in the loader's sliceMetadata map. */
const SLICE_TO_LOADER_KEY: Record<SliceId, ContextLoadSection | "project"> = {
  project:       "project",
  recentTasks:   "tasks",
  latestMetrics: "metrics",
  graphSummary:  "graphEntities",   // graph entities + relationships → one slice
  recentEvents:  "events",
  workflows:     "workflows",
};

/** Maps a loader ContextLoadSection to the SliceId it contributes to. */
const SECTION_TO_SLICE: Partial<Record<ContextLoadSection, SliceId>> = {
  tasks:              "recentTasks",
  metrics:            "latestMetrics",
  graphEntities:      "graphSummary",
  graphRelationships: "graphSummary",
  events:             "recentEvents",
  workflows:          "workflows",
};

/** Ordered list of string fields that become ContextSlices. */
const SLICE_FIELDS: Array<{ id: SliceId; key: keyof ProjectContext }> = [
  { id: "project",       key: "project" },
  { id: "recentTasks",   key: "recentTasks" },
  { id: "latestMetrics", key: "latestMetrics" },
  { id: "graphSummary",  key: "graphSummary" },
  { id: "recentEvents",  key: "recentEvents" },
  { id: "workflows",     key: "workflows" },
];

// ─── Admission assembly ───────────────────────────────────────────────────────

const REFERENCE_LIMIT = 400; // chars kept for REFERENCE decisions
const LABEL_DEFERRED  = "[section deferred — not included in this context budget]";
const LABEL_DROPPED   = "[section excluded — not relevant for this task type]";

function applyDecision(
  content: string,
  decision: AdmissionDecision,
  healthStatus?: string,
): string {
  // Never turn a failed or skipped query into an ordinary budget label. The
  // model must retain the distinction between unavailable data and no data.
  const preserveHealth = healthStatus === "load_failed" || healthStatus === "not_requested";
  switch (decision) {
    case "ADMIT":
      return content;
    case "REFERENCE":
      return content.length <= REFERENCE_LIMIT
        ? content
        : `${content.slice(0, REFERENCE_LIMIT)}…[brief — see full context for details]`;
    case "DEFER":
      return preserveHealth ? `${content}\n${LABEL_DEFERRED}` : LABEL_DEFERRED;
    case "DROP":
      return preserveHealth ? `${content}\n${LABEL_DROPPED}` : LABEL_DROPPED;
  }
}

const HEALTH_TO_SLICE: Record<string, SliceId> = {
  tasks: "recentTasks",
  metrics: "latestMetrics",
  graphEntities: "graphSummary",
  graphRelationships: "graphSummary",
  events: "recentEvents",
  workflows: "workflows",
};

function assembleContext(
  base: ProjectContext,
  contextObject: ContextObject,
  lifetimeStates: readonly SliceLifetimeState[],
): ProjectContext {
  const sliceMap = new Map(contextObject.plan.slices.map((s) => [s.id, s]));
  const health = base.contextHealth
    ? Object.fromEntries(
        Object.entries(base.contextHealth).map(([section, value]) => {
          const slice = sliceMap.get(HEALTH_TO_SLICE[section] ?? "project");
          const state = lifetimeStates.find((candidate) => candidate.sliceId === slice?.id);
          return [
            section,
            {
              ...value,
              ...(slice ? { admissionDecision: slice.admissionDecision } : {}),
              ...(state ? { lifetimeStage: state.stage } : {}),
              ...(state?.stage === "stale" && value.status === "loaded"
                ? { freshness: "stale" as const }
                : {}),
            },
          ];
        }),
      ) as ProjectContext["contextHealth"]
    : undefined;

  const result: ProjectContext = {
    ...base,
    project: applyDecision(sliceMap.get("project")!.content, sliceMap.get("project")!.admissionDecision),
    recentTasks: applyDecision(
      sliceMap.get("recentTasks")!.content,
      sliceMap.get("recentTasks")!.admissionDecision,
      health?.tasks?.status,
    ),
    latestMetrics: applyDecision(
      sliceMap.get("latestMetrics")!.content,
      sliceMap.get("latestMetrics")!.admissionDecision,
      health?.metrics?.status,
    ),
    graphSummary: applyDecision(
      sliceMap.get("graphSummary")!.content,
      sliceMap.get("graphSummary")!.admissionDecision,
      health?.graphEntities?.status === "load_failed" || health?.graphRelationships?.status === "load_failed"
        ? "load_failed"
        : health?.graphEntities?.status === "not_requested" && health?.graphRelationships?.status === "not_requested"
          ? "not_requested"
          : undefined,
    ),
    recentEvents: applyDecision(
      sliceMap.get("recentEvents")!.content,
      sliceMap.get("recentEvents")!.admissionDecision,
      health?.events?.status,
    ),
    workflows: applyDecision(
      sliceMap.get("workflows")!.content,
      sliceMap.get("workflows")!.admissionDecision,
      health?.workflows?.status,
    ),
    ...(health ? { contextHealth: health } : {}),
  };
  return result;
}

function bindContextIdentity(
  context: ProjectContext,
  options: {
    operationId: string;
    projectId: string;
    requestedSections?: string[];
    intent?: ContextIntent;
    availableToolNames?: readonly string[];
  },
): ProjectContext {
  const bound: ProjectContext = {
    ...context,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    projectId: options.projectId,
    operationId: options.operationId,
    workspaceRevision: context.workspaceRevision ?? context.contextManifest?.projectRevision ?? "unavailable",
    capturedAt: context.capturedAt ?? context.contextManifest?.capturedAt ?? new Date(0).toISOString(),
    requestedSections: options.requestedSections ?? context.requestedSections,
    intent: options.intent ?? context.intent ?? {
      kind: "CHAT",
      phases: [],
      requiresEvidence: false,
    },
    authorizedToolManifest: context.authorizedToolManifest ?? getFullAuthorizedToolManifest(),
    ...(options.availableToolNames
      ? { availableToolNames: [...options.availableToolNames] }
      : context.availableToolNames
        ? { availableToolNames: context.availableToolNames }
        : {}),
  };
  bound.contextIdentity = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    projectId: bound.projectId!,
    operationId: bound.operationId!,
    workspaceRevision: bound.workspaceRevision!,
    capturedAt: bound.capturedAt!,
    intent: bound.intent!,
    requestedSections: bound.requestedSections ?? [],
  };
  return {
    ...bound,
    contextProvenance: projectContextProvenance(bound),
  };
}

function emitLifetimeTrace(
  projectId: string,
  states: readonly SliceLifetimeState[],
  source: "fresh" | "cache",
): void {
  console.info(
    JSON.stringify({
      scope: "context-builder",
      action: "lifetime_trace",
      projectId,
      source,
      states: states.slice(0, 12).map((state) => ({
        slice: state.sliceId,
        stage: state.stage,
        originalDecision: state.originalDecision,
        effectiveDecision: state.effectiveDecision,
        ageMs: Math.round(state.ageMs),
      })),
      demoted: states.filter((state) => state.effectiveDecision !== state.originalDecision).length,
    }),
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildProjectContext(
  projectId: string,
  options: BuildContextOptions = {},
): Promise<ProjectContext> {
  const operationId = options.operationId ?? randomUUID();
  // Resolve execution plan first — its hash is part of the cache key so plan
  // changes (e.g. switching context intensity) produce distinct cache entries.
  const effectivePlan = options.plan ?? resolveExecutionDecision("chat-agent", {
    contextIntensityOverride: "normal",
  });

  const sections = options.sections ??
    [...(effectivePlan.contextSections ?? [])] as ContextLoadSection[];
  const planHash = hashExecutionPlan(effectivePlan);
  const cacheKey = buildContextCacheKey(projectId, sections, planHash, options.sourceRoot);
  const now = Date.now();
  const cacheMode = effectivePlan.cacheMode;
  const cached = getCachedContext(cacheKey, cacheMode);
  if (cached && cached.expiresAt > now) {
    if (cached.runtime) {
      const cachedIdentity = cached.runtime.contextObject.plan.admissionIdentity;
      if (
        cachedIdentity.projectId !== projectId ||
        (options.sourceRoot !== undefined && cachedIdentity.sourceRoot !== options.sourceRoot)
      ) {
        // Never reuse a snapshot admitted for another project/root.
      } else {
      const lifetime = applyLifetime(
        cached.runtime.contextObject,
        options.lifetimePolicy ?? DEFAULT_LIFETIME_POLICY,
        now,
      );
      emitLifetimeTrace(projectId, lifetime.states, "cache");
      const cachedResult = assembleContext(cached.runtime.baseContext, lifetime.contextObject, lifetime.states);
      const rebound = bindContextIdentity(cachedResult, {
        operationId,
        projectId,
        requestedSections: options.sections ?? cachedResult.requestedSections,
        ...(options.intent ? { intent: options.intent } : {}),
        ...(options.availableToolNames ? { availableToolNames: options.availableToolNames } : {}),
      });
      warnIfContextTooLarge(projectId, cachedResult);
      return parseAgentContext(trimContextToFit(projectId, rebound, options.maxChars));
      }
    }
    if (cached && (!options.sourceRoot || cached.data.contextManifest?.repositoryManifest?.sourceRoot === options.sourceRoot)) {
      return parseAgentContext(bindContextIdentity(cached.data, {
      operationId,
      projectId,
      ...(options.sections ? { requestedSections: options.sections } : {}),
      ...(options.intent ? { intent: options.intent } : {}),
      ...(options.availableToolNames ? { availableToolNames: options.availableToolNames } : {}),
      }));
    }
  }

  // Load raw DB rows and serialize to prompt strings.
  const loaded = await loadProjectContext(projectId, { ...options, sections });
  const raw = buildProjectContextFromLoadedContext(loaded);

  // Wrap each string field as a ContextSlice with load metadata.
  const slices = SLICE_FIELDS.map(({ id, key }) => {
    const content = String(raw[key] ?? "");
    const loaderKey = SLICE_TO_LOADER_KEY[id];
    const meta = loaded.sliceMetadata.get(loaderKey);

    const dependencyHints: SliceId[] = (meta?.dependencyHints ?? [])
      .map((h) => SECTION_TO_SLICE[h])
      .filter((s): s is SliceId => s !== undefined);

    return buildSlice(id, content, {
      source:          meta?.source ?? `db:${id}`,
      freshness:       meta?.freshness ?? (content.startsWith("[") ? "missing" : "fresh"),
      healthStatus:    meta?.status ?? "loaded",
      ...(meta?.failureCode ? { failureCode: meta.failureCode } : {}),
      rowCount:        meta?.rowCount ?? 0,
      loadedAt:        meta?.loadedAt ?? now,
      dependencyHints,
    });
  });

  const contextPlan: ContextPlan = {
    projectId,
    admissionIdentity: {
      projectId,
      projectRevision: loaded.contextManifest.projectRevision,
      sourceRoot: options.sourceRoot
        ?? loaded.contextManifest.repositoryManifest?.sourceRoot
        ?? "unavailable",
      scanCorrelationId: loaded.contextManifest.scanCorrelationId ?? "unavailable",
    } satisfies ContextAdmissionIdentity,
    slices,
    totalEstimatedTokens: slices.reduce((s, sl) => s + sl.estimatedTokens, 0),
    budgetTokens:      effectivePlan.contextBudget,
    graphBudgetTokens: effectivePlan.graphBudget,
  };

  // Run admission, then apply age policy before assembling the final prompt.
  const admittedObject = runAdmission(contextPlan, effectivePlan);
  const lifetime = applyLifetime(
    admittedObject,
    options.lifetimePolicy ?? DEFAULT_LIFETIME_POLICY,
    now,
  );
  const contextObject = lifetime.contextObject;
  // Trace context admission decisions for diagnostics.
  console.info(
    JSON.stringify({
      scope: "context-builder",
      action: "admission_trace",
      projectId,
      totalEstimatedTokens: contextPlan.totalEstimatedTokens,
      budgetTokens: contextPlan.budgetTokens,
      graphBudgetTokens: contextPlan.graphBudgetTokens,
      sliceCount: contextPlan.slices.length,
       sections,
       cacheMode,
       planned: {
         contextIntensity: effectivePlan.taskProfile.contextIntensity,
         graphMode: effectivePlan.taskProfile.graphMode,
         contextBudget: effectivePlan.contextBudget,
         graphBudget: effectivePlan.graphBudget,
       },
       effective: {
         loadedSections: [...loaded.requestedSections],
         cacheMode,
       },
      decisions: contextObject.plan.slices.map((s) => ({
        id: s.id,
        decision: s.admissionDecision,
        estimatedTokens: s.estimatedTokens,
        freshness: s.freshness,
      })),
    }),
  );
  emitLifetimeTrace(projectId, lifetime.states, "fresh");

  // Assemble the final ProjectContext from admission decisions.
  const links = buildContextLinks(loaded);
  const result = assembleContext(
    {
      ...raw,
      metricsVerified: loaded.scanVerified,
      contextManifest: loaded.contextManifest,
      schemaVersion: "1",
      projectId,
      operationId,
      workspaceRevision: loaded.contextManifest.projectRevision,
      capturedAt: loaded.contextManifest.capturedAt,
      requestedSections: [...loaded.requestedSections],
      contextIdentity: {
        schemaVersion: CONTEXT_SCHEMA_VERSION,
        projectId,
        operationId,
        workspaceRevision: loaded.contextManifest.projectRevision,
        capturedAt: loaded.contextManifest.capturedAt,
        intent: options.intent ?? {
          kind: "CHAT",
          phases: [],
          requiresEvidence: false,
        },
        requestedSections: [...loaded.requestedSections],
      },
      ...(links.length > 0 ? { contextLinks: links } : {}),
      contextLinkCollection: contextLinkCollection(links),
      authorizedToolManifest: getFullAuthorizedToolManifest(),
      ...(options.intent ? { intent: options.intent } : {}),
      ...(options.availableToolNames
        ? { availableToolNames: [...options.availableToolNames] }
        : {}),
    },
    contextObject,
    lifetime.states,
  );
  warnIfContextTooLarge(projectId, result);
  const withProvenance = {
    ...result,
    contextProvenance: projectContextProvenance(result),
  };
  const boundedResult = parseAgentContext(
    trimContextToFit(projectId, withProvenance, options.maxChars),
  );

  const hasLoadFailure = Object.values(raw.contextHealth ?? {}).some(
    (health) => health.status === "load_failed",
  );
  if (!hasLoadFailure) {
    const runtime: ContextCacheRuntime = {
      contextObject: admittedObject,
      baseContext: {
        ...raw,
        metricsVerified: loaded.scanVerified,
        contextManifest: loaded.contextManifest,
      },
    };
    setCachedContext(cacheKey, boundedResult, cacheMode, runtime);
  } else {
    console.info(JSON.stringify({
      scope: "context-builder",
      action: "cache_skip",
      projectId,
      reason: "load_failed",
    }));
  }
  return boundedResult;
}
