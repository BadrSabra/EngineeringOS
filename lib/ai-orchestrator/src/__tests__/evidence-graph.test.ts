import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "../evidence-graph.js";

describe("shared evidence graph", () => {
  it("deduplicates a read shared by multiple sub-queries", () => {
    const graph = buildEvidenceGraph({
      sourceEvidence: [
        { file: "src/flow.ts", startLine: 10, endLine: 24, taskIndex: 0 },
        { file: "./src/flow.ts", startLine: 10, endLine: 24, taskIndex: 1 },
      ],
      subQueries: [
        {
          taskIndex: 0,
          intent: "Trace the request flow",
          status: "complete",
          sourceEvidence: [{ file: "src/flow.ts", startLine: 10, endLine: 24, taskIndex: 0 }],
        },
        {
          taskIndex: 1,
          intent: "Check the provider handoff",
          status: "partial",
          sourceEvidence: [{ file: "src/flow.ts", startLine: 10, endLine: 24, taskIndex: 1 }],
        },
      ],
    });

    expect(graph.reads).toHaveLength(1);
    expect(graph.reads[0]?.taskIndexes).toEqual([0, 1]);
    expect(graph.nodes.filter((node) => node.kind === "FILE")).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.relation === "CONTRIBUTES_TO")).toHaveLength(2);
  });

  it("connects file, symbol, claim, sub-query, and verdict without trusting prose", () => {
    const graph = buildEvidenceGraph({
      sourceEvidence: [
        { file: "src/provider.ts", startLine: 30, endLine: 42, taskIndex: 2 },
      ],
      crossFileTraces: [{
        nodes: [{ id: "src/provider.ts#send", name: "send", path: "src/provider.ts" }],
      }],
      claims: [{
        claimId: "provider-handoff",
        text: "The provider handoff is reached",
        requiredEvidencePaths: ["src/provider.ts"],
      }],
      subQueries: [{
        taskIndex: 2,
        intent: "Inspect the provider handoff",
        status: "complete",
        sourceEvidence: [{ file: "src/provider.ts", startLine: 30, endLine: 42, taskIndex: 2 }],
      }],
      claimStatuses: { "provider-handoff": "PROVEN" },
    });

    expect(graph.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(["FILE", "SYMBOL", "CLAIM", "SUB_QUERY", "VERDICT"]),
    );
    expect(graph.edges.map((edge) => edge.relation)).toEqual(
      expect.arrayContaining(["CONTAINS", "SUPPORTS", "INVESTIGATED_BY", "CONTRIBUTES_TO"]),
    );
    expect(graph.nodes.find((node) => node.id === "verdict:provider-handoff")?.status).toBe("PROVEN");
  });

  it("makes contradictions explicit and keeps the verdict non-proven", () => {
    const graph = buildEvidenceGraph({
      sourceEvidence: [{ file: "src/flow.ts", startLine: 1, endLine: 8, taskIndex: 0 }],
      claims: [{
        claimId: "flow-claim",
        text: "The flow is consistent",
        requiredEvidencePaths: ["src/flow.ts"],
      }],
      subQueries: [{
        taskIndex: 0,
        intent: "Check the flow",
        status: "complete",
        sourceEvidence: [{ file: "src/flow.ts", startLine: 1, endLine: 8, taskIndex: 0 }],
      }],
      claimStatuses: { "flow-claim": "PROVEN" },
      contradictionClaimIds: ["flow-claim"],
    });

    expect(graph.contradictionClaimIds).toEqual(["flow-claim"]);
    expect(graph.nodes.find((node) => node.id === "claim:flow-claim")?.status).toBe("CONTRADICTED");
    expect(graph.nodes.find((node) => node.id === "verdict:flow-claim")?.status).toBe("CONTRADICTED");
    expect(graph.edges.some((edge) => edge.relation === "CONTRADICTS")).toBe(true);
  });
});