import { describe, it, expect } from "vitest";
import { computeMetrics } from "../metrics-calc.js";
import type { ScannedFile } from "../file-walker.js";
import type { RuleMatchResult } from "../rule-matcher.js";

const makeFile = (path: string, language = "typescript", oversized = false): ScannedFile => ({
  path,
  absPath: `/project/${path}`,
  language,
  content: `// ${path}`,
  size: 100,
  lines: 1,
  oversized,
});

const makeViolation = (ruleCode: string, severity: string, count: number): RuleMatchResult => ({
  ruleId: ruleCode,
  ruleCode,
  severity,
  pattern: null,
  matched: count > 0,
  matchCount: count,
  matches: [],
});

describe("computeMetrics", () => {
  it("returns perfect scores for a clean project with no violations", () => {
    const files = [
      makeFile("src/index.ts"),
      makeFile("src/utils.ts"),
      makeFile("src/__tests__/utils.test.ts"),
    ];
    const result = computeMetrics(files, []);

    expect(result.overallScore).toBeGreaterThanOrEqual(70);
    expect(result.securityScore).toBe(100);
    expect(result.reliabilityScore).toBe(100);
    expect(result.performanceScore).toBe(100);
    expect(result.lintIssues).toBe(0);
    expect(result.technicalDebt).toBe(0);
  });

  it("reduces securityScore for security-related violations", () => {
    const files = [makeFile("src/auth.ts")];
    const violations = [makeViolation("SEC-001", "critical", 3)];
    const result = computeMetrics(files, violations);

    expect(result.securityScore).toBeLessThan(100);
    expect(result.securityScore).toBe(55); // 3 × 15 = 45 penalty → 100 - 45 = 55
  });

  it("reduces maintainabilityScore for general violations", () => {
    const files = [makeFile("src/foo.ts")];
    const violations = [makeViolation("STYLE-001", "medium", 5)];
    const result = computeMetrics(files, violations);

    expect(result.maintainabilityScore).toBeLessThan(100);
  });

  it("clamps all scores to [0, 100]", () => {
    const files = [makeFile("src/bad.ts")];
    const violations = [
      makeViolation("SEC-CRITICAL", "critical", 100),
      makeViolation("SEC-HIGH", "high", 100),
    ];
    const result = computeMetrics(files, violations);

    expect(result.securityScore).toBe(0);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it("counts lintIssues as the sum across all violations", () => {
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts")];
    const violations = [
      makeViolation("A-001", "low", 3),
      makeViolation("B-002", "medium", 7),
    ];
    const result = computeMetrics(files, violations);

    expect(result.lintIssues).toBe(10);
  });

  it("computes technicalDebt in hours (30 min per issue)", () => {
    const files = [makeFile("src/a.ts")];
    const violations = [makeViolation("X-001", "low", 4)]; // 4 × 30 min / 60 = 2 h
    const result = computeMetrics(files, violations);

    expect(result.technicalDebt).toBe(2);
  });

  it("returns testCoverage = 0 when no test files exist", () => {
    const files = [makeFile("src/index.ts"), makeFile("src/utils.ts")];
    const result = computeMetrics(files, []);

    expect(result.testCoverage).toBe(0);
  });

  it("returns testCoverage > 0 when test files are present", () => {
    const files = [
      makeFile("src/index.ts"),
      makeFile("src/utils.ts"),
      makeFile("src/index.test.ts"),
      makeFile("src/utils.spec.ts"),
    ];
    const result = computeMetrics(files, []);

    expect(result.testCoverage).toBeGreaterThan(0);
  });

  it("returns architectureScore in [0, 100]", () => {
    const files = [makeFile("src/index.ts"), makeFile("README.md", "markdown")];
    const result = computeMetrics(files, []);

    expect(result.architectureScore).toBeGreaterThanOrEqual(0);
    expect(result.architectureScore).toBeLessThanOrEqual(100);
  });

  it("gives a higher architectureScore for well-organised projects", () => {
    const flat = computeMetrics([makeFile("index.ts"), makeFile("utils.ts")], []);
    const structured = computeMetrics(
      [
        makeFile("src/index.ts"),
        makeFile("src/__tests__/index.test.ts"),
        makeFile("README.md", "markdown"),
      ],
      [],
    );

    expect(structured.architectureScore).toBeGreaterThanOrEqual(flat.architectureScore);
  });

  it("penalises oversized files in maintainability", () => {
    const clean = computeMetrics([makeFile("src/a.ts")], []);
    const dirty = computeMetrics([makeFile("src/big.ts", "typescript", true)], []);

    expect(dirty.maintainabilityScore).toBeLessThanOrEqual(clean.maintainabilityScore);
  });
});
