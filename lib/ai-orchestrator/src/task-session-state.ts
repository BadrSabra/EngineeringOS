import { z } from "zod";
import {
  routeTask,
  type ForensicTaskType,
  type OutputContract,
} from "./task-contracts.js";
import type { ClassifiedRequest } from "./prompts/profile-classifier.js";
import {
  RepairPlanMetadataSchema,
  ValidationProfileSchema,
  type ObjectiveContract,
  type RepairPlanMetadata,
} from "./schemas/chat.schema.js";
import type { ImplementationPlan } from "./schemas/implementation-plan.schema.js";

const RESUMABLE_TASK_TYPES = [
  "FINDING_ANALYSIS",
  "FULL_FORENSIC_AUDIT",
  "WORKSPACE_REVIEW",
  "REPAIR_ANALYSIS",
] as const satisfies readonly ForensicTaskType[];

const ACTIVE_TASK_TYPES = [
  "BEHAVIOR_QUERY",
  "CODE_EXTRACTION",
  "FINDING_ANALYSIS",
  "FULL_FORENSIC_AUDIT",
  "WORKSPACE_REVIEW",
  "REPAIR_ANALYSIS",
] as const satisfies readonly ForensicTaskType[];

const ACTIVE_OUTPUT_CONTRACTS = [
  "GENERIC_RESPONSE",
  "BEHAVIOR_ANSWER",
  "EXTRACTED_CODE",
  "FINDING_ANALYSIS",
  "FORENSIC_REPORT",
  "REPAIR_PLAN",
] as const satisfies readonly OutputContract[];

const ExecutionPlanEvidenceAnchorSchema = z.object({
  source: z.string().min(1).max(500),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  supportsClaim: z.boolean(),
  evidenceClass: z.enum(["READ_CONFIRMED", "BEHAVIOR_PROVEN", "FINDING_PROVEN"]),
}).strict();

export const ExecutionPlanClaimSchema = z.object({
  claimId: z.string().min(1).max(160),
  findingId: z.string().regex(/^F-\d+$/).optional(),
  text: z.string().min(1).max(1000).optional(),
  status: z.enum(["PROVEN", "UNPROVEN", "BLOCKED", "PENDING"]),
  evidence: z.array(ExecutionPlanEvidenceAnchorSchema).max(8).default([]),
}).strict();

export type ExecutionPlanClaim = z.infer<typeof ExecutionPlanClaimSchema>;

export const ExecutionPlanBoundariesSchema = z.object({
  projectId: z.string().min(1),
  rootPath: z.string().min(1).nullable(),
  allowedWriteFiles: z.array(z.string().min(1).max(500)).max(48),
  sourceRoots: z.array(z.string().min(1).max(500)).max(24),
  verdictScopes: z.array(
    z.enum(["PRODUCTION", "FIXTURE_LOCAL", "TEST_LOCAL", "SPEC_LOCAL", "MIXED", "NOT_PROVEN"]),
  ).max(12),
}).strict();

export type ExecutionPlanBoundaries = z.infer<typeof ExecutionPlanBoundariesSchema>;

export const ExecutionNodeSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240),
  status: z.enum(["queued", "running", "passed", "failed", "blocked"]),
  allowedFiles: z.array(z.string().min(1).max(500)).max(48),
  dependencies: z.array(z.string().min(1).max(160)).max(12),
  validationProfile: ValidationProfileSchema,
  attempts: z.number().int().min(0).max(3),
  validationAttempts: z.number().int().min(0).max(3).default(0),
  lastFailure: z.object({
    status: z.enum(["failed", "blocked"]),
    attempt: z.number().int().min(1).max(3),
    validationAttempts: z.number().int().min(0).max(3),
    detail: z.string().max(4_000),
  }).strict().optional(),
}).strict();

export type ExecutionNode = z.infer<typeof ExecutionNodeSchema>;

