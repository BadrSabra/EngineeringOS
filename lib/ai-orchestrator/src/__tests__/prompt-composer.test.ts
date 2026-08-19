import { describe, expect, it } from "vitest";
import { composePrompt, promptContextOverview } from "../prompts/prompt-composer.js";

describe("prompt composer", () => {
  it("drops empty fragments when composing prompts", () => {
    expect(composePrompt("alpha", "", undefined, "beta")).toBe("alpha\n\nbeta");
  });

  it("renders the full project context overview", () => {
    const context = {
      project: "Project A",
      latestMetrics: "Metrics A",
      graphSummary: "Graph A",
      recentTasks: "Tasks A",
      recentEvents: "Events A",
      workflows: "Workflows A",
      metricsVerified: true,
    };

    const result = promptContextOverview(context);

    expect(result).toContain("**Project:**");
    expect(result).toContain("Project A");
    expect(result).toContain("**Quality Metrics:**");
    expect(result).toContain("Metrics A");
    expect(result).toContain("**Knowledge Graph:**");
    expect(result).toContain("Graph A");
    expect(result).toContain("**Workflows:**");
    expect(result).toContain("Workflows A");
    expect(result).toContain("**Recent Tasks:**");
    expect(result).toContain("Tasks A");
    expect(result).toContain("**Recent Events:**");
    expect(result).toContain("Events A");
  });

  it("renders a slimmer task profile without workflows", () => {
    const context = {
      project: "Project A",
      latestMetrics: "Metrics A",
      graphSummary: "Graph A",
      recentTasks: "Tasks A",
      recentEvents: "Events A",
      workflows: "Workflows A",
      metricsVerified: true,
    };

    const result = promptContextOverview(context, "task");

    expect(result).toContain("**Project:**");
    expect(result).toContain("Project A");
    expect(result).toContain("**Quality Metrics:**");
    expect(result).toContain("Metrics A");
    expect(result).toContain("**Knowledge Graph:**");
    expect(result).toContain("Graph A");
    expect(result).toContain("**Recent Tasks:**");
    expect(result).toContain("Tasks A");
    expect(result).toContain("**Recent Events:**");
    expect(result).toContain("Events A");
    expect(result).not.toContain("**Workflows:**");
  });
});
