import { describe, it, expect } from "vitest";
import { computeMetrics } from "../metrics-calc.js";
import type { ScannedFile } from "../file-walker.js";
import type { RuleMatchResult } from "../rule-matcher.js";

const makeFile = (path: string, language = "typescript", oversized = false, sizeBytes = 100): ScannedFile => ({
  path,
  absPath: `/project/${path}`,
  language,
  content: `// ${path}`,
  size: sizeBytes,
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

  it("computes technicalDebt using severity weights (low = 0.25h each)", () => {
    const files = [makeFile("src/a.ts")];
    const violations = [makeViolation("X-001", "low", 4)]; // 4 × 0.25h = 1.0h
    const result = computeMetrics(files, violations);

    expect(result.technicalDebt).toBe(1.0);
  });

  it("computes technicalDebt for medium severity (0.5h each)", () => {
    const files = [makeFile("src/a.ts")];
    const violations = [makeViolation("X-002", "medium", 2)]; // 2 × 0.5h = 1.0h
    const result = computeMetrics(files, violations);

    expect(result.technicalDebt).toBe(1.0);
  });

  it("computes technicalDebt for high severity (2.0h each)", () => {
    const files = [makeFile("src/a.ts")];
    const violations = [makeViolation("X-003", "high", 1)]; // 1 × 2.0h = 2.0h
    const result = computeMetrics(files, violations);

    expect(result.technicalDebt).toBe(2.0);
  });

  it("computes technicalDebt for critical severity (4.0h each)", () => {
    const files = [makeFile("src/a.ts")];
    const violations = [makeViolation("SEC-001", "critical", 1)]; // 1 × 4.0h = 4.0h
    const result = computeMetrics(files, violations);

    expect(result.technicalDebt).toBe(4.0);
  });

  it("computes technicalDebt for mixed severities", () => {
    const files = [makeFile("src/a.ts")];
    const violations = [
      makeViolation("A-001", "critical", 1), // 4.0h
      makeViolation("A-002", "high", 2),     // 4.0h
      makeViolation("A-003", "medium", 4),   // 2.0h
      makeViolation("A-004", "low", 8),      // 2.0h
    ]; // total = 12.0h
    const result = computeMetrics(files, violations);

    expect(result.technicalDebt).toBe(12.0);
  });

  it("returns technicalDebt = 0 when there are no violations", () => {
    const files = [makeFile("src/a.ts")];
    const result = computeMetrics(files, []);

    expect(result.technicalDebt).toBe(0);
  });

  it("returns structuralTestEstimate = 0 when no test files exist", () => {
    const files = [makeFile("src/index.ts"), makeFile("src/utils.ts")];
    const result = computeMetrics(files, []);

    expect(result.structuralTestEstimate).toBe(0);
  });

  it("returns structuralTestEstimate > 0 when test files are present", () => {
    const files = [
      makeFile("src/index.ts"),
      makeFile("src/utils.ts"),
      makeFile("src/index.test.ts"),
      makeFile("src/utils.spec.ts"),
    ];
    const result = computeMetrics(files, []);

    expect(result.structuralTestEstimate).toBeGreaterThan(0);
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

  // ── avgFileSizeKb ──────────────────────────────────────────────────────────

  it("computes avgFileSizeKb as average source-file size in KB", () => {
    // 2 files: 1024 bytes (1 KB) and 2048 bytes (2 KB) → average 1.5 KB
    const files = [
      makeFile("src/a.ts", "typescript", false, 1024),
      makeFile("src/b.ts", "typescript", false, 2048),
    ];
    const result = computeMetrics(files, []);

    expect(result.avgFileSizeKb).toBeCloseTo(1.5, 5);
  });

  it("returns avgFileSizeKb = 0 when there are no source files", () => {
    // markdown/json/yaml/toml are excluded from sourceFiles
    const files = [makeFile("README.md", "markdown")];
    const result = computeMetrics(files, []);

    expect(result.avgFileSizeKb).toBe(0);
  });

  // ── codeToTestRatio ────────────────────────────────────────────────────────

  it("computes codeToTestRatio as nonTest / testFiles", () => {
    // 2 non-test source files, 1 test file → ratio = 2 / 1 = 2
    const files = [
      makeFile("src/a.ts"),
      makeFile("src/b.ts"),
      makeFile("src/a.test.ts"),
    ];
    const result = computeMetrics(files, []);

    expect(result.codeToTestRatio).toBeCloseTo(2, 5);
  });

  it("returns codeToTestRatio using max(testFiles, 1) guard — no Infinity when no test files", () => {
    // 3 non-test files, 0 test files → ratio = 3 / max(0, 1) = 3
    const files = [makeFile("src/a.ts"), makeFile("src/b.ts"), makeFile("src/c.ts")];
    const result = computeMetrics(files, []);

    expect(result.codeToTestRatio).toBeCloseTo(3, 5);
    expect(Number.isFinite(result.codeToTestRatio)).toBe(true);
  });
});