export const ActiveTaskExecutionPlanSchema = z.object({
  phases: z.array(RepairPlanMetadataSchema).max(12),
  claims: z.array(ExecutionPlanClaimSchema).max(24),
  boundaries: ExecutionPlanBoundariesSchema,
  nodes: z.array(ExecutionNodeSchema).max(24).default([]),
  readiness: z.enum(["READY", "BLOCKED", "NOT_PROVEN"]),
}).strict();

export type ActiveTaskExecutionPlan = z.infer<typeof ActiveTaskExecutionPlanSchema>;

export const ActiveTaskStateSchema = z.object({
  version: z.literal(1),
  taskType: z.enum(ACTIVE_TASK_TYPES),
  outputContract: z.enum(ACTIVE_OUTPUT_CONTRACTS),
  contextProfile: z.enum(["chat-lite", "chat-normal", "chat-deep"]),
  scope: z.object({
    projectId: z.string().min(1),
    rootPath: z.string().min(1).nullable(),
    linkedTaskId: z.string().min(1).nullable(),
  }).strict(),
  evidence: z.object({
    readFiles: z.array(z.string().min(1)).max(48).default([]),
  }).strict().default({ readFiles: [] }),
  executionPlan: ActiveTaskExecutionPlanSchema.nullable().default(null),
  startedAt: z.string().datetime({ offset: true }),
  lastProgressAt: z.string().datetime({ offset: true }),
}).strict();

export type ActiveTaskState = z.infer<typeof ActiveTaskStateSchema>;

function uniquePaths(paths: string[], max: number): string[] {
  return [...new Set(
    paths
      .map((file) => file.trim().replace(/^\.\/+/, "").replace(/\\/g, "/"))
      .filter(Boolean),
  )].slice(0, max);
}

function sourceRootForFile(file: string): string {
  const slash = file.lastIndexOf("/");
  return slash > 0 ? file.slice(0, slash) : ".";
}

function executionNodeId(phase: RepairPlanMetadata, index: number): string {
  return `phase:${phase.findingId}:${index + 1}`;
}

function implementationNodeId(stepId: string): string {
  return `step:${stepId}`;
}

function isSupportedImplementationWriteAction(action: ImplementationPlan["steps"][number]["action"]): boolean {
  return action === "create" || action === "modify" || action === "configure";
}

function hasUnsupportedImplementationBuildAction(plan: ImplementationPlan): boolean {
  return plan.steps.some((step) => step.action === "delete" || step.action === "test");
}

/**
 * Convert an approved implementation plan into the same server-owned node
 * contract used by forensic Repair Plans. Only scoped mutating steps become
 * executable Build nodes; free-form validation text is never executed.
 */
export function buildImplementationExecutionNodes(
  plan: ImplementationPlan,
): ExecutionNode[] {
  const executableSteps = plan.steps
    .filter((step) => isSupportedImplementationWriteAction(step.action) && uniquePaths(step.files, 48).length > 0)
    .slice(0, 24);
  const executableIds = new Set(executableSteps.map((step) => step.id));

  return executableSteps.map((step) => ExecutionNodeSchema.parse({
    id: implementationNodeId(step.id),
    title: step.title,
    status: "queued",
    allowedFiles: uniquePaths(step.files, 48),
    dependencies: step.dependsOn
      .filter((dependency) => executableIds.has(dependency))
      .map(implementationNodeId)
      .slice(0, 12),
    validationProfile: "workspace-typecheck",
    attempts: 0,
    validationAttempts: 0,
  }));
}

/**
 * Convert verified repair phases into durable, independently schedulable
 * execution nodes. Phases with overlapping write scopes retain the verified
 * plan order as an explicit dependency edge; disjoint phases remain parallel.
 */
