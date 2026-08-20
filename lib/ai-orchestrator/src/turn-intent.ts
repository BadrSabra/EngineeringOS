import {
  classifyRequest,
  type ClassifiedRequest,
  type RequestCategory,
} from "./prompts/profile-classifier.js";
import {
  isExplicitBehaviorQueryRequest,
  isProductionReachabilityRequest,
  routeTask,
  type AnalysisMode,
  type ForensicTaskType,
  type OutputContract,
} from "./task-contracts.js";
import type { TaskType } from "./quality/task-profile.js";

export type TurnIntentKind =
  | "CHAT"
  | "PROJECT_QUERY"
  | "FORENSIC_AUDIT"
  | "DELIVERY";

export type TurnOperationMode = "CHAT" | "FORENSIC_AUDIT" | "DELIVERY";

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
  /** Broad forensic requests must declare a scope before expensive discovery. */
  scopeClarificationRequired: boolean;
  /** User-readable description of the boundary approved for this audit. */
  auditScopeDescription?: string;
  operationMode: TurnOperationMode;
  classification: ClassifiedRequest;
};

const RESUMABLE_FORENSIC_TASKS = new Set<ForensicTaskType>([
  "FINDING_ANALYSIS",
  "FULL_FORENSIC_AUDIT",
  "WORKSPACE_REVIEW",
  "REPAIR_ANALYSIS",
]);

const PROJECT_TOOL_SIGNAL_RE =
  /(?:\b(?:file|folder|directory|repository|repo|codebase|project|source|function|class|method|module|component|handler|middleware|endpoint|route|schema|database|table|query|test|bug|error|implementation|architecture|workflow|pipeline|dependency|dependencies|configuration|config|api|branch|commit|loop|iteration|iterations|behavior|behaviour|return|result|call|invocation|limit|counter)\b|ملف|مجلد|مستودع|مشروع|كود|شفرة|مصدر|دالة|وحدة|مكوّن|مكون|واجهة|مسار|مخطط|قاعدة\s+بيانات|جدول|استعلام|اختبار|خطأ|خلل|تنفيذ|معمارية|سير\s+العمل|اعتماديات|إعدادات|حلقة|تكرار|سلوك|إرجاع|نتيجة)/iu;

