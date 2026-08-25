/**
 * Source classification used by forensic collection and evidence gates.
 *
 * Production audits should not promote intentionally vulnerable test fixtures
 * or test-only helpers into product Findings. Capability tests can opt in.
 */
const TEST_SOURCE_PATH_RE =
  /(?:^|\/)(?:__tests__?|tests?|specs?|fixtures?|test-fixtures?)(?:\/|$)|(?:\.test|\.spec)\.[^/]+$/i;

export function normalizeForensicSourcePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");
}

export function isForensicTestSourcePath(filePath: string): boolean {
  return TEST_SOURCE_PATH_RE.test(normalizeForensicSourcePath(filePath));
}

export function isPathWithinForensicScope(
  filePath: string,
  scope: {
    roots?: readonly string[];
    files?: readonly string[];
    admit?: readonly string[];
  } = {},
): boolean {
  const normalized = normalizeForensicSourcePath(filePath);
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../")) return false;

  // Admitted paths — e.g. a DIRECT_READ primary evidence target pinned by the
  // First-Evidence Gate — are ALWAYS within scope. This matters when a
  // separately text-derived ordered-roots manifest (like "defect/repair" parsed
  // out of a question's prose) would otherwise exclude the exact file the gate
  // obligated the agent to read, silently dropping a completed body and
  // starving the run to FIRST_EVIDENCE_UNAVAILABLE.
  const admit = (scope.admit ?? []).map(normalizeForensicSourcePath).filter(Boolean);
  if (admit.length > 0 && admit.includes(normalized)) return true;

  const files = (scope.files ?? []).map(normalizeForensicSourcePath).filter(Boolean);
  if (files.length > 0) return files.includes(normalized);

  const roots = (scope.roots ?? []).map(normalizeForensicSourcePath).filter(Boolean);
  if (roots.length === 0) return true;
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}