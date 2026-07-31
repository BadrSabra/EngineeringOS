import type { AgentContext as ProjectContext } from "./schemas/context.schema.js";

export const CONTEXT_WARN_CHARS = 80_000;

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
