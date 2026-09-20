import { z } from "zod";

export const CapabilityParityClassificationSchema = z.enum([
  "PARITY",
  "SPECIALIZED_STRONGER",
  "PARTIAL",
  "VERIFIED_GAP",
  "UNVERIFIED_RISK",
  "NOT_A_GAP",
  "UNKNOWN",
]);

export const CapabilityParityEvidenceStateSchema = z.enum([
  "PROVEN",
  "INCOMPLETE",
  "UNVERIFIED",
  "INTENTIONAL_BOUNDARY",
]);

export const CapabilityParityPrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const CapabilityParityItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  outcome: z.string().min(1).max(160),
  expectedOutcome: z.string().min(1).max(600),
  classification: CapabilityParityClassificationSchema,
  evidenceState: CapabilityParityEvidenceStateSchema,
  priority: CapabilityParityPrioritySchema,
  dependencies: z.array(z.string().min(1).max(240)).max(8),
  acceptanceCriteria: z.array(z.string().min(1).max(600)).min(1).max(4),
  sourcePaths: z.array(z.string().min(1).max(500)).min(1).max(8),
  rationale: z.string().min(1).max(800),
}).strict();

export const CapabilityParityUnknownSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().min(1).max(600),
  dependency: z.string().min(1).max(400),
  acceptanceCriteria: z.string().min(1).max(600),
}).strict();

export const CapabilityParityBaselineSchema = z.object({
  revision: z.string().regex(/^capability-parity-v\d+$/),
  comparisonTarget: z.string().min(1).max(240),
  comparisonUnit: z.array(z.string().min(1).max(240)).min(1).max(12),
  statusVocabulary: z.array(z.string().min(1).max(80)).min(1).max(8),
  items: z.array(CapabilityParityItemSchema).min(1).max(24),
  unknowns: z.array(CapabilityParityUnknownSchema).max(12),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (ids.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "id"],
        message: `capability parity item id must be unique: ${item.id}`,
      });
    }
    ids.add(item.id);
  });
  value.unknowns.forEach((unknown, index) => {
    if (ids.has(unknown.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unknowns", index, "id"],
        message: `capability parity unknown id must be unique: ${unknown.id}`,
      });
    }
    ids.add(unknown.id);
  });
});

export type CapabilityParityClassification = z.infer<typeof CapabilityParityClassificationSchema>;
export type CapabilityParityEvidenceState = z.infer<typeof CapabilityParityEvidenceStateSchema>;
export type CapabilityParityPriority = z.infer<typeof CapabilityParityPrioritySchema>;
export type CapabilityParityItem = z.infer<typeof CapabilityParityItemSchema>;
export type CapabilityParityBaseline = z.infer<typeof CapabilityParityBaselineSchema>;

/**
 * Server-owned comparison baseline. Markdown reports provide narrative context,
 * while this bounded manifest is the machine-readable contract used to derive
 * objective claims and acceptance deliverables.
 */