export function buildExecutionNodes(phases: readonly RepairPlanMetadata[]): ExecutionNode[] {
  const boundedPhases = phases.slice(0, 24);
  const nodeFiles = boundedPhases.map((phase) => new Set(uniquePaths(phase.files, 48)));

  return boundedPhases.map((phase, index) => {
    const dependencies = boundedPhases
      .slice(0, index)
      .flatMap((previousPhase, previousIndex) => (
        hasFileOverlap(nodeFiles[index]!, nodeFiles[previousIndex]!)
          ? [executionNodeId(previousPhase, previousIndex)]
          : []
      ))
      .slice(0, 12);

    return ExecutionNodeSchema.parse({
      id: executionNodeId(phase, index),
      title: phase.steps[0] ?? `Execute ${phase.findingId}`,
      status: "queued",
      allowedFiles: [...nodeFiles[index]!],
      dependencies,
      validationProfile: phase.validationProfile,
      attempts: 0,
      validationAttempts: 0,
    });
  });
}

function normalizedNodeFiles(node: ExecutionNode): Set<string> {
  return new Set(uniquePaths(node.allowedFiles, 48));
}

function hasFileOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const file of left) {
    if (right.has(file)) return true;
  }
  return false;
}

/**
 * Return the queued nodes that are safe to start in the same scheduling tick.
 * Dependencies must be passed, and each selected node must have a disjoint
 * file scope from every other selected node.
 */
export function getRunnableExecutionNodes(
  nodes: readonly ExecutionNode[],
): ExecutionNode[] {
  const passed = new Set(nodes.filter((node) => node.status === "passed").map((node) => node.id));
  const reservedFiles = new Set<string>();
  const runnable: ExecutionNode[] = [];

  for (const node of nodes) {
    if (node.status !== "queued" || node.attempts >= 3) continue;
    if (!node.dependencies.every((dependency) => passed.has(dependency))) continue;

    const files = normalizedNodeFiles(node);
    if (hasFileOverlap(files, reservedFiles)) continue;

    runnable.push(node);
    for (const file of files) reservedFiles.add(file);
  }

  return runnable;
}

const EXECUTION_NODE_TRANSITIONS: Record<ExecutionNode["status"], readonly ExecutionNode["status"][]> = {
  queued: ["running", "blocked"],
  running: ["passed", "failed", "blocked"],
  passed: [],
  failed: ["queued", "blocked"],
  blocked: [],
};

/**
 * Apply one server-owned node transition and increment the attempt only when a
 * queued node actually starts running. Invalid transitions fail closed.
 */
