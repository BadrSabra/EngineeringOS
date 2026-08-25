import { describe, expect, it } from "vitest";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import type { ProjectContext } from "../context-builder.js";

function makeContext(): ProjectContext {
  return {
    project: "test project",
    workflows: "",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

function makeMemoryContext(): ProjectContext {
  return {
    ...makeContext(),
    sessionMemories:
      "Files previously accessed in this project:\n" +
      "  • src/stale.ts\n" +
      "\nMost recent session summary:\n" +
      "  Previous chat claimed quality was 91%.",
  };
}

describe("forensic prompt safety", () => {
  it("does not treat bounded tool output as proof of source corruption", () => {
    const prompt = buildChatSystemPrompt({
      context: makeContext(),
      hasTools: true,
      structuredOutputMode: true,
    });

    expect(prompt).toContain("truncation marker is never evidence");
    expect(prompt).toContain("NOT PROVEN");
    expect(prompt).toContain("Every Finding needs an exact source snippet");
  });

  it("keeps verification gaps, unmeasured performance claims, and catalog aliases out of Findings", () => {
    const prompt = buildChatSystemPrompt({
      context: makeContext(),
      hasTools: true,
      structuredOutputMode: true,
    });

    expect(prompt).toContain("A missing schema/context read");
    expect(prompt).toContain("completed benchmark/profile/result");
    expect(prompt).toContain("Package-manager aliases such as catalog:");
    expect(prompt).toContain("no repair scope is authorized");
  });

  it("requires evidence before claiming execution or numeric quality", () => {
    const prompt = buildChatSystemPrompt({
      context: makeContext(),
      hasTools: true,
      structuredOutputMode: false,
    });

    expect(prompt).toContain("A proposed or pending change is NOT an applied repair");
    expect(prompt).toContain("Do not claim tests passed");
    expect(prompt).toContain("Do not invent percentages");
  });

  it("keeps fixture capability findings separate from production reachability", () => {
    const prompt = buildChatSystemPrompt({
      context: makeContext(),
      hasTools: true,
      structuredOutputMode: true,
      fixtureAuditMode: true,
    });

    expect(prompt).toContain("Fixture/capability audit boundary");
    expect(prompt).toContain("production reachability");
    expect(prompt).toContain("FIXTURE-LOCAL");
    expect(prompt).toContain("Do not modify the fixture");
  });

  it("injects a validator-owned completion contract into the system prompt", () => {
    const prompt = buildChatSystemPrompt({
      context: makeContext(),
      hasTools: true,
      taskChecklist: [
        { index: 1, text: "Read `src/task.ts`." },
        { index: 2, text: "Run the targeted tests." },
      ],
    });

    expect(prompt).toContain("Task completion contract");
    expect(prompt).toContain("YES/NO — Read `src/task.ts`.");
    expect(prompt).toContain("completed read_file telemetry");
    expect(prompt).toContain("YES/NO — Run the targeted tests.");
    expect(prompt).toContain("completed validation/test tool event");
  });

  it("locks Arabic BEHAVIOR_QUERY responses to Arabic direct answers", () => {
    const prompt = buildChatSystemPrompt({
      context: makeContext(),
      outputContract: "BEHAVIOR_ANSWER",
      responseLanguage: "ar",
    });

    expect(prompt).toContain("Respond in Arabic");
    expect(prompt).toContain("do not emit the six-section forensic report");
  });

  it("suppresses historical session memory for evidence-bound prompts", () => {
    const prompt = buildChatSystemPrompt({
      context: {
        ...makeMemoryContext(),
        latestMetrics: "Quality score: 91%; completed scans: 12",
      },
      hasTools: true,
      structuredOutputMode: true,
      suppressSessionMemory: true,
    });

    expect(prompt).not.toContain("Prior session memory (from previous chats)");
    expect(prompt).not.toContain("Previous chat claimed quality was 91%");
    expect(prompt).not.toContain("Quality score: 91%");
    expect(prompt).toContain("Historical quality metrics are withheld");
  });

  it("can suppress memory for a read-only capability probe without enabling forensic output", () => {
    const prompt = buildChatSystemPrompt({
      context: makeMemoryContext(),
      hasTools: true,
      outputContract: "BEHAVIOR_ANSWER",
      responseLanguage: "en",
      structuredOutputMode: false,
      suppressSessionMemory: true,
    });

    expect(prompt).not.toContain("Prior session memory (from previous chats)");
    expect(prompt).toContain("Task contract — BEHAVIOR_QUERY");
    expect(prompt).not.toContain("Task contract — FORENSIC_REPORT");
  });
});