import type { RuleMatchResult } from "./rule-matcher.js";
import type { ScannedFile } from "./file-walker.js";

export interface ComputedMetrics {
  overallScore: number;
  securityScore: number;
  maintainabilityScore: number;
  reliabilityScore: number;
  performanceScore: number;
  technicalDebt: number;
  lintIssues: number;
}

/** Penalty points per occurrence, keyed by rule severity. */
const SEVERITY_PENALTY: Record<string, number> = {
  critical: 15,
  high: 8,
  medium: 4,
  low: 1,
  info: 0,
};

function getDimension(
  ruleCode: string,
  _severity: string,
): "security" | "reliability" | "performance" | "maintainability" {
  const c = ruleCode.toLowerCase();
  if (
    c.includes("sec") ||
    c.includes("auth") ||
    c.includes("inject") ||
    c.includes("xss") ||
    c.includes("csrf") ||
    c.includes("owasp") ||
    c.includes("vuln") ||
    c.includes("sqli")
  ) return "security";

  if (c.includes("perf") || c.includes("n+1") || c.includes("bundle") || c.includes("cache")) {
    return "performance";
  }
  if (c.includes("err") || c.includes("null") || c.includes("retry") || c.includes("timeout")) {
    return "reliability";
  }
  return "maintainability";
}

/**
 * Compute quality metrics from scan results.
 */
export function computeMetrics(
  files: ScannedFile[],
  ruleResults: RuleMatchResult[],
): ComputedMetrics {
  const sourceFiles = files.filter(
    (f) =>
      f.language !== "markdown" &&
      f.language !== "json" &&
      f.language !== "yaml" &&
      f.language !== "toml",
  );

  const totalFiles = sourceFiles.length;
  const oversizedCount = sourceFiles.filter((f) => f.oversized).length;
  const lintIssues = ruleResults.reduce((s, r) => s + r.matchCount, 0);

  const penalties = {
    security: 0,
    reliability: 0,
    performance: 0,
    maintainability: 0,
  };

  for (const result of ruleResults) {
    const basePenalty = SEVERITY_PENALTY[result.severity] ?? 2;
    const dim = getDimension(result.ruleCode, result.severity);
    penalties[dim] += result.matchCount * basePenalty;
  }

  const oversizedPenalty = oversizedCount * 3;
  const densityPenalty = totalFiles > 0 ? Math.floor((lintIssues / totalFiles) * 3) : 0;
  penalties.maintainability += oversizedPenalty + densityPenalty;

  function clamp(n: number): number {
    return Math.min(100, Math.max(0, Math.round(n)));
  }

  const securityScore = clamp(100 - penalties.security);
  const reliabilityScore = clamp(100 - penalties.reliability);
  const performanceScore = clamp(100 - penalties.performance);
  const maintainabilityScore = clamp(100 - penalties.maintainability);

  const overallScore = clamp(
    securityScore * 0.35 +
    reliabilityScore * 0.25 +
    maintainabilityScore * 0.25 +
    performanceScore * 0.15,
  );

  const technicalDebt = Math.round((lintIssues * 30) / 60);

  return {
    overallScore,
    securityScore,
    maintainabilityScore,
    reliabilityScore,
    performanceScore,
    technicalDebt,
    lintIssues,
  };
}
