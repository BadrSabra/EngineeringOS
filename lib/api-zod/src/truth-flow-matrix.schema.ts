
import { z } from "zod";

/**
 * EngineeringOS Truth Flow Matrix
 *
 * Source-aligned Zod schema for the current truth-flow reference.
 * - General schema: accepts any well-formed matrix.
 * - Current reference schema: validates against the live baseline captured in the
 *   current execution constitution.
 */

export const TruthFlowNodeStatusSchema = z.enum([
  "complete",
  "partial",
  "missing",
]);

export type TruthFlowNodeStatus = z.infer<typeof TruthFlowNodeStatusSchema>;

const NonEmptyTextSchema = z.string().trim().min(1);

const RepoPathSchema = NonEmptyTextSchema.refine(
  (value) => !value.startsWith("/") && !value.includes("\\"),
  { message: "Repository paths must be repo-relative and use forward slashes." },
);

export const TruthFlowNodeSchema = z.object({
  node: NonEmptyTextSchema,
  status: TruthFlowNodeStatusSchema,
  confidence: z.number().min(0).max(1),
  nextAction: NonEmptyTextSchema,
  exactRepoPaths: z.array(RepoPathSchema).min(1),
}).strict();

export type TruthFlowNode = z.infer<typeof TruthFlowNodeSchema>;

/**
 * Base object schema — no refinements attached, so `.extend()` works downstream.
 */
const TruthFlowMatrixBaseSchema = z.object({
  title: NonEmptyTextSchema,
  version: NonEmptyTextSchema,
  description: NonEmptyTextSchema,
  nodes: z.array(TruthFlowNodeSchema).min(1),
}).strict();

/** Shared duplicate-check refinement applied to both general and current schemas. */
function addDuplicateChecks<T extends { nodes: Array<{ node: string; exactRepoPaths: string[] }> }>(
  matrix: T,
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();

  matrix.nodes.forEach((node, index) => {
    if (seen.has(node.node)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes", index, "node"],
        message: `Duplicate node name: ${node.node}`,
      });
      return;
    }
    seen.add(node.node);

    const pathSet = new Set<string>();
    node.exactRepoPaths.forEach((repoPath, repoIndex) => {
      if (pathSet.has(repoPath)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes", index, "exactRepoPaths", repoIndex],
          message: `Duplicate repo path in node "${node.node}": ${repoPath}`,
        });
        return;
      }
      pathSet.add(repoPath);
    });
  });
}

export const TruthFlowMatrixSchema = TruthFlowMatrixBaseSchema.superRefine(addDuplicateChecks);

export type TruthFlowMatrix = z.infer<typeof TruthFlowMatrixSchema>;

