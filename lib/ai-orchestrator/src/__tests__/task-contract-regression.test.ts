import { describe, expect, it } from "vitest";
import {
  buildResponseLanguageFallback,
  buildTaskValidationFallback,
  type ForensicTaskType,
  validateResponseLanguage,
  validateTaskResponse,
} from "../task-contracts.js";

const FULL_FORENSIC_SHAPE = [
  "## 1) Executive Verdict",
  "## 2) Evidence Map",
  "## 3) Findings",
  "## 4) Repair Plan",
  "## 5) Validation Checklist",
  "## 6) Final Judgment",
].join("\n");

const VALID_RESPONSES: Record<ForensicTaskType, string> = {
  CODE_EXTRACTION: [
    "Branch A:",
    "```ts",
    "return partial;",
    "```",
    "Branch B:",
    "```ts",
    "return exhausted;",
    "```",
  ].join("\n"),
  BEHAVIOR_QUERY:
    "The loop returns the partial result when the provider stops before completion.",
  FINDING_ANALYSIS:
    "Finding: the loop drops partial output. Evidence: `return partial`. Severity: HIGH.",
  FULL_FORENSIC_AUDIT: FULL_FORENSIC_SHAPE,
  WORKSPACE_REVIEW: FULL_FORENSIC_SHAPE,
  REPAIR_ANALYSIS:
    "Repair plan: preserve the partial result before returning. Readiness: READY.",
};

const INVALID_RESPONSES: Record<ForensicTaskType, string> = {
  CODE_EXTRACTION: FULL_FORENSIC_SHAPE,
  BEHAVIOR_QUERY: FULL_FORENSIC_SHAPE,
  FINDING_ANALYSIS: "The implementation looks interesting.",
  FULL_FORENSIC_AUDIT: "## 1) Executive Verdict\nOnly one section was returned.",
  WORKSPACE_REVIEW: "Project overview: package.json and src/.",
  REPAIR_ANALYSIS: "The implementation looks interesting.",
};

describe("task contract regression matrix", () => {
  it.each(Object.keys(VALID_RESPONSES) as ForensicTaskType[] )(
    "%s accepts its own output shape",
    (taskType) => {
      const result = validateTaskResponse(taskType, VALID_RESPONSES[taskType]);
      expect(result).toEqual({ valid: true, violations: [] });
    },
  );

  it.each(Object.keys(INVALID_RESPONSES) as ForensicTaskType[] )(
    "%s rejects a mismatched or incomplete output shape",
    (taskType) => {
      const result = validateTaskResponse(taskType, INVALID_RESPONSES[taskType]);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    },
  );

  it("keeps the six-section audit contract exclusive to FULL_FORENSIC_AUDIT", () => {
    for (const taskType of [
      "BEHAVIOR_QUERY",
      "CODE_EXTRACTION",
      "FINDING_ANALYSIS",
      "REPAIR_ANALYSIS",
    ] as const) {
      const result = validateTaskResponse(taskType, FULL_FORENSIC_SHAPE);
      expect(result.valid, taskType).toBe(false);
    }
    expect(validateTaskResponse("FULL_FORENSIC_AUDIT", FULL_FORENSIC_SHAPE).valid).toBe(true);
  });

  it("rejects an English response to an Arabic BEHAVIOR_QUERY", () => {
    const result = validateTaskResponse(
      "BEHAVIOR_QUERY",
      "The model returned a partial response.",
      { responseLanguage: "ar" },
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "BEHAVIOR_QUERY response did not use the Arabic language requested by the user",
    );
    expect(result.failureKind).toBe("LANGUAGE_MISMATCH");
  });

  it("accepts an Arabic response to an Arabic BEHAVIOR_QUERY", () => {
    expect(
      validateTaskResponse(
        "BEHAVIOR_QUERY",
        "الاستجابة تتوقف عند النتيجة الجزئية.",
        { responseLanguage: "ar" },
      ).valid,
    ).toBe(true);
  });

  it("rejects an English-only safety refusal for an Arabic request", () => {
    const result = validateResponseLanguage(
      "I’m sorry, but I can’t help with that.",
      "ar",
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "response used English prose for an Arabic request",
    );
    expect(buildResponseLanguageFallback("ar")).toContain("لغة الطلب");
  });

  it("returns a complete Arabic incomplete report instead of hiding a forensic language failure", () => {
    const fallback = buildTaskValidationFallback("FULL_FORENSIC_AUDIT", true);
    expect(fallback).toContain("## 1) Executive Verdict");
    expect(fallback).toContain("## 6) Final Judgment");
    expect(fallback).toContain("ANALYSIS_INCOMPLETE");
    expect(fallback).not.toContain("FINDING PROVEN");
    expect(validateTaskResponse("FULL_FORENSIC_AUDIT", fallback, { responseLanguage: "ar" }).valid).toBe(true);
  });

  it("returns an informative incomplete behavior fallback after source reads", () => {
    const arabicFallback = buildTaskValidationFallback("BEHAVIOR_QUERY", true);
    const englishFallback = buildTaskValidationFallback("BEHAVIOR_QUERY", false);

    expect(arabicFallback).toContain("ANALYSIS_INCOMPLETE");
    expect(arabicFallback).toContain("تمت قراءة مصادر");
    expect(validateTaskResponse("BEHAVIOR_QUERY", arabicFallback, { responseLanguage: "ar" }).valid).toBe(true);
    expect(englishFallback).toContain("ANALYSIS_INCOMPLETE");
    expect(validateTaskResponse("BEHAVIOR_QUERY", englishFallback, { responseLanguage: "en" }).valid).toBe(true);
  });

  it("accepts mixed Arabic prose containing canonical technical identifiers", () => {
    expect(
      validateResponseLanguage(
        "تم تنفيذ الدالة `resolveProvider` بنجاح في API route.",
        "ar",
      ).valid,
    ).toBe(true);
  });

  it("allows a code-only response for an Arabic extraction request", () => {
    expect(
      validateResponseLanguage(
        "```ts\nreturn partialResult;\n```",
        "ar",
      ).valid,
    ).toBe(true);
  });

  it("rejects Arabic-only prose for an English request but allows neutral output", () => {
    expect(validateResponseLanguage("هذه إجابة عربية.", "en").valid).toBe(false);
    expect(validateResponseLanguage("42", "en").valid).toBe(true);
  });

  it("applies the language contract to every task response, not only behavior answers", () => {
    const result = validateTaskResponse(
      "REPAIR_ANALYSIS",
      "Repair plan: the change is ready.",
      { responseLanguage: "ar" },
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toContain(
      "response used English prose for an Arabic request",
    );
  });

  it("distinguishes a language-only mismatch from an invalid forensic report", () => {
    const languageOnly = validateTaskResponse(
      "FULL_FORENSIC_AUDIT",
      `${FULL_FORENSIC_SHAPE}\nThe report is complete.`,
      { responseLanguage: "ar" },
    );
    expect(languageOnly.failureKind).toBe("LANGUAGE_MISMATCH");

    const structural = validateTaskResponse(
      "FULL_FORENSIC_AUDIT",
      "تقرير عربي غير مكتمل",
      { responseLanguage: "ar" },
    );
    expect(structural.failureKind).toBe("CONTRACT");
    expect(structural.violations).not.toContain(
      "response used English prose for an Arabic request",
    );
  });
});