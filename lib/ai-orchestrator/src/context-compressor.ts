import type { AgentContext as ProjectContext } from "./schemas/context.schema.js";

export const CONTEXT_WARN_CHARS = 80_000;

/**
 * GAP-A3: Hard cap in characters. At ~4 chars/token this gives ≈ 100k tokens —
 * safely under the Groq/DeepSeek 128k window with room for the system prompt.
 * Override via CONTEXT_MAX_CHARS env var for models with different windows.
 */
export const CONTEXT_MAX_CHARS = Number(
  process.env.CONTEXT_MAX_CHARS ?? 400_000, // ≈ 100k tokens
);

export function estimateContextSize(context: ProjectContext): number {
  return Object.entries(context).reduce((sum, [key, value]) => {
    if (typeof value === "string") return sum + value.length;
    // contextHealth is rendered into the prompt as a compact server-owned
    // status table, so include its bounded serialized cost in size estimates.
    if (key === "contextHealth" && value !== undefined) {
      return sum + JSON.stringify(value).length;
    }
    return sum;
  }, 0);
}

function trimAtBoundary(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (maxChars <= 1) return "…".slice(0, maxChars);
  const marker = "\n…[trimmed — context too large]";
  const room = Math.max(1, maxChars - marker.length);
  const candidate = content.slice(0, room);
  const boundary = candidate.lastIndexOf("\n");
  const body = boundary > Math.floor(room * 0.55) ? candidate.slice(0, boundary) : candidate;
  return `${body}${marker}`.slice(0, maxChars);
}

/**
 * Compact graph details without cutting the relationship block first.
 * Endpoint → relation → endpoint topology is the durable graph signal.
 */
export function compactGraphSummary(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const relationshipIndex = content.indexOf("\nRelationships ");
  if (relationshipIndex < 0) {
    return trimAtBoundary(content.replace(/ — [^\n]*/g, ""), maxChars);
  }

  const beforeRelationships = content
    .slice(0, relationshipIndex)
    .replace(/ — [^\n]*/g, "")
    .replace(/ \[\d+%\]/g, "");
  const relationshipBlock = content.slice(relationshipIndex);
  const compactRelationships = relationshipBlock
    .split("\n")
    .map((line) => line.replace(/ \[\d+%\]/g, "").replace(/ \[heuristic\]/g, ""))
    .join("\n");
  const combined = `${beforeRelationships}${compactRelationships}`;
  if (combined.length <= maxChars) return combined;

  const headingEnd = compactRelationships.indexOf("\n");
  const heading = headingEnd >= 0 ? compactRelationships.slice(0, headingEnd) : compactRelationships;
  const relationLines = headingEnd >= 0 ? compactRelationships.slice(headingEnd + 1).split("\n") : [];
  const prefix = trimAtBoundary(beforeRelationships, Math.max(1, Math.floor(maxChars * 0.35)));
  const remaining = Math.max(1, maxChars - prefix.length - heading.length - 2);
  const kept: string[] = [];
  let used = 0;
  for (const line of relationLines) {
    if (!line || used + line.length + 1 > remaining) break;
    kept.push(line);
    used += line.length + 1;
  }
  const topology = `${prefix}\n${heading}${kept.length > 0 ? `\n${kept.join("\n")}` : ""}`;
  return topology.length <= maxChars ? topology : trimAtBoundary(topology, maxChars);
}

/** Preserve workflow phase sequences while dropping less useful run metadata. */
export function compactWorkflowSummary(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const compact = content
    .split("\n")
    .map((line) => line.replace(/ \| (runs|last run):[^|]*/g, ""))
    .join("\n");
  return trimAtBoundary(compact, maxChars);
}

function compactField(field: string, key: string, maxChars: number): string {
  if (key === "graphSummary") return compactGraphSummary(field, maxChars);
  if (key === "workflows") return compactWorkflowSummary(field, maxChars);
  return trimAtBoundary(field, maxChars);
}

export function warnIfContextTooLarge(projectId: string, context: ProjectContext, threshold = CONTEXT_WARN_CHARS): void {
  const totalChars = estimateContextSize(context);
  if (totalChars <= threshold) return;

  console.warn(
    JSON.stringify({
      scope: "context-builder",
      code: "CONTEXT_SIZE_WARNING",
      projectId,
      totalChars,
      estimatedTokens: Math.round(totalChars / 4),
      threshold,
      hint: "Consider reducing entity/relationship caps or shortening prompt templates.",
    }),
  );
}

/**
 * GAP-A3: Progressively truncate the longest string fields in the context
 * until the total character count fits within `maxChars`.
 *
 * Fields are trimmed in descending length order so the smallest meaningful
 * sections (project summary, recent events) are preserved as long as possible.
 * Each pass halves the longest field until the budget is met or no further
 * trimming can help.
 */
export function trimContextToFit(
  projectId: string,
  context: ProjectContext,
  maxChars = CONTEXT_MAX_CHARS,
): ProjectContext {
  let total = estimateContextSize(context);
  const limit = Math.max(1, maxChars);
  if (total <= limit) return context;

  console.warn(
    JSON.stringify({
      scope: "context-builder",
      code: "CONTEXT_TRIM_START",
      projectId,
      totalChars: total,
      estimatedTokens: Math.round(total / 4),
      maxChars: limit,
    }),
  );

  // Work on a mutable copy so callers get a new object.
  const trimmed = { ...context } as Record<string, unknown>;

  // Prefer trimming these bulk sections first (most likely to be large).
  // Field names must match AgentContext (context.schema.ts).
  const TRIM_PRIORITY = [
    "graphSummary",
    "workflows",
    "recentTasks",
    "recentEvents",
    "latestMetrics",
  ];

  const MAX_PASSES = 64;
  for (let pass = 0; pass < MAX_PASSES && total > limit; pass++) {
    // Pick the longest trimmable field in priority order, then by length.
    const candidates = [
      ...TRIM_PRIORITY.filter((k) => typeof trimmed[k] === "string" && (trimmed[k] as string).length > 200),
      ...Object.keys(trimmed).filter(
        (k) =>
          !TRIM_PRIORITY.includes(k) &&
          typeof trimmed[k] === "string" &&
          (trimmed[k] as string).length > 200,
      ),
    ];

    const target = candidates[0];
    if (!target) break; // nothing left to trim

    const current = trimmed[target] as string;
    const nextLength = Math.max(200, Math.floor(current.length * 0.65));
    trimmed[target] = compactField(current, target, nextLength);
    total = estimateContextSize(trimmed as ProjectContext);
  }

  // Complete the bound for unusually small caller-provided limits. This path
  // runs only after section-aware compaction has had a chance to preserve graph
  // topology and workflow phase sequences.
  if (total > limit) {
    const hardCandidates = [
      ...TRIM_PRIORITY,
      ...Object.keys(trimmed).filter((key) => !TRIM_PRIORITY.includes(key)),
    ].filter((key) => typeof trimmed[key] === "string" && (trimmed[key] as string).length > 0);
    for (const target of hardCandidates) {
      if (total <= limit) break;
      const current = trimmed[target] as string;
      const excess = total - limit;
      const nextLength = Math.max(1, current.length - excess);
      trimmed[target] = compactField(current, target, nextLength);
      total = estimateContextSize(trimmed as ProjectContext);
    }
  }

  console.warn(
    JSON.stringify({
      scope: "context-builder",
      code: "CONTEXT_TRIM_DONE",
      projectId,
      trimmedChars: total,
      estimatedTokens: Math.round(total / 4),
      maxChars: limit,
      fits: total <= limit,
    }),
  );

  return trimmed as ProjectContext;
}
