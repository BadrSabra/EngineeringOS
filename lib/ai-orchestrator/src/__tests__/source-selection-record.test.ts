/**
 * PR-011: unit tests for deriveSourceSelectionRecord.
 *
 * Covers:
 *  1. plannerTier — targeted / graph_enriched / fallback transitions
 *  2. Planned-file status classification (READ_CACHED → READ_COMPLETE, etc.)
 *  3. Model-chosen files appear in fileStatuses with origin "model_chosen"
 *  4. Files absent from the map get READ_SKIPPED
 *  5. MAX_PLANNED_FILES (20) and MAX_FILE_STATUSES (40) caps
 *  6. truncatedPlannedCount and skippedPlannedCount accuracy
 */

import { describe, it, expect } from "vitest";

const MINIMAL_PLAN = {
  originalIntent: "test query",
  targetEntities: [],
  scopeEstimate: "narrow" as const,
  suggestedIterations: 8,
  requiresToolUse: true,
  subQueries: [],
  compoundParts: [],
  planStatus: "valid" as const,
};

describe("deriveSourceSelectionRecord — plannerTier", () => {
  it("returns 'targeted' for a valid plan without graph enrichment", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = { ...MINIMAL_PLAN, targetFiles: ["src/auth.ts"] };
    const result = deriveSourceSelectionRecord(plan, new Map());
    expect(result.plannerTier).toBe("targeted");
  });

  it("returns 'graph_enriched' when graphEnriched is true", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = {
      ...MINIMAL_PLAN,
      targetFiles: ["src/auth.ts", "src/graph-node.ts"],
      graphEnriched: true,
    };
    const result = deriveSourceSelectionRecord(plan, new Map());
    expect(result.plannerTier).toBe("graph_enriched");
  });

  it("returns 'fallback' when planStatus is 'fallback'", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = {
      ...MINIMAL_PLAN,
      targetFiles: [],
      planStatus: "fallback" as const,
    };
    const result = deriveSourceSelectionRecord(plan, new Map());
    expect(result.plannerTier).toBe("fallback");
  });

  it("returns 'fallback' when planStatus is 'invalid'", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = {
      ...MINIMAL_PLAN,
      targetFiles: ["src/auth.ts"],
      planStatus: "invalid" as const,
      graphEnriched: true, // should be ignored for invalid plans
    };
    const result = deriveSourceSelectionRecord(plan, new Map());
    expect(result.plannerTier).toBe("fallback");
  });
});

describe("deriveSourceSelectionRecord — read-status classification", () => {
  it("maps READ_CACHED to READ_COMPLETE in the public record", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = { ...MINIMAL_PLAN, targetFiles: ["src/auth.ts"] };
    const readStatuses = new Map([["src/auth.ts", "READ_CACHED"]]);
    const result = deriveSourceSelectionRecord(plan, readStatuses);
    const entry = result.fileStatuses.find((e) => e.path === "src/auth.ts");
    expect(entry?.readStatus).toBe("READ_COMPLETE");
    expect(entry?.origin).toBe("planned");
  });

  it("maps READ_TRUNCATED correctly", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = { ...MINIMAL_PLAN, targetFiles: ["src/big.ts"] };
    const readStatuses = new Map([["src/big.ts", "READ_TRUNCATED"]]);
    const result = deriveSourceSelectionRecord(plan, readStatuses);
    const entry = result.fileStatuses.find((e) => e.path === "src/big.ts");
    expect(entry?.readStatus).toBe("READ_TRUNCATED");
  });

  it("marks planned files absent from the map as READ_SKIPPED", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = {
      ...MINIMAL_PLAN,
      targetFiles: ["src/auth.ts", "src/unread.ts"],
    };
    const readStatuses = new Map([["src/auth.ts", "READ_COMPLETE"]]);
    const result = deriveSourceSelectionRecord(plan, readStatuses);
    const skipped = result.fileStatuses.find((e) => e.path === "src/unread.ts");
    expect(skipped?.readStatus).toBe("READ_SKIPPED");
    expect(result.skippedPlannedCount).toBe(1);
  });

  it("counts truncatedPlannedCount accurately across mixed statuses", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = {
      ...MINIMAL_PLAN,
      targetFiles: ["a.ts", "b.ts", "c.ts"],
    };
    const readStatuses = new Map([
      ["a.ts", "READ_COMPLETE"],
      ["b.ts", "READ_TRUNCATED"],
      ["c.ts", "READ_TRUNCATED"],
    ]);
    const result = deriveSourceSelectionRecord(plan, readStatuses);
    expect(result.truncatedPlannedCount).toBe(2);
    expect(result.skippedPlannedCount).toBe(0);
  });
});

