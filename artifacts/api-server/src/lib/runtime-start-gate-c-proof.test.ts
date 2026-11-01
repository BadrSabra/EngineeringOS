import { describe, expect, it } from "vitest";
import {
  classifyRuntimeStartGateCSourceRevision,
  normalizeStoredRuntimeStartGateCProofArtifact,
} from "./runtime-start-gate-c-proof.js";

describe("runtime.start Gate C source revision contract", () => {
  it("classifies the exact workspace-tree digest emitted by the resolver", () => {
    expect(classifyRuntimeStartGateCSourceRevision(`workspace-tree-v1:${"a".repeat(64)}`))
      .toEqual({
        sourceRevisionKind: "workspace_tree",
        sourceRevisionSource: "delivery_tree_digest_v1",
      });
  });

  it.each([
    ["40-character Git SHA", "a".repeat(40)],
    ["64-character Git SHA", "b".repeat(64)],
  ])("preserves %s support", (_label, value) => {
    expect(classifyRuntimeStartGateCSourceRevision(value)).toEqual({
      sourceRevisionKind: "git_commit",
      sourceRevisionSource: "git_commit_object_id",
    });
  });

  it.each([
    ["wrong prefix", `workspace-tree-v2:${"a".repeat(64)}`],
    ["short workspace digest", `workspace-tree-v1:${"a".repeat(63)}`],
    ["non-hex workspace digest", `workspace-tree-v1:${"g".repeat(64)}`],
    ["uppercase workspace digest", `workspace-tree-v1:${"A".repeat(64)}`],
    ["uppercase workspace prefix", `Workspace-tree-v1:${"a".repeat(64)}`],
    ["short Git SHA", "a".repeat(39)],
    ["unsupported Git SHA length", "a".repeat(41)],
    ["unsupported SHA-256 length", "a".repeat(63)],
    ["arbitrary revision", "revision-1"],
  ])("rejects %s", (_label, value) => {
    expect(classifyRuntimeStartGateCSourceRevision(value)).toBeUndefined();
  });

  it("upgrades only legacy raw-Git artifacts with inferred Git provenance", () => {
    const upgraded = normalizeStoredRuntimeStartGateCProofArtifact({
      kind: "runtime_start_gate_c",
      version: 1,
      sourceRevision: "c".repeat(40),
    });

    expect(upgraded).toMatchObject({
      kind: "runtime_start_gate_c",
      version: 2,
      sourceRevision: "c".repeat(40),
      sourceRevisionKind: "git_commit",
      sourceRevisionSource: "git_commit_object_id",
    });
  });

  it("does not reinterpret legacy artifacts as workspace-tree proofs", () => {
    expect(normalizeStoredRuntimeStartGateCProofArtifact({
      kind: "runtime_start_gate_c",
      version: 1,
      sourceRevision: `workspace-tree-v1:${"d".repeat(64)}`,
    })).toBeUndefined();
  });

  it("rejects v2 artifacts whose persisted revision provenance conflicts with the revision", () => {
    expect(normalizeStoredRuntimeStartGateCProofArtifact({
      kind: "runtime_start_gate_c",
      version: 2,
      sourceRevision: `workspace-tree-v1:${"e".repeat(64)}`,
      sourceRevisionKind: "git_commit",
      sourceRevisionSource: "git_commit_object_id",
    })).toBeUndefined();
  });
});
