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
  return Object.values(context as Record<string, string | boolean>).reduce((sum, value) => {
    return sum + (typeof value === "string" ? value.length : 0);
  }, 0);
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
  if (total <= maxChars) return context;

  console.warn(
    JSON.stringify({
      scope: "context-builder",
      code: "CONTEXT_TRIM_START",
      projectId,
      totalChars: total,
      estimatedTokens: Math.round(total / 4),
      maxChars,
    }),
  );

  // Work on a mutable copy so callers get a new object.
  const trimmed = { ...context } as Record<string, unknown>;

  // Prefer trimming these bulk sections first (most likely to be large).
  const TRIM_PRIORITY = [
    "codeGraph",
    "relationships",
    "entities",
    "taskSummary",
    "workflowSummary",
    "eventSummary",
    "metricSummary",
  ];

  const MAX_PASSES = 20;
  for (let pass = 0; pass < MAX_PASSES && total > maxChars; pass++) {
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
    const half = Math.floor(current.length / 2);
    trimmed[target] = current.slice(0, half) + "\n…[trimmed — context too large]";
    total = estimateContextSize(trimmed as ProjectContext);
  }

  console.warn(
    JSON.stringify({
      scope: "context-builder",
      code: "CONTEXT_TRIM_DONE",
      projectId,
      trimmedChars: total,
      estimatedTokens: Math.round(total / 4),
      fits: total <= maxChars,
    }),
  );

  return trimmed as ProjectContext;
}
