import { describe, expect, it } from "vitest";
import {
  buildCrossFileSemanticTrace,
  buildProductionReachabilityTrace,
  ProductionReachabilityTraceSchema,
} from "../semantic-trace.js";

describe("semantic trace builders", () => {
  const nodes = [
    { id: "entry", name: "POST /chat", path: "src/routes/chat.ts", stage: "API_ROUTE" as const },
    { id: "agent", name: "chat", path: "lib/ai-orchestrator/src/agents/chat-agent.ts", stage: "ORCHESTRATOR" as const },
    { id: "provider", name: "GroqClient", path: "lib/ai-orchestrator/src/groq-client.ts", stage: "TOOL_PROVIDER" as const },
  ];

  it("builds a bounded cross-file path and preserves edge provenance", () => {
    const trace = buildCrossFileSemanticTrace({
      nodes,
      from: "entry",
      to: "provider",
      edges: [
        {
          source: "entry",
          target: "agent",
          relation: "calls",
          sourcePath: "src/routes/chat.ts",
          evidence: "chat(req)",
          sourceSpan: { file: "src/routes/chat.ts", line: 42, column: 7, snippet: "chat(req)" },
        },
        { source: "agent", target: "provider", relation: "calls", sourcePath: "lib/ai-orchestrator/src/agents/chat-agent.ts" },
      ],
      maxDepth: 3,
    });
    expect(trace.status).toBe("NOT_PROVEN");
    expect(trace.nodes.map((node) => node.id)).toEqual(["entry", "agent", "provider"]);
    expect(trace.edges[0]).toMatchObject({ status: "PROVEN", source: "src/routes/chat.ts" });
    expect(trace.edges[0].sourceSpan).toEqual({
      file: "src/routes/chat.ts",
      line: 42,
      column: 7,
      snippet: "chat(req)",
    });
    expect(trace.edges[1]).toMatchObject({ status: "NOT_PROVEN" });
  });

  it("does not convert an unbounded or missing graph path into production proof", () => {
    const trace = buildCrossFileSemanticTrace({
      nodes,
      from: "entry",
      to: "missing",
      edges: [],
      maxDepth: 20,
    });
    expect(trace.status).toBe("OUT_OF_SCOPE");
    expect(trace.maxDepth).toBe(8);
  });

  it("requires runtime-observed evidence for PROVEN production reachability", () => {
    const staticTrace = buildProductionReachabilityTrace([{
      from: { id: "entry", name: "POST /chat", stage: "API_ROUTE" },
      to: { id: "agent", name: "chat", stage: "ORCHESTRATOR" },
      relation: "calls",
      evidence: "route handler",
    }]);
    expect(staticTrace.status).toBe("NOT_PROVEN");

    const runtimeTrace = buildProductionReachabilityTrace([{
      from: { id: "entry", name: "POST /chat", stage: "API_ROUTE" },
      to: { id: "agent", name: "chat", stage: "ORCHESTRATOR" },
      relation: "calls",
      evidence: "request trace #1",
      runtimeObserved: true,
    }]);
    expect(ProductionReachabilityTraceSchema.safeParse(runtimeTrace).success).toBe(true);
    expect(runtimeTrace.status).toBe("PROVEN");
  });
});