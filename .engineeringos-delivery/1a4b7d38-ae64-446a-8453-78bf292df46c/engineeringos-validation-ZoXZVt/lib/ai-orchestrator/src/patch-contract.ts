import { createHash } from "node:crypto";
import type { PatchEvidenceLink } from "./schemas/chat.schema.js";

export type FilePatchHunk = {
  startLine: number;
  endLine: number;
  expectedText: string;
  replacementText: string;
  reason: string;
  risk?: "low" | "medium" | "high";
  evidence?: PatchEvidenceLink[];
};

export type PatchRebaseResult =
  | {
      ok: true;
      content: string;
    }
  | {
      ok: false;
      kind: "hunk_mismatch" | "unsupported";
      hunkIndex?: number;
      reason: string;
    };

export function hashPatchBase(content: string | null): string {
  return createHash("sha256").update(content ?? "", "utf8").digest("hex");
}

/**
 * Rebase a deferred patch onto the file content that exists now.
 *
 * This is deliberately conservative: every hunk must identify exactly one
 * unchanged expected fragment in the current file. We never fuzzy-match,
 * adjust line numbers heuristically, or fall back to the stale full-file
 * content.
 */
export function rebasePatchHunks(
  currentContent: string | null,
  hunks: readonly FilePatchHunk[],
): PatchRebaseResult {
  if (hunks.length === 0) {
    return {
      ok: false,
      kind: "unsupported",
      reason: "The patch has no hunks to rebase safely.",
    };
  }

  if (currentContent === null) {
    const newFileHunk = hunks.length === 1 && hunks[0]?.expectedText === "";
    if (!newFileHunk) {
      return {
        ok: false,
        kind: "hunk_mismatch",
        hunkIndex: 0,
        reason: "The target file no longer exists, so the approved patch cannot be rebased.",
      };
    }
    return { ok: true, content: hunks[0]?.replacementText ?? "" };
  }

  const locations: Array<{ index: number; hunkIndex: number; hunk: FilePatchHunk }> = [];
  for (const [hunkIndex, hunk] of hunks.entries()) {
    // An empty expected fragment is only unambiguous for a genuinely new file.
    // Treat insertions into an existing file as conflicts instead of guessing
    // from stale line numbers.
    if (hunk.expectedText.length === 0) {
      return {
        ok: false,
        kind: "hunk_mismatch",
        hunkIndex,
        reason: "The patch contains an insertion hunk without stable surrounding text.",
      };
    }
    const firstIndex = currentContent.indexOf(hunk.expectedText);
    if (firstIndex < 0) {
      return {
        ok: false,
        kind: "hunk_mismatch",
        hunkIndex,
        reason: "The expected hunk text is no longer present in the current file.",
      };
    }
    const secondIndex = currentContent.indexOf(hunk.expectedText, firstIndex + hunk.expectedText.length);
    if (secondIndex >= 0) {
      return {
        ok: false,
        kind: "hunk_mismatch",
        hunkIndex,
        reason: "The expected hunk text is no longer unique in the current file.",
      };
    }
    locations.push({ index: firstIndex, hunkIndex, hunk });
  }

  // Apply from right to left so earlier replacements cannot invalidate the
  // offsets of later hunks.
  let rebased = currentContent;
  for (const location of locations.sort((a, b) => b.index - a.index)) {
    rebased =
      rebased.slice(0, location.index) +
      location.hunk.replacementText +
      rebased.slice(location.index + location.hunk.expectedText.length);
  }
  return { ok: true, content: rebased };
}

function splitLines(content: string): string[] {
  return content.split("\n");
}

/**
 * Build a compact line-oriented patch description while retaining the complete
 * reconstructed content for the existing validation/apply pipeline.
 */
export function buildPatchHunks(
  originalContent: string | null,
  newContent: string,
  reason: string,
  metadata: Pick<FilePatchHunk, "risk" | "evidence"> = {},
): FilePatchHunk[] {
  if (originalContent === newContent) return [];

  if (originalContent === null) {
    return [{
      startLine: 1,
      endLine: 1,
      expectedText: "",
      replacementText: newContent,
      reason,
      ...metadata,
    }];
  }

  const oldLines = splitLines(originalContent);
  const newLines = splitLines(newContent);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= prefix &&
    newEnd >= prefix &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const expectedLines = oldLines.slice(prefix, oldEnd + 1);
  const replacementLines = newLines.slice(prefix, newEnd + 1);
  const startLine = prefix + 1;
  return [{
    startLine,
    endLine: Math.max(startLine, oldEnd + 1),
    expectedText: expectedLines.join("\n"),
    replacementText: replacementLines.join("\n"),
    reason,
    ...metadata,
  }];
}