export const CAPABILITY_PARITY_BASELINE_V1: CapabilityParityBaseline =
  CapabilityParityBaselineSchema.parse({
    revision: "capability-parity-v1",
    comparisonTarget: "observable engineering-agent outcomes, not proprietary internals",
    comparisonUnit: [
      "understand a project",
      "answer with grounded context",
      "plan a change",
      "make a bounded change",
      "validate it",
      "recover from interruption, conflict, or failure",
      "deliver it safely",
    ],
    statusVocabulary: [
      "PARITY",
      "SPECIALIZED_STRONGER",
      "PARTIAL",
      "VERIFIED_GAP",
      "UNVERIFIED_RISK",
      "NOT_A_GAP",
      "UNKNOWN",
    ],
    items: [
      {
        id: "project-understanding",
        outcome: "Project understanding",
        expectedOutcome: "A user can understand the project through source discovery, bounded analysis, and an evidence-backed explanation.",
        classification: "PARTIAL",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["authenticated browser discovery", "real-source discovery fixture"],
        acceptanceCriteria: [
          "Discovery, scan, and import retain owner-scoped source evidence.",
          "An authenticated browser journey proves discovery through project understanding.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/routes/discovery.ts",
          "artifacts/dashboard/src/pages/Projects.tsx",
          "docs/replit-agent-parity-gaps.md",
          "docs/replit-platform-gap-inventory.md",
        ],
        rationale: "The controlled source and API path exists, but the full browser and external-source journey remains unproven.",
      },
      {
        id: "grounded-ordinary-chat",
        outcome: "Grounded ordinary chat",
        expectedOutcome: "A user can ask a project question and receive an answer bounded by retained source context and persisted session evidence.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["configured live provider", "authenticated browser journey"],
        acceptanceCriteria: [
          "JSON and SSE responses retain source lineage and reject unsupported claims.",
          "A configured-provider browser journey preserves the same evidence contract.",
        ],
        sourcePaths: [
          "lib/ai-orchestrator/src/agents/chat-agent.ts",
          "lib/ai-orchestrator/src/evidence-integrity.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The provider-free evidence contract is stronger than an unconstrained chat path, while live and browser proof remain incomplete.",
      },
      {
        id: "broad-multi-file-analysis",
        outcome: "Broad multi-file analysis",
        expectedOutcome: "A bounded analysis can inspect multiple files with preserved partial results and a grounded synthesis.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "PROVEN",
        priority: "P2",
        dependencies: ["bounded hierarchical execution"],
        acceptanceCriteria: [
          "Subtasks use disjoint bounded scopes and retain partial results.",
          "No-tools synthesis cannot replace missing retained evidence.",
        ],
        sourcePaths: [
          "lib/ai-orchestrator/src/agents/hierarchical-executor.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The product intentionally favors bounded, evidence-checked analysis over unrestricted recursive investigation.",
      },
      {
        id: "structured-review",
        outcome: "Structured scan and review",
        expectedOutcome: "Analyze and review workflows return structured results through JSON and streaming routes with explicit fallback and error states.",
        classification: "PARTIAL",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["configured live provider", "authenticated browser journey"],
        acceptanceCriteria: [
          "JSON and stream routes retain parse, error, audit, and event state.",
          "A complete authenticated provider-backed stream-to-history journey succeeds.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/routes/ai/analysis.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The route and fallback surfaces exist, but the full provider-backed user journey is not proven.",
      },
      {
        id: "conversational-planning",
        outcome: "Conversational planning",
        expectedOutcome: "A grounded change request produces an explicit pending-approval plan without granting write authorization.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["provider-backed generation", "browser approval journey"],
        acceptanceCriteria: [
          "Missing grounding produces PENDING_APPROVAL or NOT_AUTHORIZED rather than an implicit mutation.",
          "A browser journey proves plan, approval, and rehydration states.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/routes/ai/chat.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The safety boundary is stronger than implicit agent edits; live generation and browser proof remain incomplete.",
      },
      {
        id: "bounded-code-changes",
        outcome: "Bounded code changes",
        expectedOutcome: "A user can review an isolated proposed change before any approved mutation is applied.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["candidate workspace", "approval and validation journey"],
        acceptanceCriteria: [
          "write_file creates a bounded pending change rather than directly mutating the live root.",
          "Approval rechecks project revision and candidate scope before apply.",
        ],
        sourcePaths: [
          "lib/ai-orchestrator/src/agents/chat-agent.ts",
          "artifacts/api-server/src/routes/ai/chat.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The product deliberately requires proposal and approval; operational browser proof is still incomplete.",
      },
      {
        id: "candidate-validation",
        outcome: "Candidate validation",
        expectedOutcome: "Server-owned validation profiles run against an isolated candidate and produce a redacted authoritative receipt.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "PROVEN",
        priority: "P0",
        dependencies: ["candidate workspace", "server-owned validation profile"],
        acceptanceCriteria: [
          "Validation ends as passed, failed, blocked, or unavailable within bounded deadlines.",
          "Only server-owned checks can satisfy the validation gate.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/lib/ai-repair-validation.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The validation contract is provider-free verified and intentionally stricter than model narrative.",
      },
      {
        id: "token-budget-admission",
        outcome: "Token budget admission",
        expectedOutcome: "A request that would exceed projected token usage is rejected before provider work, with conservative accounting for partial or unknown usage.",
        classification: "VERIFIED_GAP",
        evidenceState: "PROVEN",
        priority: "P0",
        dependencies: ["existing AI budget reservation and usage model"],
        acceptanceCriteria: [
          "Projected token exhaustion blocks provider work at the server-owned admission boundary.",
          "Reservations are idempotent and crash reconciliation cannot reopen exhausted budget.",
          "The API and operator projection expose a safe budget reason without provider diagnostics.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/lib/ai-budget.ts",
          "docs/replit-platform-gap-inventory.md",
        ],
        rationale: "The project exposes a token limit but current admission enforces the daily attempt limit rather than projected token usage.",
      },
      {
        id: "apply-promotion",
        outcome: "Apply and promotion",
        expectedOutcome: "An approved candidate is promoted only when source, candidate, revision, and validation proof still match.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P0",
        dependencies: ["candidate integrity", "validation receipt", "authenticated promotion journey"],
        acceptanceCriteria: [
          "Apply rejects unrelated-root or candidate drift.",
          "Promoted bytes and the audit journal retain the same proof identity.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/lib/delivery-workspace.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Deterministic integrity transitions are verified, but complete authenticated promotion remains open.",
      },
      {
        id: "conflict-recovery",
        outcome: "Conflict recovery",
        expectedOutcome: "A changed workspace blocks unsafe promotion and offers a bounded rebase, discard, or retry path.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["workspace revision", "rebase validation"],
        acceptanceCriteria: [
          "Conflict metadata preserves the original base and candidate identity.",
          "A retry cannot apply stale bytes without renewed validation.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/routes/ai/chat.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Safe conflict handling exists, but a complete successful rebase journey has not been demonstrated.",
      },
      {
        id: "long-running-task-execution",
        outcome: "Long-running task execution",
        expectedOutcome: "A task survives provider delay, reconnect, cancellation, and worker recovery with durable ownership and visible terminal state.",
        classification: "PARTIAL",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["configured live provider", "terminal browser journey"],
        acceptanceCriteria: [
          "Ownership, leases, checkpoints, and concurrent-state responses remain durable.",
          "A terminal browser journey proves the complete provider-backed lifecycle.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/routes/ai/tasks.ts",
          "lib/ai-orchestrator/src/agents/task-agent.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Provider-free ownership and recovery checks pass, while live execution and browser evidence remain incomplete.",
      },
      {
        id: "workflow-execution",
        outcome: "Workflow execution",
        expectedOutcome: "A workflow can start, advance, fail, retry, stop, and roll back with durable phase state.",
        classification: "PARTIAL",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["provider-backed orchestration", "terminal E2E states"],
        acceptanceCriteria: [
          "Phase transitions are serialized and idempotent.",
          "Provider-backed workflow completion and recovery are visible in the terminal projection.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/routes/ai/workflows.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Workflow mechanics are present, but provider-backed orchestration and terminal E2E proof remain open.",
      },
      {
        id: "interruption-recovery",
        outcome: "Cancellation, resume, and restart recovery",
        expectedOutcome: "Interrupted work can resume from durable evidence without becoming a false success after cancellation or restart.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["durable execution state", "browser reload and restart journey"],
        acceptanceCriteria: [
          "Cancellation terminalizes incomplete work and preserves collected evidence.",
          "Reconnect and restart recovery preserve execution, attempt, and terminal identity.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/lib/ai-execution-state.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Durable safety behavior is provider-free verified, while cross-process browser evidence remains incomplete.",
      },
      {
        id: "validation-evidence-ux",
        outcome: "Validation and evidence UX",
        expectedOutcome: "Operators can distinguish running, blocked, incomplete, unverified, and proven states and choose the next safe action.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P2",
        dependencies: ["authenticated dashboard journey", "SSE refresh evidence"],
        acceptanceCriteria: [
          "Flight Deck and Mission Control retain evidence and validation state across reload.",
          "The UI does not flatten incomplete or unverified work into success.",
        ],
        sourcePaths: [
          "artifacts/dashboard/src/pages/FlightDeck.tsx",
          "artifacts/dashboard/src/pages/MissionControl.tsx",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The UI has explicit evidence and recovery projections, but a complete authenticated browser journey is not proven.",
      },
      {
        id: "git-delivery",
        outcome: "Git delivery",
        expectedOutcome: "Scoped commit and push operations use matching candidate, tree, change-set, identity, and post-commit proof.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["Git identity", "disposable remote", "authenticated delivery journey"],
        acceptanceCriteria: [
          "Generic Git actions remain separate from scoped AI delivery actions.",
          "A live authenticated disposable-remote journey produces a post-push receipt.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/routes/git.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Provider-free isolated delivery is verified, but the external authenticated journey remains blocked.",
      },
      {
        id: "audit-export",
        outcome: "Audit and export",
        expectedOutcome: "A user can inspect and export allowlisted operation evidence without receiving an unrestricted workspace transcript.",
        classification: "PARITY",
        evidenceState: "PROVEN",
        priority: "P2",
        dependencies: ["operation evidence projection"],
        acceptanceCriteria: [
          "Exports retain revisions, receipts, proposals, and terminal evidence with redaction.",
          "The artifact remains scoped audit evidence rather than arbitrary workspace export.",
        ],
        sourcePaths: [
          "artifacts/api-server/src/lib/operation-evidence.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "The scoped product goal is met; unrestricted IDE transcript export is intentionally not the target.",
      },
      {
        id: "provider-resilience",
        outcome: "Provider resilience",
        expectedOutcome: "Provider failures are classified, retried, or surfaced with safe recovery guidance without becoming false success.",
        classification: "SPECIALIZED_STRONGER",
        evidenceState: "INCOMPLETE",
        priority: "P1",
        dependencies: ["live provider catalog", "controlled provider campaign"],
        acceptanceCriteria: [
          "Fallback, catalog, circuit, and error classification remain provider-free deterministic.",
          "Live availability and quota behavior are observed separately from source-backed capability proof.",
        ],
        sourcePaths: [
          "lib/ai-orchestrator/src/openrouter/model-resolver.ts",
          "lib/ai-orchestrator/src/openrouter/dynamic-catalog.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Provider resilience is source-backed and tested, but live provider behavior is not a parity verdict.",
      },
      {
        id: "live-provider-diagnostics",
        outcome: "Live provider diagnostics",
        expectedOutcome: "Live catalog, quota, rate-limit, outage, and fallback behavior are confirmed through a controlled provider campaign.",
        classification: "UNVERIFIED_RISK",
        evidenceState: "UNVERIFIED",
        priority: "P1",
        dependencies: ["controlled configured provider", "operator-safe diagnostic campaign"],
        acceptanceCriteria: [
          "Missing credential, authentication failure, stale catalog, rate limit, quota, and outage each produce one safe next action.",
          "Provider diagnostics remain redacted and separate from source-backed capability proof.",
        ],
        sourcePaths: [
          "lib/ai-orchestrator/src/openrouter/dynamic-catalog.ts",
          "docs/replit-platform-gap-inventory.md",
        ],
        rationale: "Provider-free fixtures prove classification shape, but live availability and quota behavior have not been observed.",
      },
      {
        id: "arbitrary-shell-execution",
        outcome: "Arbitrary shell execution",
        expectedOutcome: "The product may intentionally reject model-supplied shell text and arbitrary argv in favor of server-owned command profiles.",
        classification: "NOT_A_GAP",
        evidenceState: "INTENTIONAL_BOUNDARY",
        priority: "P3",
        dependencies: ["server-owned command profiles"],
        acceptanceCriteria: [
          "The model cannot supply arbitrary shell text or argv.",
          "The rejection remains visible as an intentional safety boundary, not a missing capability.",
        ],
        sourcePaths: [
          "lib/ai-orchestrator/src/tools/execution-tools.ts",
          "docs/replit-agent-parity-gaps.md",
        ],
        rationale: "Broad shell access would weaken the product safety boundary and is explicitly out of scope.",
      },
    ],
    unknowns: [
      {
        id: "live-provider-browser-journey",
        description: "No complete authenticated provider-backed chat or analysis browser journey is established.",
        dependency: "controlled provider and Clerk browser state",
        acceptanceCriteria: "Run the full journey and retain terminal JSON, SSE, history, and dashboard evidence.",
      },
      {
        id: "discovery-to-push",
        description: "No complete authenticated discovery-to-push journey is established against a disposable remote.",
        dependency: "disposable remote and Git identity",
        acceptanceCriteria: "Retain discovery, import, plan, apply, commit, push, and post-push receipts under one operation.",
      },
      {
        id: "restart-browser-proof",
        description: "Cross-process browser reload and restart recovery remain incompletely observed.",
        dependency: "controlled restart and reconnect campaign",
        acceptanceCriteria: "Reconnect after restart and prove the same durable execution and terminal projection.",
      },
      {
        id: "repository-freshness",
        description: "Long-running freshness and index completeness are not guaranteed by the current evidence.",
        dependency: "freshness campaign over a changing repository",
        acceptanceCriteria: "Demonstrate stale detection, rebuild, and bounded behavior during index changes.",
      },
    ],
  });

export type CapabilityParityObjectiveClaim = {
  claimId: string;
  text: string;
  requiredEvidencePaths: string[];
  evidenceNeedles?: string[];
  evidenceNeedlesByPath?: Record<string, string[]>;
};

export function buildCapabilityParityObjectiveClaims(
  baseline: CapabilityParityBaseline = CAPABILITY_PARITY_BASELINE_V1,
): CapabilityParityObjectiveClaim[] {
  const manifestPath = "lib/ai-orchestrator/src/parity-baseline.ts";
  const itemStatuses = new Set(baseline.items.map((item) => item.classification));
  const unknownCount = baseline.unknowns.length;
  return [
    {
      claimId: "gap-manifest-revision",
      text:
        `The server-owned capability parity manifest ${baseline.revision} defines ` +
        `${baseline.items.length} observable outcomes and ${unknownCount} explicit unknowns.`,
      requiredEvidencePaths: [manifestPath],
      evidenceNeedles: [
        "CAPABILITY_PARITY_BASELINE_V1",
        baseline.revision,
        `${baseline.items.length} observable`,
      ],
    },
    {
      claimId: "gap-baseline-contract",
      text:
        "The project parity baseline defines observable outcomes and separates Parity, Partial, Gap, and Not a gap instead of treating feature names as proof.",
      requiredEvidencePaths: [
        manifestPath,
        "docs/replit-agent-parity-gaps.md",
        "docs/actual-capability-baseline-v1.md",
      ],
      evidenceNeedlesByPath: {
        [manifestPath]: ["statusVocabulary", "comparisonUnit"],
        "docs/replit-agent-parity-gaps.md": ["Parity matrix", "Gap", "Not a gap"],
        "docs/actual-capability-baseline-v1.md": ["user-visible capability map"],
      },
    },
    {
      claimId: "gap-capability-inventory",
      text:
        "The platform gap inventory distinguishes implemented and proven capability from partial or unreliable capability and does not infer support from route names alone.",
      requiredEvidencePaths: [
        manifestPath,
        "docs/replit-platform-gap-inventory.md",
      ],
      evidenceNeedlesByPath: {
        [manifestPath]: ["items:", "acceptanceCriteria", "sourcePaths"],
        "docs/replit-platform-gap-inventory.md": [
          "Implemented and proven",
          "Partial / unreliable",
          "does not infer a capability from a route name",
        ],
      },
    },
    {
      claimId: "gap-verified-boundary",
      text:
        "A verified gap requires source evidence, an observable capability criterion, and a supported failure or missing outcome; an unverified risk must remain separate.",
      requiredEvidencePaths: [
        manifestPath,
        "docs/replit-agent-parity-gaps.md",
        "lib/ai-orchestrator/src/task-contracts.ts",
      ],
      evidenceNeedlesByPath: {
        [manifestPath]: ["VERIFIED_GAP", "UNVERIFIED", "UNKNOWN"],
        "docs/replit-agent-parity-gaps.md": [
          "observable contract",
          "tested defect",
          "not classified as a missing capability",
        ],
        "lib/ai-orchestrator/src/task-contracts.ts": [
          "NOT_PROVEN",
          "EvidenceReferenceSchema",
        ],
      },
    },
    {
      claimId: "gap-classification",
      text:
        "Each comparison item receives a bounded parity classification and an evidence-backed explanation rather than a provider-availability guess.",
      requiredEvidencePaths: [
        manifestPath,
        "docs/replit-agent-parity-gaps.md",
        "docs/replit-platform-gap-inventory.md",
      ],
      evidenceNeedlesByPath: {
        [manifestPath]: [...itemStatuses],
        "docs/replit-agent-parity-gaps.md": [
          "Parity",
          "Partial",
          "Gap",
          "Not a gap",
        ],
        "docs/replit-platform-gap-inventory.md": [
          "Classification",
          "Observable acceptance criteria",
        ],
      },
    },
    {
      claimId: "gap-prioritization",
      text:
        "The final gap report must retain priority, dependency, and observable acceptance criteria for each actionable gap, while listing unknowns separately.",
      requiredEvidencePaths: [
        manifestPath,
        "docs/replit-agent-parity-gaps.md",
        "docs/replit-platform-gap-inventory.md",
      ],
      evidenceNeedlesByPath: {
        [manifestPath]: ["priority", "dependencies", "acceptanceCriteria", "unknowns"],
        "docs/replit-agent-parity-gaps.md": [
          "priority",
          "Gap classification and priority",
        ],
        "docs/replit-platform-gap-inventory.md": [
          "Dependency",
          "Observable acceptance criteria",
        ],
      },
    },
  ];
}