/**
 * Normalize an objective evidence path without allowing it to escape or
 * change identity across platforms. Invalid paths are represented as empty
 * strings so callers can fail closed while filtering collections.
 */
export function normalizeObjectiveEvidencePath(value: string): string {
  const slashPath = value.replaceAll("\\", "/").trim();
  if (
    !slashPath
    || slashPath.includes("\0")
    || slashPath.startsWith("/")
  ) {
    return "";
  }

  const parts = slashPath.split("/");
  if (parts.some((part) => part === "..")) return "";
  const normalized = parts.filter((part) => part && part !== ".").join("/");
  return !normalized || /^[a-zA-Z]:/.test(normalized) ? "" : normalized;
}
