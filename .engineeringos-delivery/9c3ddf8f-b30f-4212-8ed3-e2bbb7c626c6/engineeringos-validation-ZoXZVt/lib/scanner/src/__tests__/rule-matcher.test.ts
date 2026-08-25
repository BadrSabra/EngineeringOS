import { describe, it, expect } from "vitest";
import { matchRules } from "../rule-matcher.js";
import type { ScannedFile } from "../file-walker.js";
import type { RuleInput } from "../rule-matcher.js";

const makeFile = (path: string, content: string, language = "typescript"): ScannedFile => ({
  path,
  absPath: `/project/${path}`,
  language,
  content,
  size: content.length,
  lines: content.split("\n").length,
  oversized: false,
});

const makeRule = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  id: "rule-1",
  code: "TEST-001",
  pattern: "console\\.log",
  severity: "low",
  enabled: true,
  ...overrides,
});

describe("matchRules", () => {
  it("detects a matching pattern in file content", () => {
    const files = [makeFile("src/foo.ts", "const x = 1;\nconsole.log(x);\n")];
    const rules = [makeRule()];

    const results = matchRules(rules, files);

    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(true);
    expect(results[0].matchCount).toBeGreaterThanOrEqual(1);
  });

  it("returns matched=false when pattern does not match", () => {
    const files = [makeFile("src/foo.ts", "const x = 1;\n")];
    const rules = [makeRule({ pattern: "console\\.log" })];

    const results = matchRules(rules, files);

    expect(results[0].matched).toBe(false);
    expect(results[0].matchCount).toBe(0);
  });

  it("omits disabled rules from results entirely", () => {
    // matchRules filters disabled rules out rather than returning matched=false entries
    const files = [makeFile("src/foo.ts", "console.log('hi');\n")];
    const rules = [makeRule({ enabled: false })];

    const results = matchRules(rules, files);

    expect(results).toHaveLength(0);
  });

  it("omits rules with null pattern from results", () => {
    const files = [makeFile("src/foo.ts", "some content\n")];
    const rules = [makeRule({ pattern: null })];

    expect(() => matchRules(rules, files)).not.toThrow();
    expect(matchRules(rules, files)).toHaveLength(0);
  });

  it("omits rules with empty pattern from results", () => {
    const files = [makeFile("src/foo.ts", "some content\n")];
    const rules = [makeRule({ pattern: "" })];

    expect(() => matchRules(rules, files)).not.toThrow();
    expect(matchRules(rules, files)).toHaveLength(0);
  });

  it("handles invalid regex patterns without throwing", () => {
    const files = [makeFile("src/foo.ts", "content\n")];
    const rules = [makeRule({ pattern: "[invalid(regex" })];

    expect(() => matchRules(rules, files)).not.toThrow();
  });

  it("accumulates matches across multiple files", () => {
    const files = [
      makeFile("src/a.ts", "console.log('a');\n"),
      makeFile("src/b.ts", "console.log('b1');\nconsole.log('b2');\n"),
    ];
    const rules = [makeRule()];

    const results = matchRules(rules, files);

    expect(results[0].matchCount).toBeGreaterThanOrEqual(3);
  });

  it("preserves ruleCode and severity from the input rule", () => {
    const files = [makeFile("src/foo.ts", "eval('x');\n")];
    const rules = [makeRule({ code: "SEC-EVAL", severity: "critical", pattern: "eval\\(" })];

    const results = matchRules(rules, files);

    expect(results[0].ruleCode).toBe("SEC-EVAL");
    expect(results[0].severity).toBe("critical");
  });

  it("handles empty file content without crashing", () => {
    const files = [makeFile("src/empty.ts", "")];
    const rules = [makeRule()];

    expect(() => matchRules(rules, files)).not.toThrow();
  });
});
