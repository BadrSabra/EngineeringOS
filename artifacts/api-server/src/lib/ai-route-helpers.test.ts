/**
 * Focused tests for chat-provider routing helpers.
 */
import { describe, expect, it } from "vitest";
import {
  redactUserFacingText,
  redactUserFacingValue,
  requestLooksToolBound,
} from "./ai-route-helpers.js";

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

describe("AI user-facing JSON redaction contract", () => {
  it.each([
    {
      name: "analysis result",
      fixture: {
        summary: "See /workspace/projects/demo/src/index.ts",
        sources: ["/tmp/provider-output.txt (request 123e4567-e89b-12d3-a456-426614174000)"],
        trace: {
          file: "/home/runner/workspace/artifacts/api-server/src/routes/ai/analysis.ts",
          requestId: "123e4567-e89b-12d3-a456-426614174000",
        },
      },
    },
    {
      name: "workflow decision",
      fixture: {
        reasoning: "Provider response referenced /var/task/run.log",
        evidence: [{ source: "/mnt/data/evidence.json", id: "550e8400-e29b-41d4-a716-446655440000" }],
      },
    },
    {
      name: "provider error",
      fixture: {
        error: "Provider failed while reading /srv/app/config.json",
        details: { requestId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
      },
    },
  ])("redacts paths and opaque IDs from $name fields", ({ fixture }) => {
    const serialized = JSON.stringify(redactUserFacingValue(fixture));

    expect(serialized).not.toContain("/workspace/");
    expect(serialized).not.toContain("/tmp/");
    expect(serialized).not.toContain("/home/runner/");
    expect(serialized).not.toContain("/var/task/");
    expect(serialized).not.toContain("/mnt/data/");
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(serialized).toContain("[runtime path]");
    expect(serialized).toContain("[internal id]");
  });

  it("redacts standalone provider error text without changing the contract shape", () => {
    expect(redactUserFacingText("failed at /app/run.txt for 123e4567-e89b-12d3-a456-426614174000"))
      .toBe("failed at [runtime path] for [internal id]");
  });
});
