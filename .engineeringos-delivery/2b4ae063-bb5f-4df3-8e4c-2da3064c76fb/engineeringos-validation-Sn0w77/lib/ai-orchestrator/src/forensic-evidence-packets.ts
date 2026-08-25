import {
  isPathWithinForensicScope,
  normalizeForensicSourcePath,
} from "./forensic-source-policy.js";
import type {
  ForensicEvidence,
  ForensicEvidenceScope,
} from "./forensic-output-guard.js";

const IMPLEMENTATION_FILE_RE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)$/i;
const CONTEXT_FILE_RE =
  /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s)$/i;
const GENERATED_PATH_RE =
  /(?:^|\/)(?:benchmark-results|generated|dist|build|coverage)(?:\/|$)/i;

/**
 * Per-file source-retrieval completeness (SR-005). Mirrors the engine's
 * read-status classification at the evidence-window level so a truncated read
 * is never reported as a FULL source window.
 */
export type EvidenceWindowCompleteness = "FULL" | "PARTIAL" | "NONE";

/** A single evidence window with its completeness classification (SR-005). */
export type EvidenceWindow = {
  file: string;
  /** FULL when the retained body is complete, PARTIAL when truncated/narrowed. */
  completeness: EvidenceWindowCompleteness;
};

/** True when a retained source body carries a truncation marker. */
function windowIsTruncated(content: string): boolean {
  return /\[(?:prefetch|read) output truncated\b/i.test(content) ||
    /\[.*forensic read exceeded the maximum safe evidence window\b/i.test(content) ||
    /\[\.\.\.\s*(?:output truncated|forensic read exceeded)/i.test(content);
}

export type ForensicEvidencePacket = {
  /** The explicitly requested root this packet belongs to. */
  root: string;
  /** Evidence paths assigned to this packet, in deterministic order. */
  files: string[];
  /** A packet-local evidence view; it never contains another root's files. */
  evidence: ForensicEvidence;
  implementationFiles: number;
  contextFiles: number;
  generatedFiles: number;
  sourceChars: number;
  incompleteFiles: string[];
  /** Per-file source-window completeness (SR-005), deterministic order. */
  evidenceWindows: EvidenceWindow[];
};

function classifyFile(file: string): "implementation" | "context" | "generated" | "other" {
  if (GENERATED_PATH_RE.test(file)) return "generated";
  if (CONTEXT_FILE_RE.test(file)) return "context";
  if (IMPLEMENTATION_FILE_RE.test(file)) return "implementation";
  return "other";
}

function packetRootForFile(file: string, roots: readonly string[]): string {
  const matchingRoot = roots.find((root) => isPathWithinForensicScope(file, { roots: [root] }));
  return matchingRoot ?? "(unassigned)";
}

function normalizeRoots(scope?: ForensicEvidenceScope, roots?: readonly string[]): string[] {
  const candidates = roots ?? scope?.roots ?? [];
  return [...new Set(candidates.map(normalizeForensicSourcePath).filter(Boolean))];
}

/**
 * Split retained forensic evidence into deterministic, root-local packets.
 *
 * A file is assigned to the first matching root only. This makes overlapping
 * roots safe and prevents a later packet from silently reusing an earlier
 * root's evidence. The packet-local `ForensicEvidence` keeps the same gate
 * policy and incompleteness markers as the parent evidence.
 */
export function buildForensicEvidencePackets(
  evidence: ForensicEvidence,
  roots?: readonly string[],
): ForensicEvidencePacket[] {
  const orderedRoots = normalizeRoots(evidence.scope, roots);
  const files = [...evidence.fileContents.keys()]
    .map(normalizeForensicSourcePath)
    .filter((file) => file.length > 0)
    .filter((file) => isPathWithinForensicScope(file, evidence.scope ?? {}))
    .sort((left, right) => left.localeCompare(right));

  const assignments = new Map<string, string[]>();
  for (const root of orderedRoots) assignments.set(root, []);
  if (files.some((file) => !orderedRoots.some((root) => isPathWithinForensicScope(file, { roots: [root] })))) {
    assignments.set("(unassigned)", []);
  }
  for (const file of files) {
    const root = packetRootForFile(file, orderedRoots);
    const packetFiles = assignments.get(root) ?? [];
    packetFiles.push(file);
    assignments.set(root, packetFiles);
  }

  return [...assignments.entries()]
    .filter(([, packetFiles]) => packetFiles.length > 0)
    .map(([root, packetFiles]) => {
      const fileContents = new Map(
        packetFiles.map((file) => [file, evidence.fileContents.get(file) ?? ""]),
      );
      const packetFileSet = new Set(packetFiles);
      const searchResults = new Map(
        [...(evidence.searchResults ?? [])]
          .filter(([file]) => packetFileSet.has(normalizeForensicSourcePath(file)))
          .map(([file, result]) => [normalizeForensicSourcePath(file), result]),
      );
      const incompleteFiles = new Set(
        [...(evidence.incompleteFiles ?? [])]
          .map(normalizeForensicSourcePath)
          .filter((file) => packetFileSet.has(file)),
      );
      const packetEvidence: ForensicEvidence = {
        toolSources: evidence.toolSources
          .map(normalizeForensicSourcePath)
          .filter((source) => packetFileSet.has(source)),
        fileContents,
        searchResults,
        allowTestSources: evidence.allowTestSources,
        scope: root === "(unassigned)" ? undefined : { roots: [root] },
        incompleteFiles,
        requireCompleteReadEvidence: evidence.requireCompleteReadEvidence,
      };
      // SR-005: classify each retained window. A file flagged incomplete (or
      // whose body still carries a truncation marker) is PARTIAL, never FULL.
      const evidenceWindows: EvidenceWindow[] = packetFiles.map((file) => {
        const content = fileContents.get(file) ?? "";
        const completeness: EvidenceWindowCompleteness =
          incompleteFiles.has(file) || windowIsTruncated(content)
            ? "PARTIAL"
            : content.length > 0
              ? "FULL"
              : "NONE";
        return { file, completeness };
      });
      const counts = packetFiles.reduce(
        (acc, file) => {
          const category = classifyFile(file);
          if (category === "implementation") acc.implementationFiles += 1;
          if (category === "context") acc.contextFiles += 1;
          if (category === "generated") acc.generatedFiles += 1;
          acc.sourceChars += fileContents.get(file)?.length ?? 0;
          return acc;
        },
        { implementationFiles: 0, contextFiles: 0, generatedFiles: 0, sourceChars: 0 },
      );
      return {
        root,
        files: packetFiles,
        evidence: packetEvidence,
        ...counts,
        incompleteFiles: [...incompleteFiles].sort(),
        evidenceWindows,
      };
    });
}
