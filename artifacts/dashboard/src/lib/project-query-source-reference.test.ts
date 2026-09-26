import { describe, expect, it } from "vitest";
import {
  isSafeProjectRelativeSourcePath,
  parseProjectQuerySourceReference,
} from "./project-query-source-reference";

describe("project-query source references", () => {
  it("parses a bounded English source heading", () => {
    expect(
      parseProjectQuerySourceReference(
        "src/auth/session.ts:L12-L16 — Exact question-term matches: session",
      ),
    ).toEqual({
      path: "src/auth/session.ts",
      startLine: 12,
      endLine: 16,
    });
  });

  it("parses Arabic source headings and normalizes relative separators", () => {
    expect(
      parseProjectQuerySourceReference(
        ".\\/src\\auth.ts:L4-L7 — تطابق حرفي مع مصطلحات السؤال: الجلسة",
      ),
    ).toEqual({
      path: "src/auth.ts",
      startLine: 4,
      endLine: 7,
    });
  });

  it("rejects untrusted paths, secrets, and malformed or oversized ranges", () => {
    const invalidHeadings = [
      "../src/auth.ts:L1-L2 — Exact match",
      "/tmp/project/src/auth.ts:L1-L2 — Exact match",
      ".env:L1-L2 — Exact match",
      "config/secrets/app.json:L1-L2 — Exact match",
      "src/auth.ts:L0-L2 — Exact match",
      "src/auth.ts:L1-L51 — Exact match",
      "src/auth.ts:L7-L3 — Exact match",
      "src/auth.ts:L1-L2",
    ];
    for (const heading of invalidHeadings) {
      expect(parseProjectQuerySourceReference(heading)).toBeNull();
    }
  });

  it("rejects absolute paths and parent traversal", () => {
    expect(isSafeProjectRelativeSourcePath("src/auth.ts")).toBe(true);
    expect(isSafeProjectRelativeSourcePath("C:\\project\\src\\auth.ts")).toBe(false);
    expect(isSafeProjectRelativeSourcePath("src\\..\\secrets\\token.ts")).toBe(false);
  });
});