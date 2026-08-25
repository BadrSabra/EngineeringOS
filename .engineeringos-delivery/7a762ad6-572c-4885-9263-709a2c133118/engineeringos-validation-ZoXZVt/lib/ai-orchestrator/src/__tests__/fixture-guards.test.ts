import { describe, expect, it } from "vitest";
import { assertArabicForensicFixture } from "./fixture-guards.js";

describe("deterministic forensic fixture language guards", () => {
  it("accepts an intentionally Arabic prompt and report", () => {
    const report = assertArabicForensicFixture(
      "نفّذ تدقيقًا جنائيًا وأخرج التقرير بالعربية.",
      "تم إثبات العيب بالأدلة المباشرة.",
      "arabic-forensic-report",
    );

    expect(report).toContain("تم إثبات");
  });

  it("reports the offending fixture when the Arabic report is English-only", () => {
    expect(() =>
      assertArabicForensicFixture(
        "نفّذ تدقيقًا جنائيًا وأخرج التقرير بالعربية.",
        "The report is English-only.",
        "arabic-forensic-report-regression",
      ),
    ).toThrow(
      "[AI fixture:arabic-forensic-report-regression] expected an Arabic response, but the fixture is English-only",
    );
  });

  it("reports a prompt/report mismatch before behavioral assertions", () => {
    expect(() =>
      assertArabicForensicFixture(
        "Perform a forensic audit and write the report in English.",
        "تقرير عربي غير مقصود.",
        "english-forensic-report-regression",
      ),
    ).toThrow(
      "[AI fixture:english-forensic-report-regression] expected an Arabic forensic prompt, but the fixture prompt is English-only",
    );
  });
});