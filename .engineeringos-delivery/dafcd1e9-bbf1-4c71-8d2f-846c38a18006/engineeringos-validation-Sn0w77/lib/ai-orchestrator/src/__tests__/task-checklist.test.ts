import { describe, expect, it } from "vitest";
import type { AgentStep } from "../tool-execution-engine.js";
import {
  appendTaskChecklistReport,
  buildTaskCompletionContract,
  evaluateTaskChecklist,
  parseTaskChecklist,
} from "../task-checklist.js";

function readSteps(path: string): AgentStep[] {
  return [
    { kind: "tool_call", tool: "read_file", args: { path }, cached: false },
    { kind: "tool_result", tool: "read_file", source: path, cached: false, outputLength: 120 },
  ];
}

function validationSteps(): AgentStep[] {
  return [
    { kind: "tool_call", tool: "run_tests", args: {}, cached: false },
    { kind: "tool_result", tool: "run_tests", cached: false, outputLength: 30 },
  ];
}

describe("task checklist extraction", () => {
  it("parses plain task-card lines and stops at the next section", () => {
    const items = parseTaskChecklist(
      [
        "Task #65",
        "Done looks like",
        "A parser extracts checklist items.",
        "Run the targeted tests.",
        "Relevant files",
        "- lib/ai-orchestrator/src/chat-agent.ts",
      ].join("\n"),
    );

    expect(items.map((item) => item.text)).toEqual([
      "A parser extracts checklist items.",
      "Run the targeted tests.",
    ]);
  });

  it("parses bullet lists and inline headings", () => {
    const items = parseTaskChecklist(
      "Acceptance criteria: read `src/chat.ts` and add tests in `src/chat.test.ts`.",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toContain("src/chat.ts");
  });
});

describe("task checklist evaluation", () => {
  it("marks every item complete only from matching telemetry", () => {
    const items = parseTaskChecklist(
      [
        "Task #1",
        "Done looks like",
        "- Read `src/chat.ts`.",
        "- Run the targeted tests.",
      ].join("\n"),
    );
    const results = evaluateTaskChecklist(items, [
      ...readSteps("src/chat.ts"),
      ...validationSteps(),
    ]);

    expect(results).toEqual([
      {
        item: { index: 1, text: "Read `src/chat.ts`." },
        complete: true,
        evidence: ["file read: src/chat.ts"],
      },
      {
        item: { index: 2, text: "Run the targeted tests." },
        complete: true,
        evidence: ["validation tool completed (run_tests)"],
      },
    ]);
  });

  it("counts prefetched and cached reads as completed file evidence", () => {
    const items = parseTaskChecklist(
      "Task #1\nDone looks like\n- Read `src/chat.ts`.",
    );
    const steps: AgentStep[] = [
      { kind: "tool_call", tool: "read_file", args: { path: "src/chat.ts" }, cached: false, prefetched: true },
      { kind: "tool_result", tool: "read_file", source: "src/chat.ts", cached: false, prefetched: true, outputLength: 20 },
      { kind: "tool_call", tool: "read_file", args: { path: "src/chat.ts" }, cached: true },
      { kind: "tool_result", tool: "read_file", cached: true, outputLength: 20 },
    ];

    expect(evaluateTaskChecklist(items, steps)[0]).toMatchObject({
      complete: true,
      evidence: ["file read: src/chat.ts"],
    });
  });

  it("keeps an unobserved requirement unfinished", () => {
    const items = parseTaskChecklist(
      [
        "Task #1",
        "Done looks like",
        "- Read `src/chat.ts`.",
        "- Run the targeted tests.",
      ].join("\n"),
    );
    const results = evaluateTaskChecklist(items, readSteps("src/chat.ts"));

    expect(results[0]?.complete).toBe(true);
    expect(results[1]?.complete).toBe(false);
    expect(results[1]?.reason).toMatch(/No completed validation\/test tool event/);
  });

  it("builds a validator-owned yes/no contract for every checklist item", () => {
    const items = parseTaskChecklist(
      [
        "Task #1",
        "Done looks like",
        "- Read `src/chat.ts`.",
        "- Run the targeted tests.",
        "- Confirm the deployment event.",
      ].join("\n"),
    );
    const contract = buildTaskCompletionContract(items);

    expect(contract).toContain("validator-owned");
    expect(contract).toContain("YES/NO — Read `src/chat.ts`.");
    expect(contract).toContain("completed read_file telemetry");
    expect(contract).toContain("YES/NO — Run the targeted tests.");
    expect(contract).toContain("completed validation/test tool event");
    expect(contract).toContain("YES/NO — Confirm the deployment event.");
    expect(contract).toContain("direct matching completed tool event");
  });

  it("adds an explicit unfinished section to a fallback response", () => {
    const items = parseTaskChecklist(
      "Task #1\nDone looks like\n- Run the targeted tests.",
    );
    const response = appendTaskChecklistReport(
      "The provider returned malformed output.",
      items,
      [],
    );

    expect(response).toContain("The provider returned malformed output.");
    expect(response).toContain("## Deterministic task completion checklist");
    expect(response).toContain("### Unfinished items");
    expect(response).toContain("- Run the targeted tests.");
  });
});