import path from "node:path";
import { PendingChangeSchema } from "@workspace/ai-orchestrator";

export const MAX_MISSION_PROPOSAL_PATHS = 48;

/**
 * Resolve the read-only observation scope from the exact server-stored
 * proposal. The Task must not receive paths supplied by the browser or
 * inferred from provider text.
 */
export function parseMissionProposalPaths(serializedChanges: string): string[] | undefined {
  let stored: unknown;
  try {
    stored = JSON.parse(serializedChanges);
  } catch {
    return undefined;
  }
  if (
    !Array.isArray(stored)
    || stored.length === 0
    || stored.length > MAX_MISSION_PROPOSAL_PATHS
  ) {
    return undefined;
  }

  const changes = stored.map((change) => PendingChangeSchema.safeParse(change));
  if (changes.some((change) => !change.success)) return undefined;

  const paths = new Set<string>();
  for (const result of changes) {
    if (!result.success) return undefined;
    const raw = result.data.path.trim().replaceAll("\\", "/");
    if (
      !raw
      || raw.includes("\0")
      || path.posix.isAbsolute(raw)
      || path.win32.isAbsolute(raw)
      || raw.split("/").some((segment) => segment === "..")
    ) {
      return undefined;
    }
    const normalized = path.posix.normalize(raw).replace(/^(\.\/)+/, "");
    if (
      !normalized
      || normalized === "."
      || normalized === ".."
      || normalized.startsWith("../")
      || path.posix.isAbsolute(normalized)
      || path.win32.isAbsolute(normalized)
    ) {
      return undefined;
    }
    paths.add(normalized);
  }
  return paths.size > 0 ? [...paths] : undefined;
}
