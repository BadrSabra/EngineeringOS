import { describe, expect, it } from "vitest";
import {
  planGraphRelationshipRefresh,
  type GraphRefreshFullReason,
} from "./scan-graph-refresh-plan.js";

const baseline = {
  scanJobId: "scan-2",
  scanCorrelationId: "scan-session-2",
  revision: "revision-1",
  scannerVersion: "1.0.0",
  previousPaths: [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/config.ts",
    "package.json",
    "go.mod",
  ],
};

const revisionPlan = {
  mode: "incremental" as const,
  previousRevision: "revision-1",
  currentRevision: "revision-2",
  scannerVersion: "1.0.0",
  addedPaths: [],
  modifiedPaths: ["src/a.ts"],
  deletedPaths: [],
  affectedPaths: ["src/a.ts"],
};

type RelationshipFixture = {
  id: string;
  scanJobId: string | null;
  sourcePath: string | null;
  targetPath: string | null;
  isRuntimeObserved: boolean | null;
  provenance: unknown;
};

function relationship(overrides: Partial<RelationshipFixture> = {}): RelationshipFixture {
  return {
    id: "edge-1",
    scanJobId: "scan-2",
    sourcePath: "src/b.ts",
    targetPath: "src/a.ts",
    isRuntimeObserved: false,
    provenance: {
      sourceType: "typescript-ast",
      method: "ts-compiler-api",
      scanSessionId: "scan-session-2",
      extractorVersion: "1.0.0",
      evidence: [{ file: "src/b.ts", kind: "call-site" }],
    },
    ...overrides,
  };
}

function fullReason(result: ReturnType<typeof planGraphRelationshipRefresh>): GraphRefreshFullReason {
  if (result.mode !== "full") throw new Error("Expected a full refresh plan");
  return result.reason;
}

describe("planGraphRelationshipRefresh", () => {
  it("replaces edges whose evidence or either endpoint touches a modified path", () => {
    const result = planGraphRelationshipRefresh({
      revisionPlan,
      baseline,
      relationships: [
        relationship({ id: "target-edge", sourcePath: "src/b.ts", targetPath: "src/a.ts" }),
        relationship({
          id: "evidence-edge",
          sourcePath: "src/b.ts",
          targetPath: "src/c.ts",
          provenance: {
            ...relationship().provenance,
            evidence: [{ file: "src/a.ts", kind: "import-statement" }],
          },
        }),
        relationship({
          id: "unrelated-edge",
          sourcePath: "src/b.ts",
          targetPath: "src/c.ts",
        }),
      ],
    });

    expect(result).toEqual({
      mode: "incremental",
      revision: "revision-2",
      affectedEntityPaths: ["src/a.ts"],
      relationshipIdsToReplace: ["evidence-edge", "target-edge"],
      preservedRuntimeRelationshipCount: 0,
    });
  });

  it("keeps runtime observations outside static invalidation", () => {
    const result = planGraphRelationshipRefresh({
      revisionPlan,
      baseline,
      relationships: [
        relationship({
          id: "runtime-edge",
          isRuntimeObserved: true,
          scanJobId: null,
          provenance: null,
        }),
      ],
    });

    expect(result).toMatchObject({
      mode: "incremental",
      relationshipIdsToReplace: [],
      preservedRuntimeRelationshipCount: 1,
    });
  });

  it("returns a no-op plan when no files changed", () => {
    const noChanges = {
      ...revisionPlan,
      modifiedPaths: [],
      affectedPaths: [],
    };
    expect(planGraphRelationshipRefresh({
      revisionPlan: noChanges,
      baseline,
      relationships: [],
    })).toMatchObject({
      mode: "incremental",
      affectedEntityPaths: [],
      relationshipIdsToReplace: [],
    });
  });

  it.each([
    ["file additions", { ...revisionPlan, addedPaths: ["src/new.ts"], affectedPaths: ["src/a.ts", "src/new.ts"] }, "manifest_change_not_modification_only"],
    ["file deletions", { ...revisionPlan, deletedPaths: ["src/old.ts"], affectedPaths: ["src/a.ts", "src/old.ts"] }, "manifest_change_not_modification_only"],
    ["workspace package alias changes", { ...revisionPlan, modifiedPaths: ["package.json"], affectedPaths: ["package.json"] }, "global_resolution_input_changed"],
    ["Go module identity changes", { ...revisionPlan, modifiedPaths: ["go.mod"], affectedPaths: ["go.mod"] }, "global_resolution_input_changed"],
  ] as const)("uses full refresh for %s", (_label, plan, reason) => {
    const result = planGraphRelationshipRefresh({
      revisionPlan: plan,
      baseline,
      relationships: [],
    });
    expect(fullReason(result)).toBe(reason);
  });

  it.each([
    ["relationship was not produced by the previous scan", relationship({ scanJobId: "scan-old" }), "relationship_not_owned_by_baseline"],
    ["scan session differs", relationship({
      provenance: { ...relationship().provenance, scanSessionId: "old-session" },
    }), "relationship_provenance_mismatch"],
    ["extractor version differs", relationship({
      provenance: { ...relationship().provenance, extractorVersion: "0.9.0" },
    }), "relationship_provenance_mismatch"],
    ["endpoint path is missing", relationship({ targetPath: null }), "relationship_endpoint_path_missing"],
    ["evidence is missing", relationship({
      provenance: { ...relationship().provenance, evidence: [] },
    }), "relationship_evidence_missing"],
    ["evidence references a path outside the baseline", relationship({
      provenance: {
        ...relationship().provenance,
        evidence: [{ file: "../outside.ts", kind: "call-site" }],
      },
    }), "relationship_evidence_path_invalid"],
    ["legacy runtime marker is null", relationship({ isRuntimeObserved: null }), "invalid_relationship_identity"],
  ] as const)("fails closed when %s", (_label, row, reason) => {
    const result = planGraphRelationshipRefresh({
      revisionPlan,
      baseline,
      relationships: [row],
    });
    expect(fullReason(result)).toBe(reason);
  });

  it("rejects a plan whose revisions do not match the stored baseline", () => {
    const result = planGraphRelationshipRefresh({
      revisionPlan: { ...revisionPlan, previousRevision: "stale-revision" },
      baseline,
      relationships: [],
    });
    expect(fullReason(result)).toBe("revision_identity_mismatch");
  });

  it("rejects duplicate relationship identifiers rather than returning an ambiguous write set", () => {
    const result = planGraphRelationshipRefresh({
      revisionPlan,
      baseline,
      relationships: [
        relationship({ id: "duplicate" }),
        relationship({ id: "duplicate" }),
      ],
    });
    expect(fullReason(result)).toBe("invalid_relationship_identity");
  });

  it("rejects a modified path that is not in the previous manifest", () => {
    const result = planGraphRelationshipRefresh({
      revisionPlan: {
        ...revisionPlan,
        modifiedPaths: ["src/missing.ts"],
        affectedPaths: ["src/missing.ts"],
      },
      baseline,
      relationships: [],
    });
    expect(fullReason(result)).toBe("invalid_revision_plan");
  });
});
