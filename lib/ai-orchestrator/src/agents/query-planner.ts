/**
 * Query Planner
 *
 * A lightweight pre-planning phase (single model call, ≤ 5 s) that runs
 * before the main agentic tool loop.  It analyses the user's message and the
 * project's knowledge-graph summary to produce a structured QueryPlan:
 *
 *   • targetFiles    — files most likely needed (pre-seeded into the cache)
 *   • scopeEstimate  — narrow / medium / broad  (drives iteration budget)
 *   • suggestedIterations — concrete maxIterations hint
 *   • subQueries     — decomposed sub-questions for broad tasks
 *
 * Research basis:
 *   - arXiv:2511.02424 ReAcTree — hierarchical task decomposition before execution
 *   - arXiv:2504.16563 — Global Planning + Hierarchical Execution reduces tool
 *     calls by 40-65 % vs. pure ReAct
 *   - ICML 2025 KG-RAG — graph-guided navigation cuts random exploration by ~70 %
 *
 * Design constraints:
 *   - Hard 5-second timeout: if planning takes too long, FALLBACK_PLAN is
 *     returned and the tool loop starts with sensible defaults.  Planning
 *     must never block the main request.
 *   - No tool calls: the planner uses a single fast-model completion — it
 *     reads only from projectContext.graphSummary, not from the filesystem.
 *   - Graceful degradation: JSON parse failures, model errors, and timeouts
 *     all resolve to FALLBACK_PLAN.
 */

import { db } from "@workspace/db";
import {
  findFileEntities,
  searchNodes,
  getNeighborhood,
} from "@workspace/knowledge-engine";
import type {
  GraphEntity,
  GraphRelationship,
} from "@workspace/knowledge-engine";
import type { ProjectContext } from "../context-builder.js";
import type { ProviderStrategy } from "../provider-strategy.js";
import type { RawMessage } from "../groq-client.js";
import { extractMentionedFiles } from "./speculative-prefetch.js";
import {
  buildCrossFileSemanticTrace,
  type CrossFileSemanticTrace,
  type SemanticGraphEdge,
  type SemanticGraphNode,
} from "../semantic-trace.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScopeEstimate = "narrow" | "medium" | "broad";
export type QueryPlanStatus = "valid" | "fallback" | "invalid";

export type CompoundPartKind =
  | "CURRENT_STATE"
  | "FEATURES"
  | "GAPS"
  | "PRIORITIES"
  | "OTHER";

export type CompoundQueryPart = {
  id: string;
  kind: CompoundPartKind;
  question: string;
  requiredCount?: number;
  requiresCitation: boolean;
};

