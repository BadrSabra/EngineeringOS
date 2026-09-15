import {
  classifyRequest,
  isLowRiskChatQuestion,
  isProjectOrientationQuestion,
  type ClassifiedRequest,
  type RequestCategory,
} from "./prompts/profile-classifier.js";
import {
  isExplicitBehaviorQueryRequest,
  isGapAnalysisRequest,
  isProductionReachabilityRequest,
  normalizeIntentText,
  routeTask,
  type AnalysisMode,
  type ForensicTaskType,
  type OutputContract,
} from "./task-contracts.js";
import type { TaskType } from "./quality/task-profile.js";
import {
  resolveOperationalCommand,
  type OperationalCommand,
} from "./operational-command.js";
import { isRunProjectScanRequest } from "./scan-command.js";
import type {
  ProjectQueryTargetMode,
  ProjectQueryTargetResolution,
} from "./project-query-target.js";
import {
  isArabicExplicitExecutionActionRequest,
  isArabicMutationActionRequest,
} from "./arabic-action-intent.js";
import {
  isEnglishExplicitExecutionActionRequest,
  isEnglishMutationActionRequest,
  normalizeEnglishActionText,
} from "./english-action-intent.js";

export { isRunProjectScanRequest } from "./scan-command.js";
export {
  isRestartServicesRequest,
  normalizeOperationalCommandText,
  resolveOperationalCommand,
} from "./operational-command.js";
export type { OperationalCommand } from "./operational-command.js";

export type TurnIntentKind =
  | "CHAT"
  | "PROJECT_QUERY"
  | "FORENSIC_AUDIT"
  | "DELIVERY";

export type TurnOperationMode = "CHAT" | "FORENSIC_AUDIT" | "DELIVERY";
export type TurnServerAction = "RUN_PROJECT_SCAN" | "RESTART_SERVICES";
export type TurnContextMode = "light" | "project";

export type TurnIntentPhase =
  | "evidence"
  | "proposal"
  | "execution"
  | "validation";

/**
 * The single request-routing decision shared by the API, orchestrator, model
 * selector, tool loop, and UI response metadata.
 *
 * `hasTools` is intentionally absent: tool availability is a runtime
 * capability (`rootPath`, provider support). `requiresTools` is user intent.
 */
export type TurnIntent = {
  kind: TurnIntentKind;
  category: RequestCategory;
  forensicTaskType: ForensicTaskType;
  analysisMode: AnalysisMode;
  outputContract: OutputContract;
  executionTaskType: TaskType;
  requiresTools: boolean;
  requiresEvidence: boolean;
  resumed: boolean;
  allowsResume: boolean;
  allowsBuildHandoff: boolean;
  implementationPlanResume: boolean;
  /** Broad forensic requests must declare a scope before expensive discovery. */
  scopeClarificationRequired: boolean;
  /**
   * The message contains an ordered read/inspect step followed by a
   * change-oriented step. This is a planning signal only; write and validation
   * authorization still comes from the server-owned operation contract.
   */
  compoundExecution: boolean;
  /** True only when the compound request asks for a later project mutation. */
  compoundWrite: boolean;
  /** Ordered phases requested by the user, not a permission grant. */
  phases: readonly TurnIntentPhase[];
  /** User-readable description of the boundary approved for this audit. */
  auditScopeDescription?: string;
  operationMode: TurnOperationMode;
  /** Server-owned context depth; social chat stays on the lightweight path. */
  contextMode: TurnContextMode;
  classification: ClassifiedRequest;
  /** Server-owned subsystem target for a targeted read-only project query. */
  projectTarget?: ClassifiedRequest["projectTarget"];
  /** Server-owned target resolution state, including safe ambiguity handling. */
  projectTargetResolution: ProjectQueryTargetResolution;
  /** Server-owned initial source-targeting mode; planning may refine unresolved queries. */
  projectQueryTargetMode?: ProjectQueryTargetMode;
  /** A deterministic server-owned action that must not be delegated to a provider. */
  serverAction?: TurnServerAction;
  /** Details for a deterministic operational command, when one was recognized. */
  operationalCommand?: OperationalCommand;
};

/**
 * Apply serialization is only needed while a turn is allowed to prepare
 * write-capable changes. Tool availability alone is not sufficient: project
 * questions, forensic reads, implementation-plan creation, and read-only plan
 * continuations all use tools without changing project state.
 */