const EXPECTED_CURRENT_TRUTH_FLOW_MATRIX = {
  title: "EngineeringOS Truth Flow Matrix",
  version: "1.0.0",
  description: "Executable truth-flow reference for EngineeringOS verification and build governance.",
  nodes: [
  {
    node: "Source Contracts",
    status: "partial",
    confidence: 0.9,
    nextAction: "Add mandatory contract drift checks between OpenAPI, DB schema, and runtime routes.",
    exactRepoPaths: [
      "lib/api-spec/openapi.yaml",
      "lib/db/src/schema/*",
      "docs/fact-record.md",
      "docs/completion-plan.md"
    ],
  },
  {
    node: "Codegen Layer",
    status: "partial",
    confidence: 0.92,
    nextAction: "Trigger regeneration and hash/shape verification whenever contract files change.",
    exactRepoPaths: [
      "lib/api-spec/orval.config.ts",
      "lib/api-zod/src/generated/*",
      "lib/api-client-react/src/generated/*"
    ],
  },
  {
    node: "Dashboard Consumption",
    status: "partial",
    confidence: 0.85,
    nextAction: "Ensure all dashboard calls go through generated clients only.",
    exactRepoPaths: [
      "artifacts/dashboard/src/pages/*",
      "artifacts/dashboard/src/components/*",
      "lib/api-client-react/src/generated/*"
    ],
  },
  {
    node: "API Runtime",
    status: "partial",
    confidence: 0.88,
    nextAction: "Expand contract/runtime parity tests and enforce auth/access/audit review for new routes.",
    exactRepoPaths: [
      "artifacts/api-server/src/app.ts",
      "artifacts/api-server/src/index.ts",
      "artifacts/api-server/src/routes/*",
      "artifacts/api-server/src/middlewares/requireAuth.ts",
      "artifacts/api-server/src/middlewares/requireProjectAccess.ts"
    ],
  },
  {
    node: "Audit / Event Trace",
    status: "partial",
    confidence: 0.84,
    nextAction: "Require correlation IDs and prove trace completeness across audit/events/metrics.",
    exactRepoPaths: [
      "artifacts/api-server/src/lib/audit.ts",
      "artifacts/api-server/src/routes/events.ts",
      "artifacts/api-server/src/routes/metrics.ts",
      "artifacts/api-server/src/routes/tasks.ts"
    ],
  },
  {
    node: "Discovery / Scan",
    status: "partial",
    confidence: 0.87,
    nextAction: "Make discovery replayable and measure completeness/classification drift.",
    exactRepoPaths: [
      "artifacts/api-server/src/routes/discovery.ts",
      "artifacts/api-server/src/lib/scan-runner.ts",
      "lib/scanner/src/*"
    ],
  },
  {
    node: "Knowledge Graph",
    status: "partial",
    confidence: 0.89,
    nextAction: "Promote the graph from artifact graph to engineering knowledge graph and verify relation consistency.",
    exactRepoPaths: [
      "artifacts/api-server/src/routes/graph.ts",
      "lib/knowledge-engine/src/*",
      "lib/db/src/schema/*"
    ],
  },
  {
    node: "Provenance Import",
    status: "complete",
    confidence: 0.98,
    nextAction: "Version imports and compare seed/linked/current snapshots for drift.",
    exactRepoPaths: [
      "artifacts/api-server/src/scripts/seed-provenance.ts",
      "attached_assets/EngineeringOS_provenance_registry_seed_*.json",
      "attached_assets/EngineeringOS_provenance_registry_linked_*.json"
    ],
  },
  {
    node: "Decision Memory",
    status: "partial",
    confidence: 0.82,
    nextAction: "Promote memory notes into a formal decision registry with supersession tracking.",
    exactRepoPaths: [
      ".agents/memory/*",
      "docs/completion-plan.md",
      "docs/fact-record.md"
    ],
  },
  {
    node: "Historical Archive",
    status: "complete",
    confidence: 0.95,
    nextAction: "Classify archive files as historical-only or evidence-supporting and never as current truth.",
    exactRepoPaths: [
      "attached_assets/*",
      "docs/*"
    ],
  },
  {
    node: "AI Orchestration",
    status: "partial",
    confidence: 0.8,
    nextAction: "Restrict AI to verified truth context and add stale-data guardrails.",
    exactRepoPaths: [
      "lib/ai-orchestrator/src/*",
      "artifacts/api-server/src/routes/ai.ts"
    ],
  },
  {
    node: "Truth Governance / ETV",
    status: "missing",
    confidence: 0.93,
    nextAction: "Build the operational Engineering Truth Verification service: rules, runs, findings, drift register, snapshots.",
    exactRepoPaths: [
      "docs/ENGINEERINGOS_MASTER_EXECUTION_CONSTITUTION.md",
      "docs/fact-record.md",
      "docs/completion-plan.md"
    ],
  }
  ],
} as const;

/**
 * CurrentTruthFlowMatrixSchema extends the BASE object (not the ZodEffects from superRefine),
 * so .extend() is valid. Both the duplicate-check refinement and the expected-nodes
 * refinement are applied here.
 */
export const CurrentTruthFlowMatrixSchema = TruthFlowMatrixBaseSchema.extend({
  title: z.literal(EXPECTED_CURRENT_TRUTH_FLOW_MATRIX.title),
  version: z.literal(EXPECTED_CURRENT_TRUTH_FLOW_MATRIX.version),
}).strict().superRefine((matrix, ctx) => {
  // Duplicate checks
  addDuplicateChecks(matrix, ctx);

  // Expected-nodes checks
  const expectedNodes = EXPECTED_CURRENT_TRUTH_FLOW_MATRIX.nodes;
  const actualNodesByName = new Map(matrix.nodes.map((node) => [node.node, node]));

  for (const expected of expectedNodes) {
    const actual = actualNodesByName.get(expected.node);
    if (!actual) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: `Missing required truth-flow node: ${expected.node}`,
      });
      continue;
    }

    if (actual.status !== expected.status) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: `Status mismatch for node "${expected.node}": expected ${expected.status}, got ${actual.status}`,
      });
    }

    if (Math.abs(actual.confidence - expected.confidence) > 0.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: `Confidence mismatch for node "${expected.node}": expected ${expected.confidence}, got ${actual.confidence}`,
      });
    }

    const actualPaths = [...actual.exactRepoPaths].sort();
    const expectedPaths = [...expected.exactRepoPaths].sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: `Repo path mismatch for node "${expected.node}"`,
      });
    }
  }

  for (const actual of matrix.nodes) {
    if (!expectedNodes.some((expected) => expected.node === actual.node)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: `Unexpected truth-flow node: ${actual.node}`,
      });
    }
  }
});

