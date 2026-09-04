/**
 * Detect markers appended by source-read transports.
 *
 * A marker is only authoritative when it is the final non-fence line of a
 * tool result. Searching for marker text anywhere in a source body is unsafe:
 * source files can legitimately define or document the marker itself.
 */
const TOOL_TRUNCATION_MARKER_LINE =
  /^(?:\[\.\.\.\s*(?:output truncated|forensic read exceeded)\b[^\]]*\]|\u2026\s*\[(?:prefetch|read) output truncated\b[^\]]*\]|\[(?:prefetch|read) output truncated\b[^\]]*\])$/i;

const DISPLAY_LIMIT_MARKER_LINE =
  /^(?:\u2026\s*)?\[(?:prefetch|read) output truncated\b[^\]]*\]$|^(?:\[\.\.\.\s*)?(?:output truncated|forensic read exceeded)\b[^\]]*\]$/i;

/**
 * True only when the returned transport payload ends with a known truncation
 * marker. The optional closing code fence is part of the read_file wrapper.
 */
export function hasToolAppendedTruncationMarker(content: string): boolean {
  const lines = content.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const last = lines.at(-1)?.trim() ?? "";
  const candidate = last === "```" ? (lines.at(-2)?.trim() ?? "") : last;
  return TOOL_TRUNCATION_MARKER_LINE.test(candidate);
}

/**
 * Compatibility predicate for evidence/report paths that also recognize the
 * prefetch display marker. It remains line/terminal scoped for the same reason
 * as hasToolAppendedTruncationMarker.
 */
export function hasDisplayTruncationMarker(content: string): boolean {
  const lines = content.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const last = lines.at(-1)?.trim() ?? "";
  const candidate = last === "```" ? (lines.at(-2)?.trim() ?? "") : last;
  return DISPLAY_LIMIT_MARKER_LINE.test(candidate) ||
    /\bdisplay limit\b.*\b(?:truncat|omitt)/i.test(candidate);
}