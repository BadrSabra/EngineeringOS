export type TruthNodeStatus = "complete" | "partial" | "missing";

export interface TruthFlowNode {
  node: string;
  status: TruthNodeStatus;
  confidence: number;
  nextAction: string;
  exactRepoPaths: string[];
}

export interface TruthFlowMatrix {
  title: string;
  version: string;
  description: string;
  nodes: TruthFlowNode[];
}

export const engineeringOSTruthFlowMatrix: TruthFlowMatrix = {
  title: "EngineeringOS Truth Flow Matrix",
  version: "1.0.0",
  description: "Executable truth-flow reference for EngineeringOS verification and build governance.",
  nodes: [
    { node: "Source Contracts", status: "partial", confidence: 0.9, nextAction: "Add mandatory contract drift checks between OpenAPI, DB schema, and runtime routes.", exactRepoPaths: ["lib/api-spec/openapi.yaml", "lib/db/src/schema/*", "docs/fact-record.md", "docs/completion-plan.md"] },
    { node: "Codegen Layer", status: "partial", confidence: 0.92, nextAction: "Trigger regeneration and hash/shape verification whenever contract files change.", exactRepoPaths: ["lib/api-spec/orval.config.ts", "lib/api-zod/src/generated/*", "lib/api-client-react/src/generated/*"] },
    { node: "Dashboard Consumption", status: "partial", confidence: 0.85, nextAction: "Ensure all dashboard calls go through generated clients only.", exactRepoPaths: ["artifacts/dashboard/src/pages/*", "artifacts/dashboard/src/components/*", "lib/api-client-react/src/generated/*"] },
    { node: "API Runtime", status: "partial", confidence: 0.88, nextAction: "Expand contract/runtime parity tests and enforce auth/access/audit review for new routes.", exactRepoPaths: ["artifacts/api-server/src/app.ts", "artifacts/api-server/src/index.ts", "artifacts/api-server/src/routes/*", "artifacts/api-server/src/middlewares/requireAuth.ts", "artifacts/api-server/src/middlewares/requireProjectAccess.ts"] },
    { node: "Audit / Event Trace", status: "partial", confidence: 0.84, nextAction: "Require correlation IDs and prove trace completeness across audit/events/metrics.", exactRepoPaths: ["artifacts/api-server/src/lib/audit.ts", "artifacts/api-server/src/routes/events.ts", "artifacts/api-server/src/routes/metrics.ts", "artifacts/api-server/src/routes/tasks.ts"] },
    { node: "Discovery / Scan", status: "partial", confidence: 0.87, nextAction: "Make discovery replayable and measure completeness/classification drift.", exactRepoPaths: ["artifacts/api-server/src/routes/discovery.ts", "artifacts/api-server/src/lib/scan-runner.ts", "lib/scanner/src/*"] },
    { node: "Knowledge Graph", status: "partial", confidence: 0.89, nextAction: "Promote the graph from artifact graph to engineering knowledge graph and verify relation consistency.", exactRepoPaths: ["artifacts/api-server/src/routes/graph.ts", "lib/knowledge-engine/src/*", "lib/db/src/schema/*"] },
    { node: "Provenance Import", status: "complete", confidence: 0.98, nextAction: "Version imports and compare seed/linked/current snapshots for drift.", exactRepoPaths: ["artifacts/api-server/src/scripts/seed-provenance.ts", "attached_assets/EngineeringOS_provenance_registry_seed_*.json", "attached_assets/EngineeringOS_provenance_registry_linked_*.json"] },
    { node: "Decision Memory", status: "partial", confidence: 0.82, nextAction: "Promote memory notes into a formal decision registry with supersession tracking.", exactRepoPaths: [".agents/memory/*", "docs/completion-plan.md", "docs/fact-record.md"] },
    { node: "Historical Archive", status: "complete", confidence: 0.95, nextAction: "Classify archive files as historical-only or evidence-supporting and never as current truth.", exactRepoPaths: ["attached_assets/*", "docs/*"] },
    { node: "AI Orchestration", status: "partial", confidence: 0.8, nextAction: "Restrict AI to verified truth context and add stale-data guardrails.", exactRepoPaths: ["lib/ai-orchestrator/src/*", "artifacts/api-server/src/routes/ai.ts"] },
    { node: "Truth Governance / ETV", status: "missing", confidence: 0.93, nextAction: "Build the operational Engineering Truth Verification service: rules, runs, findings, drift register, snapshots.", exactRepoPaths: ["docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md", "docs/fact-record.md", "docs/completion-plan.md"] },
  ],
};
