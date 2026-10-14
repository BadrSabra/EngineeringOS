import { describe, expect, it } from "vitest";
import {
  discoveryRiskLabel,
  discoveryViolationSummary,
  relatedFilesCountLabel,
  supportDetailLabel,
} from "./discovery-copy";

describe("Arabic discovery report copy", () => {
  it("explains known scanner risks without changing unknown report text", () => {
    expect(discoveryRiskLabel("No test framework detected")).toBe(
      "لم يُكتشف إطار لاختبار المشروع.",
    );
    expect(discoveryRiskLabel("A future scanner risk")).toBe(
      "A future scanner risk",
    );
  });

  it("translates finite support-matrix capability labels and preserves unknown values", () => {
    expect(supportDetailLabel("File-level only")).toBe(
      "العلاقات على مستوى الملفات فقط.",
    );
    expect(supportDetailLabel("Not proven for Java-specific changes")).toBe(
      "لم تثبت جاهزية التغييرات الخاصة بـ Java.",
    );
    expect(supportDetailLabel("A future capability value")).toBe(
      "A future capability value",
    );
  });

  it("summarizes severity and occurrence count without changing source values", () => {
    expect(discoveryViolationSummary("high", 2)).toBe(
      "مخالفة مرتفعة — عدد المواضع: 2",
    );
    expect(discoveryViolationSummary("unrecognized", 1)).toBe(
      "مخالفة غير محددة — عدد المواضع: 1",
    );
  });

  it("uses readable Arabic counts for affected files", () => {
    expect(relatedFilesCountLabel(1)).toBe("ملف واحد متأثر");
    expect(relatedFilesCountLabel(4)).toBe("4 ملفات متأثرة");
  });
});