export function isWriteCapableTurn(intent: Pick<
  TurnIntent,
  | "kind"
  | "implementationPlanResume"
  | "allowsBuildHandoff"
  | "classification"
  | "compoundExecution"
  | "compoundWrite"
>): boolean {
  return intent.allowsBuildHandoff ||
    (
      intent.kind === "DELIVERY" &&
      !intent.implementationPlanResume &&
      !intent.classification.implementationPlanMode &&
      !(intent.compoundExecution && !intent.compoundWrite)
    );
}

const RESUMABLE_FORENSIC_TASKS = new Set<ForensicTaskType>([
  "FINDING_ANALYSIS",
  "FULL_FORENSIC_AUDIT",
  "WORKSPACE_REVIEW",
  "REPAIR_ANALYSIS",
]);

const PROJECT_TOOL_SIGNAL_RE =
  /(?:\b(?:file|folder|directory|repository|repo|codebase|project|source|function|class|method|module|component|handler|middleware|endpoint|route|schema|database|table|query|test|bug|error|implementation|architecture|workflow|pipeline|dependency|dependencies|configuration|config|api|branch|commit|loop|iteration|iterations|behavior|behaviour|return|result|call|invocation|limit|counter)\b|ملف|مجلد|مستودع|مشروع|كود|شفرة|مصدر|دالة|وحدة|مكوّن|مكون|واجهة|مسار|مخطط|قاعدة\s+بيانات|جدول|استعلام|اختبار|خطأ|خلل|تنفيذ|معمارية|سير\s+العمل|اعتماديات|إعدادات|حلقة|تكرار|سلوك|سلوك\s+الوكيل|وكيل|الوكيل|آلية\s+عمل|إرجاع|نتيجة)/iu;

