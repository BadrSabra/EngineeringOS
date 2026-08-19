/**
 * Focused tests for chat-provider routing helpers.
 */
import { describe, expect, it } from "vitest";
import { requestLooksToolBound } from "./ai-route-helpers.js";

describe("requestLooksToolBound", () => {
  it("flags code-analysis style messages as tool-bound", () => {
    expect(requestLooksToolBound("Please analyze the codebase and inspect the file tree")).toBe(true);
    expect(requestLooksToolBound("قم بتحليل الكود وافحص الملفات")).toBe(true);
  });

  it("does not over-trigger on simple greetings", () => {
    expect(requestLooksToolBound("hello there")).toBe(false);
    expect(requestLooksToolBound("شكراً جزيلاً")).toBe(false);
  });
});