export type CurrentTruthFlowMatrix = z.infer<typeof CurrentTruthFlowMatrixSchema>;

export interface TruthFlowDriftSignal {
  node: string;
  type: "missing" | "unexpected" | "status-mismatch" | "confidence-mismatch" | "repo-path-mismatch" | "duplicate-node" | "duplicate-path";
  message: string;
}

export function safeValidateTruthFlowMatrix(input: unknown) {
  return TruthFlowMatrixSchema.safeParse(input);
}

export function validateTruthFlowMatrix(input: unknown): TruthFlowMatrix {
  return TruthFlowMatrixSchema.parse(input);
}

export function assertTruthFlowMatrix(input: unknown): asserts input is TruthFlowMatrix {
  TruthFlowMatrixSchema.parse(input);
}

export function safeValidateCurrentTruthFlowMatrix(input: unknown) {
  return CurrentTruthFlowMatrixSchema.safeParse(input);
}

export function validateCurrentTruthFlowMatrix(input: unknown): CurrentTruthFlowMatrix {
  return CurrentTruthFlowMatrixSchema.parse(input);
}

export function assertCurrentTruthFlowMatrix(input: unknown): asserts input is CurrentTruthFlowMatrix {
  CurrentTruthFlowMatrixSchema.parse(input);
}

export function indexTruthFlowNodes(matrix: TruthFlowMatrix | CurrentTruthFlowMatrix) {
  return new Map(matrix.nodes.map((node) => [node.node, node] as const));
}

export function getTruthFlowNode(
  matrix: TruthFlowMatrix | CurrentTruthFlowMatrix,
  nodeName: string,
) {
  return indexTruthFlowNodes(matrix).get(nodeName);
}

export function listTruthFlowDriftSignals(
  matrix: TruthFlowMatrix | CurrentTruthFlowMatrix,
): TruthFlowDriftSignal[] {
  const signals: TruthFlowDriftSignal[] = [];
  const seen = new Set<string>();
  const current = indexTruthFlowNodes(matrix);

  for (const node of matrix.nodes) {
    if (seen.has(node.node)) {
      signals.push({
        node: node.node,
        type: "duplicate-node",
        message: `Duplicate node name: ${node.node}`,
      });
    }
    seen.add(node.node);

    const pathSet = new Set<string>();
    for (const repoPath of node.exactRepoPaths) {
      if (pathSet.has(repoPath)) {
        signals.push({
          node: node.node,
          type: "duplicate-path",
          message: `Duplicate repo path in node "${node.node}": ${repoPath}`,
        });
      }
      pathSet.add(repoPath);
    }
  }

  for (const expected of EXPECTED_CURRENT_TRUTH_FLOW_MATRIX.nodes) {
    const actual = current.get(expected.node);
    if (!actual) {
      signals.push({
        node: expected.node,
        type: "missing",
        message: `Missing required truth-flow node: ${expected.node}`,
      });
      continue;
    }

    if (actual.status !== expected.status) {
      signals.push({
        node: expected.node,
        type: "status-mismatch",
        message: `Status mismatch for node "${expected.node}": expected ${expected.status}, got ${actual.status}`,
      });
    }

    if (Math.abs(actual.confidence - expected.confidence) > 0.0001) {
      signals.push({
        node: expected.node,
        type: "confidence-mismatch",
        message: `Confidence mismatch for node "${expected.node}": expected ${expected.confidence}, got ${actual.confidence}`,
      });
    }

    const actualPaths = [...actual.exactRepoPaths].sort();
    const expectedPaths = [...expected.exactRepoPaths].sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      signals.push({
        node: expected.node,
        type: "repo-path-mismatch",
        message: `Repo path mismatch for node "${expected.node}"`,
      });
    }
  }

  for (const actual of matrix.nodes) {
    if (!EXPECTED_CURRENT_TRUTH_FLOW_MATRIX.nodes.some((expected) => expected.node === actual.node)) {
      signals.push({
        node: actual.node,
        type: "unexpected",
        message: `Unexpected truth-flow node: ${actual.node}`,
      });
    }
  }

  return signals;
}

export function isTruthFlowMatrix(input: unknown): input is TruthFlowMatrix {
  return safeValidateTruthFlowMatrix(input).success;
}

export function isCurrentTruthFlowMatrix(
  input: unknown,
): input is CurrentTruthFlowMatrix {
  return safeValidateCurrentTruthFlowMatrix(input).success;
}

export { EXPECTED_CURRENT_TRUTH_FLOW_MATRIX };
