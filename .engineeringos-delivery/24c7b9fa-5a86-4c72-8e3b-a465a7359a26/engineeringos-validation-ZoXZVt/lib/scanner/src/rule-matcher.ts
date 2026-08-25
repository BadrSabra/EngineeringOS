import type { ScannedFile } from "./file-walker.js";

export interface RuleMatch {
  file: string;
  line: number;
  snippet: string;
  occurrences: number;
}

export interface RuleMatchResult {
  ruleId: string;
  ruleCode: string;
  severity: string;
  pattern: string | null;
  matched: boolean;
  matchCount: number;
  matches: RuleMatch[];
}

export interface RuleInput {
  id: string;
  code: string;
  pattern: string | null;
  severity: string;
  enabled: boolean;
}

/** Maximum characters in a pattern before we refuse to compile it. */
const MAX_PATTERN_LENGTH = 300;
/** Maximum total matches across all files. */
const GLOBAL_MATCH_CAP = 200;
/** Maximum matches recorded per file. */
const PER_FILE_MATCH_CAP = 20;

/**
 * Safely compile a user-supplied pattern string into a RegExp.
 * Returns null if the pattern is invalid, empty, or suspiciously complex.
 */
function safeCompileRegex(pattern: string): RegExp | null {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return null;
  try {
    // Compile with 'i' flag only (no 'g') so test() is stateless per line.
    return new RegExp(pattern, "i");
  } catch {
    try {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(escaped, "i");
    } catch {
      return null;
    }
  }
}

/**
 * Count how many non-overlapping occurrences of `regex` appear in `text`.
 */
function countOccurrences(pattern: string, text: string): number {
  try {
    const gRe = new RegExp(pattern, "gi");
    const all = text.match(gRe);
    return all ? all.length : 0;
  } catch {
    return text.toLowerCase().includes(pattern.toLowerCase()) ? 1 : 0;
  }
}

/**
 * Match a single rule's pattern against a list of scanned files.
 */
export function matchRule(rule: RuleInput, files: ScannedFile[]): RuleMatchResult {
  if (!rule.pattern) {
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      severity: rule.severity,
      pattern: null,
      matched: false,
      matchCount: 0,
      matches: [],
    };
  }

  const regex = safeCompileRegex(rule.pattern);
  if (!regex) {
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      severity: rule.severity,
      pattern: rule.pattern,
      matched: false,
      matchCount: 0,
      matches: [],
    };
  }

  const allMatches: RuleMatch[] = [];
  let totalCount = 0;

  outer: for (const file of files) {
    if (!file.content || file.oversized) continue;

    const lines = file.content.split("\n");
    let perFileCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!regex.test(line)) continue;

      const occ = countOccurrences(rule.pattern, line);
      const snippet = line.trim().slice(0, 120);

      allMatches.push({ file: file.path, line: i + 1, snippet, occurrences: occ });
      totalCount += occ;
      perFileCount++;

      if (perFileCount >= PER_FILE_MATCH_CAP) break;
      if (allMatches.length >= GLOBAL_MATCH_CAP) break outer;
    }
  }

  return {
    ruleId: rule.id,
    ruleCode: rule.code,
    severity: rule.severity,
    pattern: rule.pattern,
    matched: totalCount > 0,
    matchCount: totalCount,
    matches: allMatches,
  };
}

/**
 * Run all enabled rules (with patterns) against the scanned files.
 */
export function matchRules(rules: RuleInput[], files: ScannedFile[]): RuleMatchResult[] {
  return rules
    .filter((r) => r.enabled && r.pattern)
    .map((r) => matchRule(r, files));
}

/**
 * Check whether a specific pattern still appears in a given set of scanned files.
 * Used for task verification: pattern gone → fix confirmed.
 */
export function checkPatternInFiles(pattern: string, files: ScannedFile[]): boolean {
  const regex = safeCompileRegex(pattern);
  if (!regex) return false;

  for (const file of files) {
    if (!file.content || file.oversized) continue;
    for (const line of file.content.split("\n")) {
      if (regex.test(line)) return true;
    }
  }
  return false;
}