const SOURCE_PATH_RE =
  /(?:^|[\s`"'(])(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b/iu;
const PLAN_EXECUTION_REQUEST_RE =
  /^\s*(?:(?:ابدأ|ابدا|إبدأ|إبدا|start|proceed|go\s+ahead)\s+)?(?:في\s+)?(?:تنفيذ|تطبيق|تعديل|إصلاح|implement|apply|execute)\s+(?:هذه\s+|the\s+|this\s+|approved\s+)?(?:الخطة|التعديلات|الإصلاحات|plan|changes|fixes)(?:\s|$|[.,!?])/iu;

/**
 * A plan-execution command is not a generic implementation request. It must
 * carry the server-owned approved Build handoff, otherwise the route would
 * accept arbitrary source reads as proof of execution without a proposal or
 * apply journal.
 */
export function isPlanExecutionRequest(message: string): boolean {
  const normalized = message.normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g, "");
  return PLAN_EXECUTION_REQUEST_RE.test(normalized);
}

const ENGLISH_COMPOUND_SEQUENCE_RE =
  /(?:\b(?:then|and|after|once|followed\s+by)\b(?:\s+(?:then|after|once))?\s*)/i;

/**
 * `then after` and `then once` may introduce one short, source-qualified
 * evidence clause before the later action, for example:
 * "then after reading the file, fix the bug".
 *
 * Keep this bridge structural rather than adding read/gerund vocabulary to
 * the shared English action contract. A comma is required, the clause must
 * mention a source-like target, and its length is bounded so arbitrary prose
 * cannot become a compound action.
 */
const ENGLISH_NESTED_COMPOUND_BRIDGE_RE =
  /^(?:(?=[^.!?\n,]{1,100},\s*)(?=[^.!?\n,]*\b(?:file|folder|directory|source|codebase|repository|repo|project)\b)|(?=[^!?\n,]{1,100},\s*)(?=[^!?\n,]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b))[^!?\n,]{1,100},\s*/i;

/**
 * Validation actions are intentionally limited to the existing compound
 * validation contract. Mutation and explicit-execution wording comes from
 * english-action-intent.ts instead of being repeated here.
 */
const ENGLISH_COMPOUND_VALIDATION_RE =
  /^(?:(?:please|kindly)\s+)?(?:(?:run|execute)\s+(?:the\s+)?tests?\b|run\s+validation\b|validate\b)/i;

const ARABIC_COMPOUND_REQUEST_RE =
  /(?:ثم\s*|وبعد(?:ها)?\s*|بعد(?:ها| ذلك)?\s*)(?:please\s+|kindly\s+)?(?:اختبر|شغّل|شغل|تحقق|أصلح|صحح|عدّل|عدل|غيّر|غير|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف)/iu;

const ARABIC_COMPOUND_WRITE_REQUEST_RE =
  /(?:ثم\s*|وبعد(?:ها)?\s*|بعد(?:ها| ذلك)?\s*)(?:please\s+|kindly\s+)?(?:أصلح|صحح|عدّل|عدل|غيّر|غير|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف)/iu;

function getEnglishCompoundActionSegment(message: string): string | null {
  const normalized = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  const marker = ENGLISH_COMPOUND_SEQUENCE_RE.exec(normalized);
  if (!marker) return null;

  const markerText = marker[0].trim();
  const remainder = normalized.slice(marker.index + marker[0].length).trim();
  if (/^then\s+(?:after|once)$/i.test(markerText)) {
    const bridge = ENGLISH_NESTED_COMPOUND_BRIDGE_RE.exec(remainder);
    if (!bridge) return null;
    return normalizeEnglishActionText(remainder.slice(bridge[0].length));
  }

  return normalizeEnglishActionText(remainder);
}

function isEnglishCompoundValidationAction(segment: string): boolean {
  return ENGLISH_COMPOUND_VALIDATION_RE.test(segment);
}

function isEnglishCompoundActionRequest(message: string): boolean {
  const segment = getEnglishCompoundActionSegment(message);
  if (!segment) return false;
  return (
    isEnglishMutationActionRequest(segment) ||
    isEnglishExplicitExecutionActionRequest(segment) ||
    isEnglishCompoundValidationAction(segment)
  );
}

function isEnglishCompoundWriteAction(message: string): boolean {
  const segment = getEnglishCompoundActionSegment(message);
  if (!segment || isEnglishCompoundValidationAction(segment)) return false;
  return isEnglishMutationActionRequest(segment);
}

/**
 * Arabic users commonly qualify the transition instead of placing the
 * mutation verb immediately after "then", for example:
 * "بعد اكتمال قراءة المصدر، انتقل إلى مسار الإصلاح وأنشئ تغييرًا معلّقًا".
 * Keep this bridge deliberately narrow so explanatory text such as
 * "ثم اشرح كيف أصلح..." remains read-only.
 */
const ARABIC_QUALIFIED_COMPOUND_REQUEST_RE =
  /(?:بعد\s+(?:اكتمال|الانتهاء\s+من)\s+[^.!?\n،]{1,100}[،,]\s*(?:انتقل|ننتقل)\s+إلى\s+(?:مسار\s+)?[^.!?\n]{0,100}?(?:ثم\s+)?|بعد\s+(?:اكتمال|الانتهاء\s+من)\s+[^.!?\n،]{1,100}[،,]\s*)(?:و)?(?:أصلح|صحح|عدّل|عدل|غيّر|غير|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف)/iu;

const FORENSIC_EVIDENCE_SIGNAL_RE =
  /(?:\b(?:audit|forensic|root\s+cause|prove|verify|investigate)\b|تدقيق|جنائي|تحقيق|تحقق|تحقّق|السبب\s+الجذري|الأسباب\s+الجذرية|الاسباب\s+الجذرية|الأسباب\s+الجذريه|الاسباب\s+الجذريه|تتبع\s+مسار\s+(?:الجلسة|الجلسه)|تتبع\s+(?:الجلسة|الجلسه)\s+الأخيرة|تتبع\s+(?:الجلسة|الجلسه)\s+الاخيرة|أثبت|اثبت)/iu;

type EvidenceRoutingSignals = {
  classification: ClassifiedRequest;
  routeRequiresEvidence: boolean;
  isLowRiskChat: boolean;
  implementationDelivery: boolean;
  planDelivery: boolean;
  implementationPlanResume: boolean;
  broadForensicTask: boolean;
  broadAuditIntent: boolean;
  hasProjectToolSignal: boolean;
  message: string;
  normalizedMessage: string;
  gapAnalysisProjectQuery: boolean;
  targetedProjectQuery: boolean;
  unresolvedProjectQuery: boolean;
  resumedForensicContinuation: boolean;
};

/**
 * Evidence policy firewall.
 *
 * Classification is intentionally heuristic and may contain several matching
 * signals. Keep precedence here, at one boundary, instead of repeating
 * `category !== "exploration"` and forensic exceptions throughout the route:
 *
 *   low-risk/plan/delivery/exploration → no evidence
 *   deep analysis or evidence-capable task → evidence signals
 *   targeted/gap/resumed project query → evidence when explicitly grounded
 *
 * The function returns the existing evidence intent only; tool access and
 * delivery authorization remain separate decisions below.
 */
function resolveEvidenceIntent({
  classification,
  routeRequiresEvidence,
  isLowRiskChat,
  implementationDelivery,
  planDelivery,
  implementationPlanResume,
  broadForensicTask,
  broadAuditIntent,
  hasProjectToolSignal,
  message,
  normalizedMessage,
  gapAnalysisProjectQuery,
  targetedProjectQuery,
  unresolvedProjectQuery,
  resumedForensicContinuation,
}: EvidenceRoutingSignals): boolean {
  const isExploration = classification.category === "exploration";
  const isDeepAnalysis = classification.category === "deep_analysis";

  // These are hard boundaries, not competing scores.
  if (
    isLowRiskChat ||
    isExploration ||
    implementationDelivery ||
    planDelivery ||
    implementationPlanResume
  ) {
    return false;
  }

  const evidenceCapable = routeRequiresEvidence || isDeepAnalysis;
  if (!evidenceCapable) return false;

  const categoryEvidence =
    isDeepAnalysis ||
    classification.analysisMode === "FORENSIC" ||
    classification.structuredOutputMode ||
    classification.singleFileForensicMode ||
    classification.orderedForensicRoots.length > 0;

  const explicitEvidence =
    (!broadForensicTask || broadAuditIntent) && categoryEvidence;
  const behaviorEvidence =
    hasProjectToolSignal &&
    !isProjectOrientationQuestion(message) &&
    isExplicitBehaviorQueryRequest(message);
  const projectEvidence =
    gapAnalysisProjectQuery ||
    targetedProjectQuery ||
    unresolvedProjectQuery;

  return (
    explicitEvidence ||
    behaviorEvidence ||
    isProductionReachabilityRequest(normalizedMessage) ||
    FORENSIC_EVIDENCE_SIGNAL_RE.test(normalizedMessage) ||
    projectEvidence ||
    resumedForensicContinuation
  );
}

const EXPLICIT_AUDIT_SCOPE_RE =
  /(?:\b(?:src|lib|app|server|client|test|tests|components?|pages?|routes?|api|packages?|artifacts?|files?)\b|[./][\w@.-]+(?:\/[\w@.-]+)*|[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|json|yaml|yml|toml|css|scss|html)\b|specific\s+(?:file|folder|directory|module)|(?:whole|entire|full|all)\s+(?:the\s+)?(?:project|workspace|repository|repo|codebase|code)|(?:of|on|in)\s+the\s+(?:project|workspace|repository|repo|codebase)|مجلد\s+(?:محدد|معين)|ملف(?:ات)?\s+(?:محدد(?:ة)?|معين(?:ة)?)|هذا\s+الملف|الملفات\s+الإنتاجية|الكود\s+الإنتاجي|(?:شامل|شاملة|كامل|كاملة|واسع|واسعة)\s+(?:للمشروع|لمشروعي|للمستودع|لمستودعي|للريبو|لقاعدة\s+(?:الكود|الشفرة|المصدر)|المشروع|مشروعي|المستودع|مستودعي|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر))|(?:في|على|ضمن|داخل)\s+(?:المشروع|مشروعي|المستودع|مستودعي|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر))|(?:المشروع|مشروعي|المستودع|مستودعي|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر))\s+(?:بالكامل|كله|كاملًا|كاملة)|كل\s+(?:المشروع|المستودع|الريبو|الكود|قاعدة\s+(?:الكود|الشفرة|المصدر))|المشروع\s+كله)/iu;
function isExecutionActionRequest(message: string): boolean {
  return (
    isEnglishMutationActionRequest(message) ||
    isArabicMutationActionRequest(message)
  );
}

/**
 * Detect an ordered compound request without treating audit language as an
 * authorization. The direct-action matcher intentionally remains separate:
 * "fix the bug" is a delivery request, while "inspect the file then fix the
 * bug" is a compound delivery request that must retain its evidence-first
 * ordering.
 */
export function isCompoundExecutionRequest(message: string): boolean {
  const normalized = message.normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g, "");
  if (isExecutionActionRequest(normalized)) return false;
  return isEnglishCompoundActionRequest(normalized) ||
    ARABIC_COMPOUND_REQUEST_RE.test(normalized) ||
    ARABIC_QUALIFIED_COMPOUND_REQUEST_RE.test(normalized);
}

export function isCompoundWriteRequest(message: string): boolean {
  const normalized = message.normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g, "");
  if (isExecutionActionRequest(normalized)) return false;
  return isEnglishCompoundWriteAction(normalized) ||
    ARABIC_COMPOUND_WRITE_REQUEST_RE.test(normalized) ||
    ARABIC_QUALIFIED_COMPOUND_REQUEST_RE.test(normalized);
}

export function resolveTurnIntent(
  message: string,
  options: {
    classification?: ClassifiedRequest;
    resumed?: boolean;
    buildHandoff?: boolean;
    implementationPlanResume?: boolean;
  } = {},
): TurnIntent {
  const baseClassification = options.classification ?? classifyRequest(message);
  const normalizedMessage = normalizeIntentText(message);
  const operationalCommand = resolveOperationalCommand(message);
  const serverAction = isRunProjectScanRequest(message)
    ? "RUN_PROJECT_SCAN" as const
    : operationalCommand?.kind;
  const buildHandoff = options.buildHandoff === true;
  const implementationPlanResume = options.implementationPlanResume === true;
  const compoundExecution = isCompoundExecutionRequest(message);
  const compoundWrite = isCompoundWriteRequest(message);
  // Explicit implementation-plan language remains read-only, and ordinary
  // direct mutations remain reviewable plan requests. Task-shaped requests and
  // explicit execution continuations retain task_execution so the server-owned
  // policy can collect telemetry and produce deterministic degradation reports.
  const directImplementationPlanRequest =
    !buildHandoff &&
    !implementationPlanResume &&
    !compoundWrite &&
    !baseClassification.implementationTaskMode &&
    !isArabicExplicitExecutionActionRequest(message) &&
    !isEnglishExplicitExecutionActionRequest(message) &&
    (
      baseClassification.implementationPlanMode ||
      isExecutionActionRequest(message)
    );
  const classification = directImplementationPlanRequest
    ? {
        ...baseClassification,
        implementationPlanMode: true,
        implementationTaskMode: false,
      }
    : baseClassification;
  const route = routeTask(classification.taskType);
  const planDelivery =
    !buildHandoff && !implementationPlanResume && classification.implementationPlanMode;
  const implementationDelivery =
    buildHandoff ||
    (
      !planDelivery &&
      (
        classification.implementationTaskMode ||
        isExecutionActionRequest(message) ||
        compoundExecution
      )
    );
  const targetedProjectQuery = Boolean(classification.projectTarget);
  const unresolvedProjectQuery =
    classification.projectTargetResolution === "unresolved";
  const projectQueryTargetMode: ProjectQueryTargetMode | undefined =
    classification.projectTargetResolution === "resolved"
      ? "resolved_target"
      : classification.projectTargetResolution === "unresolved"
        ? "source_first_discovery"
        : undefined;
  const hasProjectToolSignal =
    SOURCE_PATH_RE.test(message) || PROJECT_TOOL_SIGNAL_RE.test(message);
  // Generic/social questions classified as simple must remain fast, tool-free
  // turns. Project-orientation questions use the same lightweight profile but
  // intentionally remain eligible for project read capability below.
  const isLowRiskChat =
    classification.category === "simple" &&
    classification.allowPrefetch === false &&
    classification.analysisMode === "STANDARD" &&
    classification.taskType === "BEHAVIOR_QUERY" &&
    !classification.structuredOutputMode &&
    !classification.singleFileForensicMode &&
    classification.orderedForensicRoots.length === 0 &&
    isLowRiskChatQuestion(message) &&
    !isGapAnalysisRequest(message) &&
    !implementationDelivery &&
    !classification.implementationTaskMode &&
    !classification.implementationPlanMode;
  const broadForensicTask =
    classification.taskType === "FULL_FORENSIC_AUDIT" ||
    classification.taskType === "WORKSPACE_REVIEW";
  // Gap questions are analytical project queries, but they are not broad
  // forensic audits unless the classifier already assigned a broad task.
  // Keep this separate from projectTarget: a question such as "what are the
  // agent's weaknesses?" still needs grounded claims even when it does not
  // name the embedded-AI target explicitly.
  const gapAnalysisProjectQuery =
    classification.taskType === "BEHAVIOR_QUERY" &&
    classification.analysisMode === "STANDARD" &&
    !classification.structuredOutputMode &&
    !classification.singleFileForensicMode &&
    isGapAnalysisRequest(message);
  const broadAuditIntent =
    !broadForensicTask ||
    BROAD_AUDIT_REQUEST_RE.test(normalizedMessage) ||
    EXPLICIT_STRUCTURED_AUDIT_RE.test(normalizedMessage) ||
    hasExplicitAuditScope(normalizedMessage, classification);
  const projectQueryEvidence =
    (!broadForensicTask || !broadAuditIntent) &&
    (targetedProjectQuery || unresolvedProjectQuery || gapAnalysisProjectQuery);
  const scopeClarificationRequired =
    !buildHandoff &&
    !options.resumed &&
    !planDelivery &&
    !implementationDelivery &&
    broadForensicTask &&
    BROAD_AUDIT_REQUEST_RE.test(normalizedMessage) &&
    !EXPLICIT_STRUCTURED_AUDIT_RE.test(normalizedMessage) &&
    !hasExplicitAuditScope(normalizedMessage, classification);
  // A short approval/continuation inherits the already-approved forensic
  // contract. Its raw text ("ابدأ", "continue") does not repeat the audit
  // keywords, but it must still reach the read-only evidence path.
  const resumedForensicContinuation =
    options.resumed === true &&
    !implementationPlanResume &&
    !implementationDelivery &&
    !planDelivery &&
     route.requiresEvidence &&
    !scopeClarificationRequired;

  const explicitEvidenceIntent = resolveEvidenceIntent({
    classification,
    routeRequiresEvidence: route.requiresEvidence,
    isLowRiskChat,
    implementationDelivery,
    planDelivery,
    implementationPlanResume,
    broadForensicTask,
    broadAuditIntent,
    hasProjectToolSignal,
    message,
    normalizedMessage,
    gapAnalysisProjectQuery,
    targetedProjectQuery,
    unresolvedProjectQuery,
    resumedForensicContinuation,
  });

  const requiresTools =
    isLowRiskChat
      ? false
      : implementationDelivery ||
        implementationPlanResume ||
        // Exploration turns route to PROJECT_QUERY with bounded reads so the
        // model can cite project context without entering the evidence gate.
        classification.category === "exploration" ||
        (explicitEvidenceIntent && !scopeClarificationRequired) ||
        (!planDelivery && hasProjectToolSignal && !scopeClarificationRequired);

  const kind: TurnIntentKind = implementationDelivery || planDelivery
    ? "DELIVERY"
    : explicitEvidenceIntent &&
        !scopeClarificationRequired &&
        !projectQueryEvidence
      ? "FORENSIC_AUDIT"
      : requiresTools
        ? "PROJECT_QUERY"
        : "CHAT";
  const executionTaskType: TaskType = implementationDelivery
    ? "task_execution"
     : explicitEvidenceIntent &&
         !scopeClarificationRequired &&
          !projectQueryEvidence
      ? "analysis"
      : requiresTools
        ? "tool_chat"
        : "chat";
  const operationMode: TurnOperationMode =
    kind === "DELIVERY"
      ? "DELIVERY"
      : kind === "FORENSIC_AUDIT"
        ? "FORENSIC_AUDIT"
        : "CHAT";
  const contextMode: TurnContextMode =
    isLowRiskChat ||
    (
      classification.category === "simple" &&
      !targetedProjectQuery &&
      !hasProjectToolSignal
    )
      ? "light"
      : "project";
  const phases: TurnIntentPhase[] =
    compoundExecution
      ? compoundWrite
        ? ["evidence", "proposal"]
        : ["evidence", "validation"]
      : implementationDelivery
        ? ["execution"]
         : explicitEvidenceIntent && !scopeClarificationRequired
          ? ["evidence"]
          : [];

  return {
    kind,
    category: classification.category,
    forensicTaskType: classification.taskType,
    analysisMode: explicitEvidenceIntent && !scopeClarificationRequired
      ? classification.analysisMode
      : "STANDARD",
    outputContract:
      kind === "CHAT" || (kind === "PROJECT_QUERY" && !explicitEvidenceIntent)
        ? "GENERIC_RESPONSE"
        : classification.outputContract,
    executionTaskType,
    requiresTools,
    requiresEvidence: explicitEvidenceIntent && !scopeClarificationRequired,
    resumed: options.resumed === true,
    allowsResume:
      options.resumed === true ||
      (kind !== "CHAT" && RESUMABLE_FORENSIC_TASKS.has(classification.taskType)),
    allowsBuildHandoff: buildHandoff,
    implementationPlanResume,
    scopeClarificationRequired,
    compoundExecution,
    compoundWrite,
    phases,
    ...(classification.projectTarget ? { projectTarget: classification.projectTarget } : {}),
    projectTargetResolution:
      classification.projectTargetResolution ?? "not_applicable",
    ...(projectQueryTargetMode ? { projectQueryTargetMode } : {}),
    ...(serverAction ? { serverAction } : {}),
    ...(operationalCommand ? { operationalCommand } : {}),
    ...(explicitEvidenceIntent && !scopeClarificationRequired
      ? { auditScopeDescription: describeAuditScope(classification, normalizedMessage) }
      : {}),
    operationMode,
    contextMode,
    classification,
  };
}

const EXPLICIT_STRUCTURED_AUDIT_RE =
  /(?:\b(?:required\s+output|forensic\s+findings?|findings?\s+matrix|final\s+verdict|executive\s+verdict)\b|#{1,3}\s*1[.)]\s|الأقسام\s+الستة|المخرجات\s+المطلوبة)/iu;

function hasExplicitAuditScope(message: string, classification: ClassifiedRequest): boolean {
  return (
    classification.singleFileForensicMode ||
    classification.orderedForensicRoots.length > 0 ||
    EXPLICIT_AUDIT_SCOPE_RE.test(message)
  );
}

function describeAuditScope(classification: ClassifiedRequest, message: string): string | undefined {
  const roots = classification.orderedForensicRoots
    .map((root) => root.replace(/\\/g, "/").split("/").filter(Boolean).pop())
    .filter((root): root is string => Boolean(root));
  if (classification.singleFileForensicMode && roots.length > 0) {
    return roots.length === 1
      ? `the selected file “${roots[0]}”`
      : `the selected files: ${roots.join(", ")}`;
  }
  if (roots.length > 0) {
    return roots.length === 1
      ? `the selected folder “${roots[0]}”`
      : `the selected folders: ${roots.join(", ")}`;
  }
  if (BROAD_AUDIT_REQUEST_RE.test(message) && hasExplicitAuditScope(message, classification)) {
    return "the whole project";
  }
  return undefined;
}

const BROAD_AUDIT_REQUEST_RE =
  /(?:\b(?:audit|review|inspect|assess|evaluate|scan)\b[\s\S]{0,100}\b(?:project|workspace|repository|repo|codebase|problems?|issues?|bugs?|architecture|gaps?)\b|\banaly[sz]e\b[\s\S]{0,100}\b(?:problems?|issues?|bugs?|vulnerabilit(?:y|ies)|gaps?)\b|\b(?:full|complete|comprehensive|whole|entire)\s+(?:project|workspace|repository|repo|codebase)\s+(?:audit|review|assessment|analysis)\b|(?:افحص|راجع|قيّم|قيم|حلل|حلّل|استكشف|دقق|دقّق|تدقيق|مراجعة|فحص)\s+(?:(?:في|على|ضمن|داخل)\s+)?(?:(?:كل|كامل|كاملة|بالكامل|شامل|شاملة|واسع|واسعة)\s+)?(?:مشروعي|المشروع|مساحة\s+العمل|مستودعي|المستودع|الريبو|ريبو|قاعدة\s+(?:الكود|الشفرة|المصدر)|المشاكل|المشكلات|الفجوات|المشكلات)(?:\s+(?:بالكامل|كله|كاملًا|كاملة))?)[\s\S]*/iu;
