import { describe, expect, it } from "vitest";
import { buildCodeReviewUserPrompt } from "../prompts/review.prompt.js";
import { normalizeReviewInputs } from "../review-scope.js";
import type { ProjectContext } from "../context-builder.js";

const context: ProjectContext = {
  project: "Project",
  latestMetrics: "Overall: 88/100 | Sec: 90",
  graphSummary: "12 entities total:\nRelationships (8 shown):",
  recentTasks: "No tasks yet",
  recentEvents: "No recent events",
  workflows: "[section excluded — not relevant for this task type]",
  metricsVerified: true,
  contextManifest: {
    projectId: "project",
    projectRevision: "revision",
    scanCompleteness: "PARTIAL",
    sourceProvenance: "test",
    capturedAt: "2026-08-31T00:00:00.000Z",
  },
};

describe("bounded code-review scope", () => {
  it("uses the same five-file and excerpt limits for prompt and metadata", () => {
    const files = Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => [
        `src/file-${index}.ts`,
        index === 0 ? "x".repeat(1600) : `export const value${index} = ${index};`,
      ]),
    );
    const normalized = normalizeReviewInputs(context, files);
    const prompt = buildCodeReviewUserPrompt(context, files);

    expect(Object.keys(normalized.fileContents)).toHaveLength(5);
    expect(normalized.scope.selectedFiles).toEqual({
      received: 7,
      included: 5,
      omitted: 2,
      clippedExcerpts: 1,
    });
    expect(normalized.fileContents["src/file-0.ts"]).toHaveLength(1500);
    expect(prompt).toContain("5 of 7 selected source files are included");
    expect(prompt).toContain("excerpts capped at 1500 characters");
    expect(prompt).not.toContain("file-5.ts");
    expect(prompt.toLowerCase()).toContain("bounded review");
    expect(prompt).toContain("Do not claim repository-wide coverage");
  });

  it("allows empirical reviews to include complete bounded evidence without changing normal excerpts", () => {
    const source = `${"x".repeat(1800)}\nTARGET_EVIDENCE`;
    const normal = normalizeReviewInputs(context, { "src/auth.ts": source });
    const empirical = normalizeReviewInputs(context, { "src/auth.ts": source }, {
      maxExcerptChars: 24_000,
      maxTotalExcerptChars: 24_000,
    });
    const prompt = buildCodeReviewUserPrompt(context, { "src/auth.ts": source }, {
      empiricalStrictEvidence: true,
      maxExcerptChars: 24_000,
      maxTotalExcerptChars: 24_000,
    });

    expect(normal.fileContents["src/auth.ts"]).toHaveLength(1500);
    expect(normal.scope.selectedFiles.clippedExcerpts).toBe(1);
    expect(empirical.fileContents["src/auth.ts"]).toContain("TARGET_EVIDENCE");
    expect(empirical.scope.selectedFiles.clippedExcerpts).toBe(0);
    expect(prompt).toContain("TARGET_EVIDENCE");
    expect(prompt).toContain("An empty issues array is valid");
    expect(prompt).not.toMatch(/must include at least one issue/i);
  });

  it("reports graph-and-metrics-only reviews without source contents in metadata", () => {
    const normalized = normalizeReviewInputs(context);

    expect(normalized.scope.mode).toBe("GRAPH_METRICS");
    expect(normalized.scope.selectedFiles).toEqual({
      received: 0,
      included: 0,
      omitted: 0,
      clippedExcerpts: 0,
    });
    expect(normalized.scope.context.graphEntitiesIncluded).toBe(12);
    expect(normalized.scope.context.graphRelationshipsIncluded).toBe(8);
    expect(normalized.scope.scanCompleteness).toBe("PARTIAL");
    expect(normalized.scope.limitations.join(" ")).toContain("No selected source-file excerpts");
    expect(JSON.stringify(normalized.scope)).not.toContain("export const");
  });
});