import { describe, expect, it } from "vitest";
import {
  formatProjectTimestamp,
  projectStatusLabel,
} from "./project-detail-copy";

describe("Arabic project details copy", () => {
  it("localizes known statuses for display without changing unknown status values", () => {
    expect(projectStatusLabel("active")).toBe("نشط");
    expect(projectStatusLabel("scanning")).toBe("جارٍ الفحص");
    expect(projectStatusLabel("archived")).toBe("مؤرشف");
    expect(projectStatusLabel("future_status")).toBe("future_status");
  });

  it("formats timestamps for Arabic readers and keeps missing dates explicit", () => {
    expect(formatProjectTimestamp(undefined)).toBe("لم يُجرَ بعد");
    expect(formatProjectTimestamp("not-a-date")).toBe("تاريخ غير متاح");
    expect(formatProjectTimestamp("2026-01-01T12:00:00.000Z")).not.toBe(
      "2026-01-01T12:00:00.000Z",
    );
  });
});
