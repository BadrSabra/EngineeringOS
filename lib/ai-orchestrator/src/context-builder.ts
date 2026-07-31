/**
 * Context Builder — queries the DB to build rich project context strings
 * that are injected into every agent's system prompt.
 *
 * Internally, all data is retained as structured objects/arrays and sorted by
 * priority/recency before being serialised into the string fields that
 * AgentContextSchema requires.  No fetched field is silently discarded.
 */
import type { AgentContext } from "./schemas/context.schema.js";
import { buildContextCacheKey, getCachedContext, setCachedContext } from "./context-cache-manager.js";
import { loadProjectContext, type BuildProjectContextOptions } from "./context-loader.js";
import { buildProjectContextFromLoadedContext } from "./context-serializer.js";
import { warnIfContextTooLarge } from "./context-compressor.js";

export { invalidateContextCache, setInvalidationNotifier, startContextInvalidationChannel } from "./context-cache-manager.js";
export type { BuildProjectContextOptions, ContextLoadSection } from "./context-loader.js";

/** The context object every agent prompt is built from. Shape is enforced at runtime by `AgentContextSchema`. */
export type ProjectContext = AgentContext;

export async function buildProjectContext(projectId: string, options: BuildProjectContextOptions = {}): Promise<ProjectContext> {
  const cacheKey = buildContextCacheKey(projectId, options.sections);
  const now = Date.now();
  const cached = getCachedContext(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  const loaded = await loadProjectContext(projectId, options);
  const result = buildProjectContextFromLoadedContext(loaded);
  warnIfContextTooLarge(projectId, result);
  setCachedContext(cacheKey, result);
  return result;
}
