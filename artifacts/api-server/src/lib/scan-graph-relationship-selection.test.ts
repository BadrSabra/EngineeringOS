import { describe, expect, it } from "vitest";
import {
  selectExtractedRelationshipsForRefresh,
  sortAffectedRelationshipPaths,
} from "./scan-graph-relationship-selection.js";

type Fixture = {
  id: string;
  sourceName: string;
  targetName: string;
  sourcePath?: string;
  targetPath?: string;
  isRuntimeObserved?: boolean;
  provenance?: unknown;
};

const currentPaths = ["src/a.ts", "src/b.ts", "src/c.ts"];

function relationship(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: "edge-1",
    sourceName: "src/b.ts",
    targetName: "src/c.ts",
    sourcePath: "src/b.ts",
    targetPath: "src/c.ts",
    isRuntimeObserved: false,
    provenance: {
      sourceType: "typescript-ast",
      method: "ts-compiler-api",
      evidence: [{ file: "src/b.ts", kind: "call-site" }],
    },
    ...overrides,
  };
}

describe("selectExtractedRelationshipsForRefresh", () => {
  it("selects relationships whose source endpoint is modified", () => {
    const touched = relationship({ id: "source-edge", sourcePath: "src/a.ts" });
    const untouched = relationship({ id: "unrelated-edge" });

    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["src/a.ts"],
      relationships: [touched, untouched],
    })).toEqual({
      mode: "incremental",
      relationships: [touched],
      selectedCount: 1,
      inspectedCount: 2,
    });
  });

  it("selects relationships whose target endpoint is modified", () => {
    const touched = relationship({ targetPath: "src/a.ts" });
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["src/a.ts"],
      relationships: [touched],
    })).toMatchObject({ mode: "incremental", relationships: [touched] });
  });

  it("selects relationships whose provenance evidence alone is modified", () => {
    const touched = relationship({
      provenance: {
        sourceType: "typescript-ast",
        method: "ts-compiler-api",
        evidence: [{ file: "src/a.ts", kind: "import-statement" }],
      },
    });
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["src/a.ts"],
      relationships: [touched],
    })).toMatchObject({ mode: "incremental", relationships: [touched] });
  });

  it("derives omitted import endpoint paths only from exact manifest path names", () => {
    const importEdge = relationship({
      sourceName: "src/a.ts",
      targetName: "src/c.ts",
      sourcePath: undefined,
      targetPath: undefined,
      provenance: {
        sourceType: "typescript-ast",
        method: "ts-compiler-api",
        evidence: [{ file: "src/a.ts", kind: "import-statement" }],
      },
    });
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["src/a.ts"],
      relationships: [importEdge],
    })).toMatchObject({ mode: "incremental", relationships: [importEdge] });
  });

  it("ignores runtime observations because they have a separate persistence lifecycle", () => {
    const runtime = relationship({
      isRuntimeObserved: true,
      sourcePath: undefined,
      targetPath: undefined,
      provenance: null,
    });
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["src/a.ts"],
      relationships: [runtime],
    })).toMatchObject({ mode: "incremental", relationships: [], selectedCount: 0 });
  });

  it("returns an empty selection for a no-op refresh", () => {
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: [],
      relationships: [],
    })).toEqual({
      mode: "incremental",
      relationships: [],
      selectedCount: 0,
      inspectedCount: 0,
    });
  });

  it.each([
    ["missing endpoint path", relationship({ targetPath: undefined, targetName: "external-package" }), "relationship_endpoint_path_missing"],
    ["missing provenance", relationship({ provenance: null }), "relationship_provenance_missing"],
    ["missing evidence", relationship({ provenance: { sourceType: "x", method: "y", evidence: [] } }), "relationship_evidence_missing"],
    ["unsafe evidence path", relationship({ provenance: { sourceType: "x", method: "y", evidence: [{ file: "../outside.ts" }] } }), "relationship_evidence_path_invalid"],
    ["evidence path not in the current manifest", relationship({ provenance: { sourceType: "x", method: "y", evidence: [{ file: "src/deleted.ts" }] } }), "relationship_evidence_path_invalid"],
    ["null runtime marker", relationship({ isRuntimeObserved: null as unknown as boolean }), "invalid_runtime_marker"],
  ] as const)("falls back to full selection for %s", (_label, candidate, reason) => {
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["src/a.ts"],
      relationships: [candidate],
    })).toEqual({ mode: "full", reason });
  });

  it("rejects affected paths absent from the current manifest", () => {
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["src/deleted.ts"],
      relationships: [],
    })).toEqual({ mode: "full", reason: "affected_path_missing_from_current_manifest" });
  });

  it("rejects duplicate or unsafe path inventories", () => {
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths: ["src/a.ts", "src/a.ts"],
      affectedPaths: ["src/a.ts"],
      relationships: [],
    })).toEqual({ mode: "full", reason: "invalid_current_paths" });
    expect(selectExtractedRelationshipsForRefresh({
      currentPaths,
      affectedPaths: ["../outside.ts"],
      relationships: [],
    })).toEqual({ mode: "full", reason: "invalid_affected_paths" });
  });

  it("sorts affected paths without mutating the caller's array", () => {
    const input = ["src/z.ts", "src/a.ts"];
    expect(sortAffectedRelationshipPaths(input)).toEqual(["src/a.ts", "src/z.ts"]);
    expect(input).toEqual(["src/z.ts", "src/a.ts"]);
  });
});
