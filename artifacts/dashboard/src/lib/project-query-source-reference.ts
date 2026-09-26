export type ProjectQuerySourceReference = {
  path: string;
  startLine: number;
  endLine: number;
};

const MAX_PATH_CHARS = 512;
const MAX_REFERENCE_LINES = 50;

export function isSafeProjectRelativeSourcePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.length > MAX_PATH_CHARS ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").includes("..") ||
    /(?:^|\/)(?:\.env(?:\.[^/]*)?|secrets?)(?:\/|$)/i.test(normalized)
  ) {
    return false;
  }
  return true;
}

/**
 * Parse only the server-generated source-reference heading format. Plain paths
 * or model-authored headings are never enough to trigger a project file read.
 */
export function parseProjectQuerySourceReference(
  headingText: string,
): ProjectQuerySourceReference | null {
  const match = headingText.match(/^\s*(.+?)\s*:\s*L(\d+)-L(\d+)\s+—/u);
  if (!match) return null;

  const path = match[1]!.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  const startLine = Number(match[2]);
  const endLine = Number(match[3]);
  if (
    !isSafeProjectRelativeSourcePath(path) ||
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(endLine) ||
    startLine < 1 ||
    endLine < startLine ||
    endLine - startLine + 1 > MAX_REFERENCE_LINES
  ) {
    return null;
  }
  return { path, startLine, endLine };
}