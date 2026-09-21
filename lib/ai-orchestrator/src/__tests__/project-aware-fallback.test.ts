import { describe, expect, it } from "vitest";
import type { ProjectQueryTarget } from "../project-query-target.js";
import {
  buildProjectAwareFallbackSection,
  deriveProjectAwareFallbackSubQueries,
} from "../project-aware-fallback.js";

const embeddedTarget: ProjectQueryTarget = {
  id: "embedded-ai",
  label: "embedded AI layer",
  confidence: 0.98,
  firstEvidencePath: "src/chat-agent.ts",
  primaryPaths: [
    "src/chat-agent.ts",
    "src/ai-execution-state.ts",
    "src/acceptance.ts",
  ],
  allowedExpansionPaths: ["src"],
  forbiddenPaths: ["node_modules"],
  requiredEvidencePaths: ["src/chat-agent.ts"],
  requiredClaims: [],
  promptHint: "Analyze the embedded AI layer.",
};

describe("project-aware deterministic fallback sub-queries", () => {
  it("derives embedded-ai questions from target, graph, relationship, and explicit file hints", () => {
    const result = deriveProjectAwareFallbackSubQueries({
      language: "ar",
      message: "اشرح طبقة embedded-ai وكيف تنتقل claims بين المكونات في src/chat-agent.ts",
      projectTarget: embeddedTarget,
      explicitPaths: ["src/chat-agent.ts"],
      graphSummary: [
        "Graph entities:",
        "  • EvidenceLayer <SERVICE> (src/evidence.ts) [92%] {embedded-ai}",
        "Graph relationships:",
        "  • chat-agent → calls → ai-execution-state [88%]",
      ].join("\n"),
    });

    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({
      id: "embedded-ai-evidence-responsibility",
      basis: "project_target",
    });
    expect(result[0]?.question).toContain("ما مسؤولية طبقة evidence");
    expect(result[1]?.question).toContain("claim من read إلى acceptance");
    expect(result.some((query) => query.basis === "graph_entity")).toBe(true);
    expect(result.some((query) => query.basis === "graph_relationship")).toBe(true);
    expect(result.some((query) => query.basis === "explicit_file")).toBe(true);
  });

  it.each([
    ["delivery", "How do changes move from candidate validation to delivery or promotion?"],
    ["authentication", "How does authentication move from request entry through identity/session to authorization?"],
  ])("uses a domain-specific question for %s instead of a generic component question", (message, expected) => {
    const result = deriveProjectAwareFallbackSubQueries({
      message,
      language: "en",
    });

    expect(result[0]?.question).toBe(expected);
    expect(result[0]?.question).not.toContain("What are the main components");
  });

  it("caps navigation hints and states that graph is not final evidence", () => {
    const section = buildProjectAwareFallbackSection({
      message: "Explain embedded-ai architecture",
      projectTarget: embeddedTarget,
      graphSummary: Array.from(
        { length: 12 },
        (_, index) => `  • Entity${index} <SERVICE> (src/entity-${index}.ts) [90%]`,
      ).join("\n"),
      language: "en",
    });

    expect(section).toContain("Project-aware sub-queries");
    expect(section).toContain("Graph entities and relationships guide navigation only");
    expect(section.split("\n").filter((line) => line.startsWith("- ")).length).toBeLessThanOrEqual(5);
  });
});