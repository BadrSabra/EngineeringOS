import path from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".vue",
  ".svelte",
]);

const MIN_ORIGINAL_BYTES_FOR_SHRINK_CHECK = 512;
const MAX_ALLOWED_SHRINK_RATIO = 0.5;

export type AiChangeGuardInput = {
  filePath: string;
  before: string | null;
  after: string;
};

export type AiChangeGuardDecision = {
  allowed: boolean;
  error?: string;
  removedExports: string[];
  originalBytes: number;
  newBytes: number;
};

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Extract named exports conservatively. This is intentionally not a full
 * language parser: the guard should fail closed for the common TypeScript and
 * JavaScript export forms without trying to interpret arbitrary source.
 */
function extractNamedExports(source: string): Set<string> {
  const names = new Set<string>();
  const declarationPattern =
    /\bexport\s+(?:(?:async|declare)\s+)*(?:function|class|const|let|var|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declarationPattern)) {
    if (match[1]) names.add(match[1]);
  }

  const listPattern = /\bexport\s*\{([^}]+)\}/g;
  for (const match of source.matchAll(listPattern)) {
    for (const item of (match[1] ?? "").split(",")) {
      const name = item.trim().split(/\s+as\s+/i)[0]?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return names;
}

export function inspectAiChange(input: AiChangeGuardInput): AiChangeGuardDecision {
  const originalBytes = input.before === null ? 0 : Buffer.byteLength(input.before, "utf8");
  const newBytes = Buffer.byteLength(input.after, "utf8");
  const removedExports: string[] = [];

  if (input.before !== null && isSourceFile(input.filePath)) {
    const beforeExports = extractNamedExports(input.before);
    const afterExports = extractNamedExports(input.after);
    for (const name of beforeExports) {
      if (!afterExports.has(name)) removedExports.push(name);
    }
  }

  const drasticShrink =
    input.before !== null &&
    isSourceFile(input.filePath) &&
    originalBytes >= MIN_ORIGINAL_BYTES_FOR_SHRINK_CHECK &&
    newBytes < originalBytes * MAX_ALLOWED_SHRINK_RATIO;

  if (drasticShrink || removedExports.length > 0) {
    const reasons: string[] = [];
    if (drasticShrink) {
      reasons.push(
        `file shrinks from ${originalBytes} to ${newBytes} bytes (more than 50% reduction)`,
      );
    }
    if (removedExports.length > 0) {
      reasons.push(`named exports would be removed: ${removedExports.slice(0, 12).join(", ")}`);
    }
    return {
      allowed: false,
      error:
        `AI change blocked as a destructive source-file replacement: ${reasons.join("; ")}. ` +
        "Read the complete current file and submit a focused change instead.",
      removedExports,
      originalBytes,
      newBytes,
    };
  }

  return { allowed: true, removedExports, originalBytes, newBytes };
}