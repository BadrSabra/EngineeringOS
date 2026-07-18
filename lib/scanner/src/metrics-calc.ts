import type { RuleMatchResult } from "./rule-matcher.js";
import type { ScannedFile } from "./file-walker.js";

export interface ComputedMetrics {
  overallScore: number;
  architectureScore: number;
  securityScore: number;
  maintainabilityScore: number;
  reliabilityScore: number;
  performanceScore: number;
  testCoverage: number;
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

const TEST_FILE_RE = /\.(test|spec)\.(ts|js|tsx|jsx)$|_test\.(ts|js)$|__tests__\//;
const SOURCE_EXTENSIONS = new Set(["typescript", "javascript", "python", "go", "rust", "java"]);

/** Config files that signal a project deliberately set up a test framework. */
const TEST_CONFIG_RE =
  /vitest\.config\.[jt]s|jest\.config\.[jt]s|jest\.config\.json|pytest\.ini|setup\.cfg|conftest\.py/;

/**
 * Estimate test coverage from two proxy signals:
 *   1. Test-file ratio — how many source files have a corresponding test file.
 *   2. Test-config presence — a vitest/jest/pytest config indicates
 *      intentional test setup, not just stray test files.
 *
 * This is still a proxy metric — actual branch coverage requires instrumented
 * runs (Istanbul, coverage.py, etc.). Score is labelled as `testCoverage` in
 * `ComputedMetrics` to match the DB column, but callers should treat it as a
 * structural heuristic until real instrumentation data is wired in.
 */
function computeTestCoverage(files: ScannedFile[]): number {
  const sourceFiles = files.filter(
    (f) => f.language && SOURCE_EXTENSIONS.has(f.language),
  );
  if (sourceFiles.length === 0) return 0;

  const testFiles = sourceFiles.filter((f) => TEST_FILE_RE.test(f.path));
  const nonTestSourceFiles = sourceFiles.filter((f) => !TEST_FILE_RE.test(f.path));
  if (nonTestSourceFiles.length === 0) return 0;

  // Signal 1: ratio of test files to production source files (capped at 90 to
  // leave room for the config bonus, and to signal that this is an estimate).
  const fileRatio = testFiles.length / nonTestSourceFiles.length;
  const ratioScore = Math.min(90, Math.round(fileRatio * 100));

  // Signal 2: explicit test-framework config file presence. A config is
  // evidence of deliberate setup (not just accidentally present test files).
  const hasTestConfig = files.some((f) => TEST_CONFIG_RE.test(f.path));
  const configBonus = hasTestConfig && testFiles.length > 0 ? 10 : 0;

  return Math.min(100, ratioScore + configBonus);
}

/**
 * Estimate architecture score from structural indicators:
 * - Presence of organized directory structure
 * - Absence of circular-looking import density
 * - Config/tooling maturity signals
 */
function computeArchitectureScore(files: ScannedFile[]): number {
  let score = 70; // baseline

  const paths = files.map((f) => f.path);
  const hasSourceDir = paths.some((p) => p.startsWith("src/") || p.includes("/src/"));
  const hasTestDir = paths.some(
    (p) => p.includes("/test/") || p.includes("/__tests__/") || p.includes("/tests/"),
  );
  const hasConfigFiles = paths.some((p) =>
    ["tsconfig.json", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"].some((cfg) =>
      p.endsWith(cfg),
    ),
  );
  const hasDocumentation = paths.some((p) =>
    p.toLowerCase().includes("readme") || p.toLowerCase().includes("docs/"),
  );

  if (hasSourceDir) score += 8;
  if (hasTestDir) score += 7;
  if (hasConfigFiles) score += 5;
  if (hasDocumentation) score += 5;

  // Penalize very flat structures (all files in root)
  const rootFiles = paths.filter((p) => !p.includes("/")).length;
  const flatnessPenalty = Math.min(15, Math.floor((rootFiles / Math.max(paths.length, 1)) * 30));
  score -= flatnessPenalty;

  return Math.min(100, Math.max(0, Math.round(score)));
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

  // testCoverage is included in the overall score so that projects with low
  // test coverage cannot achieve a high overall score purely from clean code.
  // Weight distribution (must sum to 1.00):
  //   Security        0.27  — highest risk if broken
  //   Reliability     0.18
  //   Maintainability 0.18
  //   Performance     0.12
  //   Architecture    0.15
  //   TestCoverage    0.10  — structural proxy; keeps 0% coverage from hitting 99/100
  const overallScore = clamp(
    securityScore * 0.27 +
    reliabilityScore * 0.18 +
    maintainabilityScore * 0.18 +
    performanceScore * 0.12 +
    computeArchitectureScore(files) * 0.15 +
    computeTestCoverage(files) * 0.10,
  );

  const technicalDebt = Math.round((lintIssues * 30) / 60);
  const testCoverage = computeTestCoverage(files);
  const architectureScore = computeArchitectureScore(files);

  return {
    overallScore,
    architectureScore,
    securityScore,
    maintainabilityScore,
    reliabilityScore,
    performanceScore,
    testCoverage,
    technicalDebt,
    lintIssues,
  };
}
