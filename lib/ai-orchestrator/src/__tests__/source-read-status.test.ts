import { describe, expect, it } from "vitest";
import {
  hasDisplayTruncationMarker,
  hasToolAppendedTruncationMarker,
} from "../source-read-status.js";

describe("source-read-status", () => {
  it("does not classify marker definitions inside a complete source body as truncation", () => {
    const source = [
      'const READ_TRUNCATION_MARKER = "[... output truncated at 128 KB by the read tool ...]";',
      'const FORENSIC_READ_TRUNCATION_MARKER = "[... forensic read exceeded the maximum safe evidence window ...]";',
      "export function read() { return source; }",
    ].join("\n");

    expect(hasToolAppendedTruncationMarker(source)).toBe(false);
    expect(hasDisplayTruncationMarker(source)).toBe(false);
  });

  it("recognizes an appended marker before a read wrapper's closing fence", () => {
    const output = [
      "File: src/large.ts",
      "```",
      "export const value = 1;",
      "[... output truncated at 128 KB by the read tool ...]",
      "```",
    ].join("\n");

    expect(hasToolAppendedTruncationMarker(output)).toBe(true);
    expect(hasDisplayTruncationMarker(output)).toBe(true);
  });

  it("recognizes terminal prefetch and omitted-line markers", () => {
    expect(
      hasDisplayTruncationMarker(
        "export const value = 1;\n… [prefetch output truncated — full read required]",
      ),
    ).toBe(true);
    expect(
      hasDisplayTruncationMarker("export const value = 1;\n... [12 lines omitted]"),
    ).toBe(true);
  });

  it("does not treat an embedded marker followed by source as truncation", () => {
    const source = [
      "const note = '[read output truncated — full body unavailable]';",
      "export const complete = true;",
    ].join("\n");

    expect(hasToolAppendedTruncationMarker(source)).toBe(false);
    expect(hasDisplayTruncationMarker(source)).toBe(false);
  });
});