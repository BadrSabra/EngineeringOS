import { z } from "zod";

export const ScopeExpansionKindSchema = z.enum([
  "JUSTIFIED_SCOPE_EXPANSION",
  "UNJUSTIFIED_SCOPE_EXPANSION",
]);
export type ScopeExpansionKind = z.infer<typeof ScopeExpansionKindSchema>;

export const ObjectiveScopePolicySchema = z.object({
  /** Primary implementation files for the declared objective. */
  primaryPaths: z.array(z.string().min(1).max(500)).max(12),
  /** Caller/route/consumer paths that may be reached with an explicit proof. */
  allowedExpansionPaths: z.array(z.string().min(1).max(500)).max(24).default([]),
  /** Paths that must never be used as objective evidence. */
  forbiddenPaths: z.array(z.string().min(1).max(500)).max(24).default([]),
}).strict();
export type ObjectiveScopePolicy = z.infer<typeof ObjectiveScopePolicySchema>;

export type ScopeExpansion = {
  kind: ScopeExpansionKind;
  path: string;
  matchedPolicyPath?: string;
};

export function normalizeObjectivePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");
}

function pathWithin(path: string, root: string): boolean {
  const normalizedPath = normalizeObjectivePath(path);
  const normalizedRoot = normalizeObjectivePath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function firstMatchingPath(path: string, candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => pathWithin(path, candidate));
}

/**
 * Classify a source access against the declared objective scope.
 *
 * Primary paths are ordinary reads. An allowed caller/route/consumer path is
 * a justified expansion. Everything else is an unjustified expansion and
 * must not be exposed as objective evidence.
 */
export function classifyObjectiveScopePath(
  path: string,
  policy: ObjectiveScopePolicy,
): ScopeExpansion | undefined {
  const normalizedPath = normalizeObjectivePath(path);
  if (!normalizedPath) return undefined;
  if (firstMatchingPath(normalizedPath, policy.forbiddenPaths)) {
    return { kind: "UNJUSTIFIED_SCOPE_EXPANSION", path: normalizedPath };
  }
  if (firstMatchingPath(normalizedPath, policy.primaryPaths)) return undefined;
  const allowedMatch = firstMatchingPath(normalizedPath, policy.allowedExpansionPaths);
  if (allowedMatch) {
    return {
      kind: "JUSTIFIED_SCOPE_EXPANSION",
      path: normalizedPath,
      matchedPolicyPath: normalizeObjectivePath(allowedMatch),
    };
  }
  return { kind: "UNJUSTIFIED_SCOPE_EXPANSION", path: normalizedPath };
}