describe("deriveSourceSelectionRecord — model-chosen files", () => {
  it("adds files not in the plan as model_chosen with correct status", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = { ...MINIMAL_PLAN, targetFiles: ["src/auth.ts"] };
    const readStatuses = new Map([
      ["src/auth.ts", "READ_COMPLETE"],
      ["src/utils.ts", "READ_COMPLETE"],     // not in plan
      ["src/helpers.ts", "READ_TRUNCATED"],  // not in plan
    ]);
    const result = deriveSourceSelectionRecord(plan, readStatuses);
    const utils = result.fileStatuses.find((e) => e.path === "src/utils.ts");
    const helpers = result.fileStatuses.find((e) => e.path === "src/helpers.ts");
    expect(utils?.origin).toBe("model_chosen");
    expect(utils?.readStatus).toBe("READ_COMPLETE");
    expect(helpers?.origin).toBe("model_chosen");
    expect(helpers?.readStatus).toBe("READ_TRUNCATED");
  });

  it("plannedFiles contains only plan files up to MAX_PLANNED_FILES (20)", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    // Supply 25 planned files — expect cap at 20
    const files = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
    const plan = { ...MINIMAL_PLAN, targetFiles: files };
    const result = deriveSourceSelectionRecord(plan, new Map());
    expect(result.plannedFiles).toHaveLength(20);
  });

  it("fileStatuses is capped at 40 entries", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plannedFiles = Array.from({ length: 20 }, (_, i) => `p${i}.ts`);
    const plan = { ...MINIMAL_PLAN, targetFiles: plannedFiles };
    // 20 planned + 30 model-chosen = 50 → capped at 40
    const readStatuses = new Map<string, string>([
      ...plannedFiles.map((f) => [f, "READ_COMPLETE"] as [string, string]),
      ...Array.from({ length: 30 }, (_, i) => [
        `extra${i}.ts`,
        "READ_COMPLETE",
      ] as [string, string]),
    ]);
    const result = deriveSourceSelectionRecord(plan, readStatuses);
    expect(result.fileStatuses.length).toBeLessThanOrEqual(40);
  });
});

describe("deriveSourceSelectionRecord — path normalization", () => {
  it("matches plan paths against normalised keys (removes leading ./)", async () => {
    const { deriveSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const plan = { ...MINIMAL_PLAN, targetFiles: ["src/auth.ts"] };
    // Map uses a slightly different form — should still match
    const readStatuses = new Map([["./src/auth.ts", "READ_COMPLETE"]]);
    const result = deriveSourceSelectionRecord(plan, readStatuses);
    const entry = result.fileStatuses.find((e) => e.path === "src/auth.ts");
    expect(entry?.readStatus).toBe("READ_COMPLETE");
  });
});

describe("deriveOrientationSourceSelectionRecord — provider fallback", () => {
  const ORIENTATION_SOURCES = {
    purpose: ["README.md"],
    components: ["src/App.tsx"],
    primaryFlow: ["src/main.tsx"],
    uncertainty: ["docs/architecture.md"],
  };

  it("preserves complete role coverage when provider synthesis is exhausted", async () => {
    const { deriveOrientationSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const result = deriveOrientationSourceSelectionRecord(
      ORIENTATION_SOURCES,
      new Map([
        ["README.md", "READ_COMPLETE"],
        ["src/App.tsx", "READ_COMPLETE"],
        ["src/main.tsx", "READ_COMPLETE"],
        ["docs/architecture.md", "READ_COMPLETE"],
      ]),
    );

    expect(result.plannerTier).toBe("fallback");
    expect(result.orientationCoverage).toMatchObject({
      complete: true,
      missingRoles: [],
    });
  });

  it("keeps provider fallback incomplete when a durable role has no complete read", async () => {
    const { deriveOrientationSourceSelectionRecord } = await import(
      "../agents/query-planner.js"
    );
    const result = deriveOrientationSourceSelectionRecord(
      ORIENTATION_SOURCES,
      new Map([
        ["README.md", "READ_COMPLETE"],
        ["src/App.tsx", "READ_COMPLETE"],
        ["src/main.tsx", "READ_TRUNCATED"],
        ["docs/architecture.md", "READ_FAILED"],
      ]),
    );

    expect(result.orientationCoverage).toMatchObject({
      complete: false,
      missingRoles: ["primaryFlow", "uncertainty"],
    });
  });
});