export function transitionExecutionNode(
  nodes: readonly ExecutionNode[],
  nodeId: string,
  nextStatus: ExecutionNode["status"],
): ExecutionNode[] {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown execution node: ${nodeId}`);
  if (!EXECUTION_NODE_TRANSITIONS[node.status].includes(nextStatus)) {
    throw new Error(`Invalid execution node transition: ${node.status} -> ${nextStatus}`);
  }

  const attempts = nextStatus === "running" ? node.attempts + 1 : node.attempts;
  if (attempts > 3) {
    throw new Error(`Execution node attempt budget exhausted: ${nodeId}`);
  }

  return nodes.map((candidate) => candidate.id === nodeId
    ? ExecutionNodeSchema.parse({ ...candidate, status: nextStatus, attempts })
    : candidate);
}

function phaseStatus(phase: RepairPlanMetadata): ExecutionPlanClaim["status"] {
  if (phase.scopedFindingStatus === "NOT_PROVEN" || phase.verdictScope === "NOT_PROVEN") {
    return "BLOCKED";
  }
  if (phase.scopedFindingStatus) return "PROVEN";
  return "PENDING";
}

/**
 * Convert the server-verified report metadata into the durable execution
 * contract used by short follow-up commands. No source body is stored here:
 * claims retain only bounded source anchors.
 */
export function buildActiveTaskExecutionPlan(args: {
  repairPlan?: RepairPlanMetadata[];
  implementationPlan?: ImplementationPlan;
  objective?: ObjectiveContract;
  evidence?: Array<{
    source: string;
    sourceSpan?: { startLine: number; endLine: number };
    supportsClaim: boolean;
    evidenceClass: "READ_CONFIRMED" | "BEHAVIOR_PROVEN" | "FINDING_PROVEN";
  }>;
  projectId: string;
  rootPath: string | undefined;
}): ActiveTaskExecutionPlan | null {
  const phases = (args.repairPlan ?? []).slice(0, 12);
  const implementationPlan = args.implementationPlan;
  if (phases.length === 0 && !implementationPlan) return null;
  const implementationNodes = implementationPlan
    ? buildImplementationExecutionNodes(implementationPlan)
    : [];

  const allowedWriteFiles = uniquePaths(
    phases.length > 0
      ? phases.flatMap((phase) => phase.files)
      : implementationPlan?.steps
        .filter((step) => isSupportedImplementationWriteAction(step.action))
        .flatMap((step) => step.files) ?? [],
    48,
  );
  const sourceRoots = uniquePaths(allowedWriteFiles.map(sourceRootForFile), 24);
  const anchors = (args.evidence ?? []).slice(0, 8).map((item) => ({
    source: item.source,
    ...(item.sourceSpan ? {
      startLine: item.sourceSpan.startLine,
      endLine: item.sourceSpan.endLine,
    } : {}),
    supportsClaim: item.supportsClaim,
    evidenceClass: item.evidenceClass,
  }));

  const claims = [
    ...(args.objective?.requiredClaims ?? []).map((claim) => ({
      claimId: `objective:${claim.claimId}`,
      text: claim.text,
      status: "PENDING" as const,
      evidence: anchors.filter((anchor) =>
        phases.some((phase) => phase.files.includes(anchor.source)),
      ),
    })),
    ...phases.map((phase) => ({
      claimId: `finding:${phase.findingId}`,
      findingId: phase.findingId,
      status: phaseStatus(phase),
      evidence: anchors.filter((anchor) => phase.files.includes(anchor.source)),
    })),
    ...(phases.length === 0 && implementationPlan
      ? [{
          claimId: "implementation:objective",
          text: implementationPlan.objective,
          status: "PENDING" as const,
          evidence: [],
        }]
      : []),
  ].slice(0, 24);

  const verdictScopes = [...new Set(
    phases
      .map((phase) => phase.verdictScope)
      .filter((scope): scope is NonNullable<typeof scope> => Boolean(scope)),
  )];
  const readiness = implementationPlan
    ? implementationPlan.approvalStatus === "APPROVED"
      && implementationPlan.writeAccess === "APPROVED_FOR_BUILD"
      && !hasUnsupportedImplementationBuildAction(implementationPlan)
      && implementationNodes.length > 0
      ? "READY"
      : implementationPlan.approvalStatus === "APPROVED"
        && implementationPlan.writeAccess === "APPROVED_FOR_BUILD"
        ? "BLOCKED"
        : "NOT_PROVEN"
    : phases.some((phase) =>
        phase.scopedFindingStatus === "NOT_PROVEN" || phase.verdictScope === "NOT_PROVEN",
      )
      ? "BLOCKED"
      : phases.every((phase) => Boolean(phase.scopedFindingStatus))
        ? "READY"
        : "NOT_PROVEN";

  return ActiveTaskExecutionPlanSchema.parse({
    phases,
    claims,
    boundaries: {
      projectId: args.projectId,
      rootPath: args.rootPath ?? null,
      allowedWriteFiles,
      sourceRoots,
      verdictScopes,
    },
    nodes: implementationPlan ? implementationNodes : buildExecutionNodes(phases),
    readiness,
  });
}

const CONTINUATION_PATTERNS = [
  /^(?:continue|resume|continue\s+(?:the\s+)?(?:investigation|analysis|audit)|resume\s+(?:the\s+)?(?:investigation|analysis|audit)|proceed|start|begin|go\s+ahead|do\s+it|keep\s+going|retry|try\s+again|regenerate(?:\s+the)?\s+(?:report|audit|plan)|rerun(?:\s+the)?\s+(?:report|audit|plan))[\s!.?,:;]*$/i,
  /^(?:أكمل|استكمل|تابع|تابع\s+التحقيق|أكمل\s+التحقيق|استكمل\s+التحقيق|أكمل\s+التحليل|استكمل\s+التحليل|تابع\s+التحليل|استمر|ابدأ|نفّذ|نفذ|ابدأ\s+التنفيذ|تابع\s+التنفيذ|قم\s+بذلك|أعد\s+المحاولة|اعد\s+المحاولة|أعد\s+(?:توليد|إنتاج|إنشاء|صياغة)\s+(?:التقرير|الخطة)|اعد\s+(?:توليد|إنتاج|إنشاء|صياغة)\s+(?:التقرير|الخطة))[\s!.،,:;]*$/u,
];

export function parseActiveTaskState(value: string | null | undefined): ActiveTaskState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = ActiveTaskStateSchema.safeParse(parsed);
    if (!result.success) return null;
    if (routeTask(result.data.taskType).outputContract !== result.data.outputContract) return null;
    return result.data;
  } catch {
    return null;
  }
}

export function serializeActiveTaskState(value: ActiveTaskState | null | undefined): string | null {
  if (!value) return null;
  return JSON.stringify(value);
}

export function isTaskContinuationRequest(message: string): boolean {
  const normalized = message.normalize("NFKC").trim();
  return normalized.length <= 80 && CONTINUATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isResumableTaskType(taskType: ForensicTaskType): boolean {
  return (RESUMABLE_TASK_TYPES as readonly string[]).includes(taskType);
}

export function buildActiveTaskState(args: {
  classification: ClassifiedRequest;
  projectId: string;
  rootPath: string | undefined;
  linkedTaskId: string | undefined;
  now?: Date;
}): ActiveTaskState | null {
  if (!isResumableTaskType(args.classification.taskType)) return null;
  const now = (args.now ?? new Date()).toISOString();
  const route = routeTask(args.classification.taskType);
  return {
    version: 1,
    taskType: args.classification.taskType,
    outputContract: route.outputContract,
    contextProfile: args.classification.contextProfile,
    scope: {
      projectId: args.projectId,
      rootPath: args.rootPath ?? null,
      linkedTaskId: args.linkedTaskId ?? null,
    },
    evidence: {
      readFiles: [],
    },
    executionPlan: null,
    startedAt: now,
    lastProgressAt: now,
  };
}

export function touchActiveTaskState(state: ActiveTaskState, now = new Date()): ActiveTaskState {
  return { ...state, lastProgressAt: now.toISOString() };
}

/**
 * Carry only bounded source-path metadata between resumable turns. Source
 * bodies stay on disk and are never copied into the session JSON.
 */
export function mergeActiveTaskEvidence(
  state: ActiveTaskState,
  readFiles: string[],
  now = new Date(),
): ActiveTaskState {
  const normalized = readFiles
    .map((file) => file.trim().replace(/^\.\/+/, "").replace(/\\/g, "/"))
    .filter(Boolean);
  const merged = [...state.evidence.readFiles, ...normalized].filter(
    (file, index, files) => files.indexOf(file) === index,
  );
  return {
    ...state,
    evidence: {
      readFiles: merged.slice(-48),
    },
    lastProgressAt: now.toISOString(),
  };
}

/**
 * Continuation messages carry no intent of their own. Reuse the verified
 * session contract instead of allowing them to fall through to BEHAVIOR_QUERY.
 */
export function resumeActiveTaskClassification(
  message: string,
  classification: ClassifiedRequest,
  state: ActiveTaskState | null,
): { classification: ClassifiedRequest; resumed: boolean } {
  if (
    !state ||
    !isResumableTaskType(state.taskType) ||
    state.scope.projectId.length === 0 ||
    !isTaskContinuationRequest(message)
  ) {
    return { classification, resumed: false };
  }

  const route = routeTask(state.taskType);
  return {
    classification: {
      ...classification,
      category: "deep_analysis",
      contextProfile: state.contextProfile,
      taskType: state.taskType,
      analysisMode: route.analysisMode,
      outputContract: route.outputContract,
      confidence: 1,
      allowPrefetch: false,
      implementationTaskMode: false,
    },
    resumed: true,
  };
}