const SOURCE_PATH_RE =
  /(?:^|[\s`"'(])(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b/iu;

const ENGLISH_EXECUTION_ACTION_RE =
  /^\s*(?:(?:please|kindly)\s+)?(?:(?:(?:can|could|would|will)\s+you|go\s+ahead\s+and|i\s+(?:need|want)\s+you\s+to|i(?:'d|\s+would)\s+like\s+you\s+to)\s+)?(?:(?:please|kindly)\s+)?(?:fix|patch|implement|modify|change|write|edit|apply|execute|build|refactor|delete|remove|create|add)\b/iu;

const ARABIC_EXECUTION_ACTION_RE =
  /^\s*(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:(?:هل\s+يمكنك|ممكن)\s+)?(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:أن\s+)?(?:أصلح|صحح|عدّل|غير|غيّر|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف|تصلح|تصحح|تعدّل|تعدل|تغير|تكتب|تطبّق|تطبق|تنفّذ|تنفذ|تبني|تنشئ|تضيف|تحذف|إصلاح|تصحيح|تعديل|تغيير|كتابة|تطبيق|تنفيذ|بناء|إنشاء|إضافة|حذف)(?:\s|$)/iu;

const FORENSIC_EVIDENCE_SIGNAL_RE =
  /(?:\b(?:audit|forensic|root\s+cause|prove|verify|investigate)\b|تدقيق|جنائي|تحقيق|تحقق|تحقّق|السبب\s+الجذري|الأسباب\s+الجذرية|أثبت|اثبت)/iu;

const EXPLICIT_AUDIT_SCOPE_RE =
  /(?:\b(?:src|lib|app|server|client|test|tests|components?|pages?|routes?|api|packages?|artifacts?|files?)\b|[./][\w@.-]+(?:\/[\w@.-]+)*|[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|json|yaml|yml|toml|css|scss|html)\b|specific\s+(?:file|folder|directory|module)|(?:whole|entire|full|all)\s+(?:the\s+)?(?:project|workspace|repository|repo|codebase|code)|مجلد\s+(?:محدد|معين)|ملف(?:ات)?\s+(?:محدد(?:ة)?|معين(?:ة)?)|هذا\s+الملف|الملفات\s+الإنتاجية|الكود\s+الإنتاجي|المشروع\s+بالكامل|كل\s+(?:المشروع|المستودع|الكود)|المشروع\s+كله)/iu;
function isExecutionActionRequest(message: string): boolean {
  return (
    ENGLISH_EXECUTION_ACTION_RE.test(message) ||
    ARABIC_EXECUTION_ACTION_RE.test(message)
  );
}

export function resolveTurnIntent(
  message: string,
  options: {
    classification?: ClassifiedRequest;
    resumed?: boolean;
    buildHandoff?: boolean;
  } = {},
): TurnIntent {
  const classification = options.classification ?? classifyRequest(message);
  const route = routeTask(classification.taskType);
  const buildHandoff = options.buildHandoff === true;
  const planDelivery =
    !buildHandoff && classification.implementationPlanMode;
  const implementationDelivery =
    buildHandoff ||
    (
      !planDelivery &&
      (
        classification.implementationTaskMode ||
        isExecutionActionRequest(message)
      )
    );
  const hasProjectToolSignal =
    SOURCE_PATH_RE.test(message) || PROJECT_TOOL_SIGNAL_RE.test(message);
  // Orientation questions classified as simple must remain fast, tool-free
  // turns even when they contain a broad word such as "project".
  const isLowRiskChat =
    classification.category === "simple" &&
    classification.allowPrefetch === false &&
    classification.analysisMode === "STANDARD" &&
    classification.taskType === "BEHAVIOR_QUERY" &&
    !classification.structuredOutputMode &&
    !classification.singleFileForensicMode &&
    classification.orderedForensicRoots.length === 0 &&
    !implementationDelivery &&
    !classification.implementationTaskMode &&
    !classification.implementationPlanMode;
  const broadForensicTask =
    classification.taskType === "FULL_FORENSIC_AUDIT" ||
    classification.taskType === "WORKSPACE_REVIEW";
  const broadAuditIntent =
    !broadForensicTask ||
    BROAD_AUDIT_REQUEST_RE.test(message) ||
    EXPLICIT_STRUCTURED_AUDIT_RE.test(message) ||
    hasExplicitAuditScope(message, classification);
  const scopeClarificationRequired =
    !buildHandoff &&
    !options.resumed &&
    !planDelivery &&
    !implementationDelivery &&
    broadForensicTask &&
    BROAD_AUDIT_REQUEST_RE.test(message) &&
    !EXPLICIT_STRUCTURED_AUDIT_RE.test(message) &&
    !FORENSIC_EVIDENCE_SIGNAL_RE.test(message) &&
    !hasExplicitAuditScope(message, classification);

  const explicitEvidenceIntent = Boolean(
    !isLowRiskChat &&
    !implementationDelivery &&
    !planDelivery &&
    route.requiresEvidence &&
    (
      (
        (!broadForensicTask || broadAuditIntent) &&
        (
          classification.analysisMode === "FORENSIC" ||
          classification.structuredOutputMode ||
          classification.singleFileForensicMode ||
          classification.orderedForensicRoots.length > 0
        )
      ) ||
      (hasProjectToolSignal && isExplicitBehaviorQueryRequest(message)) ||
      isProductionReachabilityRequest(message) ||
      FORENSIC_EVIDENCE_SIGNAL_RE.test(message)
    ),
  );

  const requiresTools =
    isLowRiskChat
      ? false
      : implementationDelivery ||
        (explicitEvidenceIntent && !scopeClarificationRequired) ||
        (!planDelivery && hasProjectToolSignal && !scopeClarificationRequired);

  const kind: TurnIntentKind = implementationDelivery || planDelivery
    ? "DELIVERY"
    : explicitEvidenceIntent && !scopeClarificationRequired
      ? "FORENSIC_AUDIT"
      : requiresTools
        ? "PROJECT_QUERY"
        : "CHAT";
  const executionTaskType: TaskType = implementationDelivery
    ? "task_execution"
    : explicitEvidenceIntent && !scopeClarificationRequired
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

  return {
    kind,
    category: classification.category,
    forensicTaskType: classification.taskType,
    analysisMode: explicitEvidenceIntent && !scopeClarificationRequired
      ? classification.analysisMode
      : "STANDARD",
    outputContract:
      kind !== "CHAT"
        ? classification.outputContract
        : "GENERIC_RESPONSE",
    executionTaskType,
    requiresTools,
    requiresEvidence: explicitEvidenceIntent && !scopeClarificationRequired,
    resumed: options.resumed === true,
    allowsResume:
      options.resumed === true ||
      (kind !== "CHAT" && RESUMABLE_FORENSIC_TASKS.has(classification.taskType)),
    allowsBuildHandoff: buildHandoff,
    scopeClarificationRequired,
    ...(explicitEvidenceIntent && !scopeClarificationRequired
      ? { auditScopeDescription: describeAuditScope(classification, message) }
      : {}),
    operationMode,
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
  /(?:\b(?:audit|review|inspect|assess|evaluate)\b[\s\S]{0,100}\b(?:project|workspace|repository|repo|codebase|problems?|issues?|bugs?)\b|\banaly[sz]e\b[\s\S]{0,100}\b(?:problems?|issues?|bugs?|vulnerabilit(?:y|ies))\b|(?:افحص|راجع|قيّم|قيم|حلل|حلّل|استكشف)\s+(?:مشروعي|المشروع|مساحة\s+العمل|المستودع|قاعدة\s+الكود|المشاكل|المشكلات))/iu;
