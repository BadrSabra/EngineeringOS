import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertToolTextOutputWithinByteLimit,
  stringifyJsonWithinByteLimit,
  ToolOutputLimitExceeded,
} from "../tool-output-bounds.js";

describe("bounded tool output serialization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches JSON.stringify byte lengths for nested JSON values and UTF-8 edge cases", () => {
    const value = {
      "line\nkey": "quote:\" slash:\\ control:\u0001 rocket:🚀 lone:\ud800",
      omitted: undefined,
      list: [1, undefined, null, -0, Number.POSITIVE_INFINITY],
    };
    const expected = JSON.stringify(value);
    expect(expected).toBeDefined();
    const bytes = Buffer.byteLength(expected!, "utf8");

    expect(stringifyJsonWithinByteLimit(value, bytes)).toBe(expected);
    expect(() => stringifyJsonWithinByteLimit(value, bytes - 1))
      .toThrow(ToolOutputLimitExceeded);
  });

  it("stops before JSON.stringify materializes an oversized envelope", () => {
    const stringifySpy = vi.spyOn(JSON, "stringify");
    const value = { output: "oversized".repeat(100_000) };

    expect(() => stringifyJsonWithinByteLimit(value, 128))
      .toThrow(ToolOutputLimitExceeded);
    expect(stringifySpy).not.toHaveBeenCalled();
  });

  it("checks raw text against UTF-8 bytes rather than escaped JSON size", () => {
    expect(() => assertToolTextOutputWithinByteLimit("a\n🚀", 6)).not.toThrow();
    expect(() => assertToolTextOutputWithinByteLimit("a\n🚀", 5))
      .toThrow(ToolOutputLimitExceeded);
  });
});