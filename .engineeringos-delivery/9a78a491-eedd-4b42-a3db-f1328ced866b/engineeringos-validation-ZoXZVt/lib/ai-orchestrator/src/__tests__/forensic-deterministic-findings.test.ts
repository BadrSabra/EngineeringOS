import { describe, expect, it } from "vitest";
import { detectDeterministicBehavioralFindings } from "../forensic-deterministic-findings.js";

describe("deterministic behavioral findings", () => {
  it("promotes an executable eval call with exact source evidence", () => {
    const result = detectDeterministicBehavioralFindings({
      toolSources: ["src/evaluator.ts"],
      fileContents: new Map([
        [
          "src/evaluator.ts",
          [
            "export function evaluate(expression: string): unknown {",
            "  return eval(expression);",
            "}",
          ].join("\n"),
        ],
      ]),
    });

    expect(result?.verdict).toBe("FINDING_PROVEN");
    expect(result?.findings[0]?.files).toEqual(["src/evaluator.ts"]);
    expect(result?.findings[0]?.evidence).toBe("`return eval(expression);`");
    expect(result?.repairPlan[0]?.findingId).toBe("F-01");
  });

  it("does not promote eval mentioned only in comments or strings", () => {
    const result = detectDeterministicBehavioralFindings({
      toolSources: ["src/example.ts"],
      fileContents: new Map([
        [
          "src/example.ts",
          [
            "// return eval(expression);",
            "const documentation = 'return eval(expression);';",
            "export const safe = true;",
          ].join("\n"),
        ],
      ]),
    });

    expect(result).toBeNull();
  });

  it("does not scan non-implementation files", () => {
    const result = detectDeterministicBehavioralFindings({
      toolSources: ["docs/example.md"],
      fileContents: new Map([
        ["docs/example.md", "Example: return eval(expression);"],
      ]),
    });

    expect(result).toBeNull();
  });

  it("excludes test fixtures from production findings unless explicitly enabled", () => {
    const evidence = {
      toolSources: ["src/__tests__/fixtures/known-defect.ts"],
      fileContents: new Map([
        ["src/__tests__/fixtures/known-defect.ts", "return eval(expression);"],
      ]),
    };

    expect(detectDeterministicBehavioralFindings(evidence)).toBeNull();
    expect(
      detectDeterministicBehavioralFindings(evidence, { allowTestSources: true })?.verdict,
    ).toBe("FINDING_PROVEN");
  });

  it("proves fixture-local eval without creating an executable repair phase", () => {
    const result = detectDeterministicBehavioralFindings(
      {
        toolSources: ["src/__tests__/fixtures/known-defect.ts"],
        fileContents: new Map([
          ["src/__tests__/fixtures/known-defect.ts", "return eval(expression);"],
        ]),
      },
      { allowTestSources: true },
    );

    expect(result?.verdict).toBe("FINDING_PROVEN");
    expect(result?.findings[0]?.title).toContain("Fixture-local");
    expect(result?.findings[0]?.whyItMatters).toContain("Production reachability is NOT PROVEN");
    expect(result?.repairPlan).toEqual([]);
    expect(result?.validationChecklist.join("\n")).toContain("Do not modify this fixture");
  });
});