export type QueryPlan = {
  /** The original user intent, retained verbatim for final synthesis. */
  originalIntent: string;
  /** Relevant file paths extracted from the knowledge graph. Max 10. */
  targetFiles: string[];
  /** Entity names from the knowledge graph most relevant to the query. */
  targetEntities: string[];
  /** Estimated breadth of the query — drives iteration budget selection. */
  scopeEstimate: ScopeEstimate;
  /**
   * Concrete maxIterations hint (5–60).
   * narrow → 5-16, medium → 18-35, broad → 40-60.
   */
  suggestedIterations: number;
  /** False only when the planner is confident no filesystem access is needed. */
  requiresToolUse: boolean;
  /** Sub-questions produced for broad queries (empty for narrow/medium). */
  subQueries: string[];
  /** Explicit coverage contract for compound questions. */
  compoundParts: CompoundQueryPart[];
  /** Server-owned interpretation of the planner response. */
  planStatus?: QueryPlanStatus;
  /** Bounded diagnostics for an invalid or fallback plan. */
  planDiagnostics?: string[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PLANNER_TIMEOUT_MS = 5_000;
const MAX_GRAPH_CHARS = 3_000;
const MAX_TARGET_FILES = 10;
const MAX_SUBQUERIES = 5;
/** Hard cap on files added by graph enrichment (task spec: ≤ 15 total). */
const MAX_GRAPH_FILES = 15;
/** Hard timeout for the graph enrichment step (task spec: ≤ 2 seconds). */
const GRAPH_ENRICH_TIMEOUT_MS = 2_000;
const GRAPH_GUIDANCE_TIMEOUT_MS = 2_000;
const MAX_GRAPH_GUIDED_FILES = 10;
const MAX_GRAPH_GUIDED_ROOTS = 4;
const MAX_GRAPH_GUIDED_NEIGHBORS = 6;

/**
 * Returned whenever planning fails (timeout, parse error, model error).
 * Keeps the tool loop running with sensible mid-range defaults.
 */
const FALLBACK_PLAN: QueryPlan = {
  originalIntent: "",
  targetFiles: [],
  targetEntities: [],
  scopeEstimate: "medium",
    suggestedIterations: 30,
  requiresToolUse: true,
  subQueries: [],
  compoundParts: [],
  planStatus: "fallback",
  planDiagnostics: ["planner output was unavailable"],
};

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPlannerPrompt(message: string, graphSummary: string): string {
  const truncated =
    graphSummary.length > MAX_GRAPH_CHARS
      ? graphSummary.slice(0, MAX_GRAPH_CHARS) + "\n…[truncated]"
      : graphSummary;

  return `You are a planning agent for a code intelligence system.
Analyse the user query and return ONLY valid JSON — no markdown, no explanation.

Project knowledge graph (entity names and file paths for context):
${truncated}

User query:
${message}

Return exactly this JSON shape:
{
  "targetFiles": [],
  "targetEntities": [],
  "scopeEstimate": "narrow",
  "suggestedIterations": 10,
  "requiresToolUse": true,
  "subQueries": []
  ,"compoundParts": []
}

Rules:
- scopeEstimate "narrow"  → single concept or file, <5 tool calls needed
- scopeEstimate "medium"  → multiple related files, 5-15 tool calls
- scopeEstimate "broad"   → codebase-wide (e.g. "summarize backlog", "review architecture"), 15+ tool calls
- targetFiles: file paths visible in the graph above that are relevant — max ${MAX_TARGET_FILES}, empty if none known
- targetEntities: entity names from the graph — max 10, empty if none relevant
- suggestedIterations: integer — narrow 5-16, medium 18-35, broad 40-60
- subQueries: non-empty only when scopeEstimate is "broad" — decompose into 2-5 focused sub-questions
- requiresToolUse: false only if the answer is factual and requires no file reading
- compoundParts: preserve every requested part in order. Use kinds CURRENT_STATE, FEATURES, GAPS, PRIORITIES, or OTHER; set requiredCount to 3 only for an explicit top three request; every part requiresCitation when it makes a project claim
- originalIntent: copy the user query exactly`;
}

// ── JSON parser ───────────────────────────────────────────────────────────────

type RawQueryPlanValidation = {
  valid: boolean;
  diagnostics: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the planner envelope before normalizing it. Clamping malformed
 * values is unsafe here: a planner that claims a narrow scope with a broad
 * decomposition can bypass the caller's budget and scheduling assumptions.
 */
export function validateQueryPlanShape(
  value: unknown,
): RawQueryPlanValidation {
  const diagnostics: string[] = [];
  if (!isRecord(value)) return { valid: false, diagnostics: ["plan must be a JSON object"] };

  const scope = value.scopeEstimate;
  if (scope !== "narrow" && scope !== "medium" && scope !== "broad") {
    diagnostics.push("scopeEstimate must be narrow, medium, or broad");
  }

  const arrays: Array<[string, number]> = [
    ["targetFiles", MAX_TARGET_FILES],
    ["targetEntities", 10],
    ["subQueries", MAX_SUBQUERIES],
  ];
  for (const [name, max] of arrays) {
    const candidate = value[name];
    if (!Array.isArray(candidate)) {
      diagnostics.push(`${name} must be an array`);
    } else if (candidate.length > max) {
      diagnostics.push(`${name} exceeds the maximum of ${max}`);
    }
  }

  const targetFiles = Array.isArray(value.targetFiles) ? value.targetFiles : [];
  for (const file of targetFiles) {
    if (
      typeof file !== "string" ||
      !file.trim() ||
      file.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(file) ||
      file.split(/[\\/]+/u).includes("..")
    ) {
      diagnostics.push("targetFiles contains an invalid project-relative path");
      break;
    }
  }
  for (const name of ["targetEntities", "subQueries"] as const) {
    const values = Array.isArray(value[name]) ? value[name] : [];
    if (values.some((item) => typeof item !== "string" || !item.trim())) {
      diagnostics.push(`${name} must contain non-empty strings`);
    }
  }

  const iterations = value.suggestedIterations;
  const range =
    scope === "narrow" ? [5, 16] :
      scope === "broad" ? [40, 60] : [18, 35];
  if (
    typeof iterations !== "number" ||
    !Number.isInteger(iterations) ||
    !Number.isFinite(iterations) ||
    iterations < range[0] ||
    iterations > range[1]
  ) {
    diagnostics.push(`suggestedIterations must be an integer in ${range[0]}-${range[1]}`);
  }
  if (typeof value.requiresToolUse !== "boolean") {
    diagnostics.push("requiresToolUse must be a boolean");
  }

  const subQueries = Array.isArray(value.subQueries) ? value.subQueries : [];
  if (scope === "broad" && subQueries.length > 0 && subQueries.length < 2) {
    diagnostics.push("broad plans require 2-5 subQueries");
  }
  if (scope !== "broad" && subQueries.length > 0) {
    diagnostics.push("subQueries are allowed only for broad plans");
  }
  if (value.requiresToolUse === false && (targetFiles.length > 0 || subQueries.length > 0)) {
    diagnostics.push("a no-tool plan cannot contain target files or subQueries");
  }

  const parts = value.compoundParts === undefined
    ? []
    : Array.isArray(value.compoundParts)
      ? value.compoundParts
      : [];
  if (value.compoundParts !== undefined && !Array.isArray(value.compoundParts)) {
    diagnostics.push("compoundParts must be an array");
  }
  if (parts.length > 8) diagnostics.push("compoundParts exceeds the maximum of 8");
  const ids = new Set<string>();
  for (const part of parts) {
    if (!isRecord(part) || typeof part.id !== "string" || !part.id.trim()) {
      diagnostics.push("compoundParts must have non-empty ids");
      continue;
    }
    if (ids.has(part.id)) diagnostics.push("compoundParts ids must be unique");
    ids.add(part.id);
    if (typeof part.question !== "string" || !part.question.trim()) {
      diagnostics.push("compoundParts questions must be non-empty");
    }
    if (
      part.kind !== "CURRENT_STATE" &&
      part.kind !== "FEATURES" &&
      part.kind !== "GAPS" &&
      part.kind !== "PRIORITIES" &&
      part.kind !== "OTHER"
    ) {
      diagnostics.push("compoundParts contains an unsupported kind");
    }
    if (typeof part.requiresCitation !== "boolean") {
      diagnostics.push("compoundParts requiresCitation must be boolean");
    }
    if (
      part.requiredCount !== undefined &&
      (typeof part.requiredCount !== "number" ||
        !Number.isInteger(part.requiredCount) ||
        part.requiredCount < 1 ||
        part.requiredCount > 10)
    ) {
      diagnostics.push("compoundParts requiredCount must be an integer from 1-10");
    }
  }

  return { valid: diagnostics.length === 0, diagnostics: [...new Set(diagnostics)] };
}

function parsePlannerResponse(raw: string | null): QueryPlan | null {
  if (!raw) return null;

  // Extract the first JSON object from the response (handles spurious prose)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const validation = validateQueryPlanShape(parsed);
    if (!validation.valid) return null;
    const scopeEstimate = parsed["scopeEstimate"] as ScopeEstimate;
    const suggestedIterations = parsed["suggestedIterations"] as number;

    return {
      originalIntent: typeof parsed["originalIntent"] === "string" ? parsed["originalIntent"] : "",
      targetFiles: Array.isArray(parsed["targetFiles"])
        ? (parsed["targetFiles"] as string[]).filter((f) => typeof f === "string").slice(0, MAX_TARGET_FILES)
        : [],
      targetEntities: Array.isArray(parsed["targetEntities"])
        ? (parsed["targetEntities"] as string[]).filter((e) => typeof e === "string").slice(0, 10)
        : [],
      scopeEstimate,
      suggestedIterations,
      requiresToolUse: parsed["requiresToolUse"] as boolean,
      subQueries: Array.isArray(parsed["subQueries"])
        ? (parsed["subQueries"] as string[]).filter((q) => typeof q === "string").slice(0, MAX_SUBQUERIES)
        : [],
      compoundParts: Array.isArray(parsed["compoundParts"])
        ? (parsed["compoundParts"] as Array<Record<string, unknown>>)
            .filter((part) => part && typeof part === "object" && typeof part.id === "string" && typeof part.question === "string")
            .slice(0, 8)
            .map((part, index) => ({
              id: part.id as string || `part-${index + 1}`,
              kind:
                part.kind === "FEATURES" || part.kind === "GAPS" || part.kind === "PRIORITIES" ||
                part.kind === "CURRENT_STATE"
                  ? part.kind
                  : "OTHER",
              question: part.question as string,
              ...(typeof part.requiredCount === "number" && part.requiredCount > 0
                ? { requiredCount: Math.round(part.requiredCount) }
                : {}),
              requiresCitation: part.requiresCitation !== false,
            }))
        : [],
      planStatus: "valid",
      planDiagnostics: [],
    };
  } catch {
    return null;
  }
}

function inferCompoundParts(message: string): CompoundQueryPart[] {
  const parts: CompoundQueryPart[] = [];
  const add = (id: string, kind: CompoundPartKind, question: string, requiredCount?: number) =>
    parts.push({ id, kind, question, ...(requiredCount ? { requiredCount } : {}), requiresCitation: true });
  if (/(?:current|currently|today|existing|implemented|الحالي|الحالية|الموجود|الميزات الحالية)/iu.test(message)) {
    add("current-state", "CURRENT_STATE", "What is the current project state?");
  }
  if (/(?:feature|features|capabilit|وظائف|ميزات|إمكانات)/iu.test(message)) {
    add("features", "FEATURES", "What features or capabilities currently exist?");
  }
  if (/(?:gap|gaps|missing|weakness|deficien|ثغر|فجوات|نواقص|نقاط الضعف)/iu.test(message)) {
    add("gaps", "GAPS", "What verified gaps or missing capabilities exist?");
  }
  const topThree = /(?:top|first|priority|priorities|الأولويات|أول|ثلاث|3)\b/iu.test(message);
  if (topThree || /priority|أولوية/iu.test(message)) {
    add("priorities", "PRIORITIES", "What should be prioritized based on the verified project state?", topThree ? 3 : undefined);
  }
  return parts;
}

// ── Deterministic graph-guided file planning ───────────────────────────────────

export type GraphGuidance = {
  mentionedFiles: string[];
  resolvedFiles: string[];
  /** Mentioned files plus direct file neighbours, and nothing broader. */
  prefetchFiles: string[];
  /** Bounded prompt-ready map with names, relationships, and source coordinates. */
  promptHint: string;
  /** Bounded, source-grounded traces for the explicit file scope. */
  crossFileTraces: CrossFileSemanticTrace[];
};

type GraphEvidenceLike = {
  file?: unknown;
  line?: unknown;
  column?: unknown;
  snippet?: unknown;
  kind?: unknown;
};

function graphEvidence(
  value: GraphEntity | GraphRelationship,
): GraphEvidenceLike[] {
  const direct =
    "evidenceJson" in value && Array.isArray(value.evidenceJson)
      ? value.evidenceJson
      : [];
  const provenance =
    value.provenance && Array.isArray(value.provenance.evidence)
      ? value.provenance.evidence
      : [];
  return [...direct, ...provenance] as GraphEvidenceLike[];
}

function graphCoordinate(
  value: GraphEntity | GraphRelationship,
  fallbackPath?: string | null,
): string | null {
  const evidence = graphEvidence(value);
  const located = evidence.find(
    (item) => typeof item.file === "string" && typeof item.line === "number",
  );
  if (located && typeof located.file === "string" && typeof located.line === "number") {
    return `${located.file}:${located.line}`;
  }
  const fileOnly = evidence.find((item) => typeof item.file === "string");
  if (fileOnly && typeof fileOnly.file === "string") return fileOnly.file;
  return fallbackPath ?? null;
}

function graphSourceSpan(
  value: GraphEntity | GraphRelationship,
): SemanticGraphEdge["sourceSpan"] | undefined {
  const evidence = graphEvidence(value).find(
    (item) =>
      typeof item.file === "string" &&
      typeof item.line === "number" &&
      Number.isInteger(item.line) &&
      item.line > 0,
  );
  if (!evidence || typeof evidence.file !== "string" || typeof evidence.line !== "number") {
    return undefined;
  }
  return {
    file: evidence.file,
    line: evidence.line,
    ...(typeof evidence.column === "number" && Number.isInteger(evidence.column) && evidence.column >= 0
      ? { column: evidence.column }
      : {}),
    ...(typeof evidence.snippet === "string" && evidence.snippet.trim()
      ? { snippet: evidence.snippet.trim().slice(0, 240) }
      : {}),
  };
}

function graphNode(value: GraphEntity): SemanticGraphNode {
  return {
    id: value.id,
    name: value.name || value.path || value.id,
    ...(graphPath(value) ? { path: graphPath(value) as string } : {}),
    type: value.type,
  };
}

function graphPath(value: GraphEntity | null | undefined): string | null {
  const raw = value?.path?.trim();
  return raw ? raw.replace(/\\/g, "/").replace(/^\.\/+/, "") : null;
}

function graphRelationLabel(relationship: GraphRelationship): string {
  return relationship.relationType ?? relationship.relation ?? "related";
}

/**
 * Resolve explicit file mentions directly through the graph before the
 * model-driven planner runs. Only the mentioned file entities and their
 * depth-1 neighbours are admitted to this guidance/prefetch path.
 *
 * This is deliberately separate from `planQuery`: a model may still choose
 * useful target entities for broad questions, but it must not turn a concrete
 * `chat.ts` mention into an unrelated project-wide prefetch.
 */
export async function buildMentionedFileGraphGuidance(opts: {
  message: string;
  projectId: string;
}): Promise<GraphGuidance | null> {
  const mentionedFiles = extractMentionedFiles(opts.message);
  if (mentionedFiles.length === 0) return null;

  const build = async (): Promise<GraphGuidance | null> => {
    const roots = (await findFileEntities(db, opts.projectId, mentionedFiles))
      .slice(0, MAX_GRAPH_GUIDED_ROOTS);
    if (roots.length === 0) return null;

    const neighbourhoods = await Promise.all(
      roots.map(async (root) => ({
        root,
        result: await getNeighborhood(db, root.id, 1).catch(() => ({
          root: null,
          entities: [],
          relationships: [],
        })),
      })),
    );

    const prefetchFiles: string[] = [];
    const seenFiles = new Set<string>();
    const addFile = (file: string | null): void => {
      if (!file || seenFiles.has(file) || prefetchFiles.length >= MAX_GRAPH_GUIDED_FILES) return;
      seenFiles.add(file);
      prefetchFiles.push(file);
    };

    const mapLines: string[] = [
      "Graph-guided file map — use the mentioned files and direct neighbours first; do not explore unrelated files:",
    ];
    const resolvedFiles: string[] = [];
    const crossFileTraces: CrossFileSemanticTrace[] = [];

    for (const { root, result } of neighbourhoods) {
      const rootPath = graphPath(root);
      if (rootPath) {
        resolvedFiles.push(rootPath);
        addFile(rootPath);
      }

      const entities = new Map<string, GraphEntity>();
      entities.set(root.id, root);
      for (const entity of result.entities) entities.set(entity.id, entity);

      const neighbours = result.relationships
        .map((relationship) => {
          const neighbourId =
            relationship.sourceId === root.id
              ? relationship.targetId
              : relationship.targetId === root.id
                ? relationship.sourceId
                : null;
          return neighbourId ? { relationship, entity: entities.get(neighbourId) } : null;
        })
        .filter(
          (entry): entry is { relationship: GraphRelationship; entity: GraphEntity } =>
            entry !== null && entry.entity !== undefined,
        )
        .slice(0, MAX_GRAPH_GUIDED_NEIGHBORS);

      const rootLabel = rootPath ?? root.name;
      mapLines.push(`- Mentioned \`${rootLabel}\` — direct neighbours:`);
      if (neighbours.length === 0) {
        mapLines.push("  - (none recorded in the graph)");
        continue;
      }

      for (const { relationship, entity } of neighbours) {
        const neighbourPath = graphPath(entity);
        if (entity.type === "file") addFile(neighbourPath);
        const coordinate = graphCoordinate(entity, neighbourPath) ??
          graphCoordinate(relationship, rootPath);
        const location = coordinate ? ` at ${coordinate}` : "";
        const relation = graphRelationLabel(relationship);
        const label =
          entity.name && neighbourPath && entity.name !== neighbourPath
            ? `${entity.name} in ${neighbourPath}`
            : entity.name || neighbourPath || entity.id;
        mapLines.push(`  - \`${label}\` via ${relation}${location}`);

        const sourceEntity = relationship.sourceId === root.id ? root : entity;
        const targetEntity = relationship.targetId === root.id ? root : entity;
        const sourceSpan = graphSourceSpan(relationship) ??
          graphSourceSpan(entity);
        if (
          sourceEntity.id !== targetEntity.id &&
          crossFileTraces.length < MAX_GRAPH_GUIDED_FILES
        ) {
          const traceNodes = [graphNode(sourceEntity), graphNode(targetEntity)];
          const edge: SemanticGraphEdge = {
            source: sourceEntity.id,
            target: targetEntity.id,
            relation,
            ...(sourceSpan ? { sourcePath: sourceSpan.file, sourceSpan } : {}),
            ...(sourceSpan
              ? {
                  evidence: [
                    typeof sourceSpan.column === "number"
                      ? `${sourceSpan.file}:${sourceSpan.line}:${sourceSpan.column}`
                      : `${sourceSpan.file}:${sourceSpan.line}`,
                    sourceSpan.snippet ? ` — ${sourceSpan.snippet}` : "",
                  ].join(""),
                }
              : {}),
          };
          crossFileTraces.push(buildCrossFileSemanticTrace({
            nodes: traceNodes,
            edges: [edge],
            from: sourceEntity.id,
            to: targetEntity.id,
            maxDepth: 1,
          }));
        }
      }
    }

    if (prefetchFiles.length === 0) return null;
    return {
      mentionedFiles,
      resolvedFiles: [...new Set(resolvedFiles)],
      prefetchFiles,
      promptHint: mapLines.join("\n").slice(0, 3_000),
      crossFileTraces,
    };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        JSON.stringify({
          scope: "query-planner",
          code: "GRAPH_GUIDANCE_TIMEOUT",
          projectId: opts.projectId,
          timeoutMs: GRAPH_GUIDANCE_TIMEOUT_MS,
        }),
      );
      resolve(null);
    }, GRAPH_GUIDANCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([build().catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Graph enrichment ──────────────────────────────────────────────────────────

/**
 * Enrich a QueryPlan's targetFiles with paths discovered from the knowledge
 * graph neighbourhood of the plan's targetEntities.
 *
 * Design:
 *   1. Search the graph for entities matching the planner's targetEntities.
 *   2. Run getNeighborhood (depth 2) on the top 5 matching entities.
 *   3. Collect the `path` field from every neighbour entity.
 *   4. Merge unique paths into targetFiles (total cap: MAX_GRAPH_FILES).
 *   5. The whole call is raced against a 2-second hard timeout — if the graph
 *      query is slow or the DB is unavailable the original plan is returned
 *      unchanged, so enrichment never blocks the main request.
 *
 * Only called when projectId is provided AND the project has a completed scan
 * (indicated by projectContext.metricsVerified).
 */
async function enrichPlanWithGraph(
  plan: QueryPlan,
  projectId: string,
): Promise<QueryPlan> {
  if (plan.targetEntities.length === 0) return plan;

  const enrichAsync = async (): Promise<QueryPlan> => {
    // Step 1: search the graph for matching entities.
    const matches = await searchNodes(db, projectId, plan.targetEntities);
    if (matches.length === 0) return plan;

    // Step 2: neighbourhood traversal on the top 5 candidates.
    const top5 = matches.slice(0, 5);
    const neighbourResults = await Promise.all(
      top5.map((entity) =>
        getNeighborhood(db, entity.id, 2).catch(() => null),
      ),
    );

    // Step 3: collect paths from all discovered entities.
    const graphPaths = new Set<string>();

    // Include root entities' own paths.
    for (const entity of top5) {
      if (entity.path) graphPaths.add(entity.path);
    }

    for (const result of neighbourResults) {
      if (!result) continue;
      if (result.root?.path) graphPaths.add(result.root.path);
      for (const entity of result.entities) {
        if (entity.path) graphPaths.add(entity.path);
      }
    }

    if (graphPaths.size === 0) return plan;

    // Step 4: merge with existing targetFiles, cap at MAX_GRAPH_FILES.
    const existing = new Set(plan.targetFiles);
    const merged = [...plan.targetFiles];

    for (const p of graphPaths) {
      if (merged.length >= MAX_GRAPH_FILES) break;
      if (!existing.has(p)) {
        merged.push(p);
        existing.add(p);
      }
    }

    console.info(
      JSON.stringify({
        scope: "query-planner",
        code: "GRAPH_ENRICH_DONE",
        projectId,
        addedFiles: merged.length - plan.targetFiles.length,
        totalFiles: merged.length,
      }),
    );

    return { ...plan, targetFiles: merged };
  };

  const timeout = new Promise<QueryPlan>((resolve) =>
    setTimeout(() => {
      console.warn(
        JSON.stringify({
          scope: "query-planner",
          code: "GRAPH_ENRICH_TIMEOUT",
          projectId,
          timeoutMs: GRAPH_ENRICH_TIMEOUT_MS,
        }),
      );
      resolve(plan);
    }, GRAPH_ENRICH_TIMEOUT_MS),
  );

  return Promise.race([enrichAsync().catch(() => plan), timeout]);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the planning phase for a user query.
 *
 * Always resolves — returns FALLBACK_PLAN on any failure.
 * Callers should await this without a try/catch if they want the fallback
 * behaviour; wrap in .catch(() => null) if they want to distinguish failure
 * from the fallback.
 */
export async function planQuery(opts: {
  message: string;
  projectContext: ProjectContext;
  model: string;
  strategy: ProviderStrategy;
  apiKey?: string;
  /**
   * When provided alongside a scanned project (metricsVerified = true),
   * enrichPlanWithGraph() augments targetFiles with paths discovered from
   * the knowledge graph neighbourhood of targetEntities.
   */
  projectId?: string;
}): Promise<QueryPlan> {
  const { message, projectContext, model, strategy, apiKey, projectId } = opts;

  const plannerPrompt = buildPlannerPrompt(message, projectContext.graphSummary);
  const messages: RawMessage[] = [
    { role: "system", content: plannerPrompt },
    { role: "user", content: message },
  ];

  // Race the model call against a hard timeout so planning never blocks the
  // main request even when the provider is slow or unresponsive.
  const plannerCall = strategy
    .call(messages, {
      model,
      maxTokens: 512,
      timeoutMs: PLANNER_TIMEOUT_MS,
      apiKey,
      // No tools — the planner is a pure text completion
    })
    .then((r) => r)
    .catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          scope: "query-planner",
          code: "MODEL_ERROR",
          model,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    });

  const timeoutSignal = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PLANNER_TIMEOUT_MS),
  );

  const result = await Promise.race([plannerCall, timeoutSignal]);

  if (!result) {
    console.warn(JSON.stringify({ scope: "query-planner", code: "TIMEOUT_OR_ERROR", model }));
    return FALLBACK_PLAN;
  }

  const parsedPlan = parsePlannerResponse(result.content);
  if (!parsedPlan) {
    let invalidDiagnostics = ["planner response was not a valid plan"];
    try {
      const jsonMatch = result.content?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        const validation = validateQueryPlanShape(parsed);
        if (!validation.valid) invalidDiagnostics = validation.diagnostics;
      }
    } catch {
      // Keep the bounded parser diagnostic; raw provider content is never
      // returned to callers.
    }
    console.warn(
      JSON.stringify({
        scope: "query-planner",
        code: "PARSE_FAILED",
        model,
        diagnostics: invalidDiagnostics.slice(0, 4),
      }),
    );
    return {
      ...FALLBACK_PLAN,
      planStatus: result.content ? "invalid" : "fallback",
      planDiagnostics: invalidDiagnostics.slice(0, 4),
    };
  }

  // ── Graph enrichment ───────────────────────────────────────────────────────
  // Only enrich when we have a project ID and the project has a completed scan
  // (metricsVerified = true).  Skipping on un-scanned projects avoids wasted
  // DB queries against an empty graph.
  const plan: QueryPlan = {
    ...parsedPlan,
    originalIntent: parsedPlan.originalIntent || message,
    compoundParts:
      parsedPlan.compoundParts.length > 0 ? parsedPlan.compoundParts : inferCompoundParts(message),
  };
  const normalizedPlan: QueryPlan = {
    ...plan,
    subQueries:
      plan.subQueries.length >= 2
        ? plan.subQueries
        : plan.compoundParts.length >= 2
          ? plan.compoundParts.map((part) => part.question).slice(0, MAX_SUBQUERIES)
          : plan.subQueries,
  };
  if (
    normalizedPlan.scopeEstimate === "broad" &&
    normalizedPlan.subQueries.length < 2
  ) {
    return {
      ...FALLBACK_PLAN,
      originalIntent: message,
      planStatus: "invalid",
      planDiagnostics: ["broad plans require at least two focused subQueries"],
    };
  }

  const enriched =
    projectId && projectContext.metricsVerified
      ? await enrichPlanWithGraph(normalizedPlan, projectId)
      : normalizedPlan;

  console.info(
    JSON.stringify({
      scope: "query-planner",
      code: "PLAN_READY",
      scopeEstimate: enriched.scopeEstimate,
      suggestedIterations: enriched.suggestedIterations,
      targetFileCount: enriched.targetFiles.length,
      graphEnriched: enriched.targetFiles.length > plan.targetFiles.length,
      subQueryCount: enriched.subQueries.length,
      requiresToolUse: enriched.requiresToolUse,
    }),
  );

  return enriched;
}
