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
  /(?:\b(?:file|folder|directory|repository|repo|codebase|project|source|function|class|method|module|component|handler|middleware|endpoint|route|schema|database|table|query|test|bug|error|implementation|architecture|workflow|pipeline|dependency|dependencies|configuration|config|api|branch|commit)\b|ملف|مجلد|مستودع|مشروع|كود|شفرة|مصدر|دالة|وحدة|مكوّن|مكون|واجهة|مسار|مخطط|قاعدة\s+بيانات|جدول|استعلام|اختبار|خطأ|خلل|تنفيذ|معمارية|سير\s+العمل|اعتماديات|إعدادات)/iu;

const SOURCE_PATH_RE =
  /(?:^|[\s`"'(])(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b/iu;

const ENGLISH_EXECUTION_ACTION_RE =
  /^\s*(?:(?:please|kindly)\s+)?(?:(?:(?:can|could|would|will)\s+you|go\s+ahead\s+and|i\s+(?:need|want)\s+you\s+to|i(?:'d|\s+would)\s+like\s+you\s+to)\s+)?(?:(?:please|kindly)\s+)?(?:fix|patch|implement|modify|change|write|edit|apply|execute|build|refactor|delete|remove|create|add)\b/iu;

const ARABIC_EXECUTION_ACTION_RE =
  /^\s*(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:(?:هل\s+يمكنك|ممكن)\s+)?(?:(?:من\s+فضلك|لو\s+سمحت)\s+)?(?:أن\s+)?(?:أصلح|صحح|عدّل|غير|غيّر|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف|تصلح|تصحح|تعدّل|تعدل|تغير|تكتب|تطبّق|تطبق|تنفّذ|تنفذ|تبني|تنشئ|تضيف|تحذف|إصلاح|تصحيح|تعديل|تغيير|كتابة|تطبيق|تنفيذ|بناء|إنشاء|إضافة|حذف)(?:\s|$)/iu;

const FORENSIC_EVIDENCE_SIGNAL_RE =
  /(?:\b(?:audit|forensic|root\s+cause|prove|verify|investigate)\b|تدقيق|جنائي|تحقيق|تحقق|تحقّق|السبب\s+الجذري|الأسباب\s+الجذرية|أثبت|اثبت)/iu;

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

  const explicitEvidenceIntent = Boolean(
    !implementationDelivery &&
    !planDelivery &&
    route.requiresEvidence &&
    (
      classification.analysisMode === "FORENSIC" ||
      classification.structuredOutputMode ||
      classification.singleFileForensicMode ||
      classification.orderedForensicRoots.length > 0 ||
      (hasProjectToolSignal && isExplicitBehaviorQueryRequest(message)) ||
      isProductionReachabilityRequest(message) ||
      FORENSIC_EVIDENCE_SIGNAL_RE.test(message)
    ),
  );

  const requiresTools =
    implementationDelivery ||
    explicitEvidenceIntent ||
    (!planDelivery && hasProjectToolSignal);

  const kind: TurnIntentKind = implementationDelivery || planDelivery
    ? "DELIVERY"
    : explicitEvidenceIntent
      ? "FORENSIC_AUDIT"
      : requiresTools
        ? "PROJECT_QUERY"
        : "CHAT";
  const executionTaskType: TaskType = implementationDelivery
    ? "task_execution"
    : explicitEvidenceIntent
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
    analysisMode: explicitEvidenceIntent ? classification.analysisMode : "STANDARD",
    outputContract:
      kind !== "CHAT"
        ? classification.outputContract
        : "GENERIC_RESPONSE",
    executionTaskType,
    requiresTools,
    requiresEvidence: explicitEvidenceIntent,
    resumed: options.resumed === true,
    allowsResume:
      options.resumed === true ||
      (kind !== "CHAT" && RESUMABLE_FORENSIC_TASKS.has(classification.taskType)),
    allowsBuildHandoff: buildHandoff,
    operationMode,
    classification,
  };
}