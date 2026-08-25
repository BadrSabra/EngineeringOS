import { describe, expect, it } from "vitest";
import { buildTaskExecutionPartialReport } from "../task-execution-partial-report.js";

describe("task execution deterministic partial report", () => {
  it("lists completed reads/searches and checklist state without model text", () => {
    const report = buildTaskExecutionPartialReport({
      reason: "MALFORMED_JSON",
      isArabic: false,
      taskChecklist: [
        { index: 1, text: "Read `src/task.ts`" },
        { index: 2, text: "Run the targeted tests" },
      ],
      telemetry: [
        { kind: "tool_call", tool: "read_file", args: { path: "src/task.ts" }, cached: false },
        {
          kind: "tool_result",
          tool: "read_file",
          source: "src/task.ts",
          cached: false,
          outputLength: 42,
        },
        {
          kind: "tool_call",
          tool: "search_code",
          args: { query: "TODO", path: "src" },
          cached: false,
        },
        {
          kind: "tool_result",
          tool: "search_code",
          cached: false,
          outputLength: 12,
        },
      ],
      toolSources: ["src/task.ts"],
      fileContents: new Map([["src/task.ts", "const task = true;"]]),
      pendingChangesCount: 0,
    });

    expect(report).toContain("Status: PARTIALLY_COMPLETE");
    expect(report).toContain("Trigger: MALFORMED_JSON");
    expect(report).toContain("Model consulted for this report: NO");
    expect(report).toContain("- src/task.ts");
    expect(report).toContain('search_code (query="TODO", path="src")');
    expect(report).toContain("[x] Read `src/task.ts`");
    expect(report).toContain("[ ] Run the targeted tests");
    expect(report).toContain("Run the first unproven validation item");
  });

  it("uses the pending-change recommendation when all checklist items are proven", () => {
    const report = buildTaskExecutionPartialReport({
      reason: "SOFT_LIMIT",
      isArabic: true,
      taskChecklist: [{ index: 1, text: "Read `src/task.ts`" }],
      telemetry: [
        { kind: "tool_call", tool: "read_file", args: { path: "src/task.ts" }, cached: false },
        {
          kind: "tool_result",
          tool: "read_file",
          source: "src/task.ts",
          cached: false,
          outputLength: 10,
        },
      ],
      toolSources: ["src/task.ts"],
      fileContents: new Map([["src/task.ts", "const task = true;"]]),
      pendingChangesCount: 1,
    });

    expect(report).toContain("Status: PARTIALLY_COMPLETE");
    expect(report).toContain("Trigger: SOFT_LIMIT");
    expect(report).toContain("راجع التغييرات المقترحة");
  });

  it("includes bilingual timeout note and unproven items for PROVIDER_TIMEOUT", () => {
    const report = buildTaskExecutionPartialReport({
      reason: "PROVIDER_TIMEOUT",
      isArabic: false,
      taskChecklist: [
        { index: 1, text: "Read `src/index.ts`" },
        { index: 2, text: "Run the targeted tests" },
      ],
      telemetry: [
        { kind: "tool_call", tool: "read_file", args: { path: "src/index.ts" }, cached: false },
        {
          kind: "tool_result",
          tool: "read_file",
          source: "src/index.ts",
          cached: false,
          outputLength: 100,
        },
      ],
      toolSources: ["src/index.ts"],
      fileContents: new Map([["src/index.ts", "export const x = 1;"]]),
      pendingChangesCount: 0,
    });

    // Header must surface the timeout trigger clearly.
    expect(report).toContain("Trigger: PROVIDER_TIMEOUT");
    // Bilingual stop-reason line must be present.
    expect(report).toContain("timed out");
    expect(report).toContain("collected evidence");
    // Proven item must be checked, unproven item must stay open.
    expect(report).toContain("[x] Read `src/index.ts`");
    expect(report).toContain("[ ] Run the targeted tests");
    // Unproven validation item surfaces the "run first unproven" recommendation.
    expect(report).toContain("Run the first unproven validation item");
  });

  it("includes bilingual stop-reason note for PROVIDER_TIMEOUT in Arabic", () => {
    // No checklist items → falls through to the retry recommendation.
    const report = buildTaskExecutionPartialReport({
      reason: "PROVIDER_TIMEOUT",
      isArabic: true,
      taskChecklist: [],
      telemetry: [
        { kind: "tool_call", tool: "read_file", args: { path: "src/task.ts" }, cached: false },
        { kind: "tool_result", tool: "read_file", source: "src/task.ts", cached: false, outputLength: 10 },
        { kind: "tool_call", tool: "search_code", args: { query: "test" }, cached: false },
        { kind: "tool_result", tool: "search_code", cached: false, outputLength: 5 },
      ],
      toolSources: ["src/task.ts"],
      fileContents: new Map([["src/task.ts", "export {};"]]),
      pendingChangesCount: 0,
    });

    expect(report).toContain("Trigger: PROVIDER_TIMEOUT");
    // Arabic stop-reason note uses "انتهت مهلة" (verb form).
    expect(report).toContain("انتهت مهلة");
    // With no pending changes and searches done, hits the PROVIDER_TIMEOUT retry recommendation.
    expect(report).toContain("أعد المحاولة");
  });
});