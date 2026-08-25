import type { AgentStep } from "./tool-execution-engine.js";
import {
  evaluateTaskChecklist,
  type TaskChecklistItem,
  type TaskChecklistItemResult,
} from "./task-checklist.js";

export type TaskExecutionPartialReason = "MALFORMED_JSON" | "SOFT_LIMIT" | "PROVIDER_TIMEOUT";

export type TaskExecutionPartialReportOptions = {
  reason: TaskExecutionPartialReason;
  isArabic: boolean;
  taskChecklist: TaskChecklistItem[];
  telemetry: AgentStep[];
  toolSources: string[];
  fileContents?: Map<string, string>;
  pendingChangesCount: number;
};

type CompletedToolCall = {
  tool: string;
  args: Record<string, string>;
};

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "");
}

function completedToolCalls(telemetry: AgentStep[]): CompletedToolCall[] {
  const pending = new Map<string, Record<string, string>[]>();
  const completed: CompletedToolCall[] = [];

  for (const step of telemetry) {
    if (step.kind === "tool_call") {
      const calls = pending.get(step.tool) ?? [];
      calls.push(step.args);
      pending.set(step.tool, calls);
      continue;
    }
    if (step.kind !== "tool_result") continue;

    const calls = pending.get(step.tool) ?? [];
    const args = calls.shift() ?? {};
    if (calls.length === 0) pending.delete(step.tool);
    else pending.set(step.tool, calls);
    completed.push({ tool: step.tool, args });
  }
  return completed;
}

function readFiles(
  telemetry: AgentStep[],
  toolSources: string[],
  fileContents: Map<string, string> | undefined,
): string[] {
  const files = new Set<string>();
  for (const file of fileContents?.keys() ?? []) files.add(normalizePath(file));
  for (const source of toolSources) {
    if (source.trim()) files.add(normalizePath(source));
  }
  for (const step of telemetry) {
    if (step.kind === "tool_result" && step.tool === "read_file" && step.source) {
      files.add(normalizePath(step.source));
    }
  }
  return [...files].filter(Boolean).sort();
}

function boundedArgument(value: string | undefined): string {
  if (!value) return "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function describeSearch(call: CompletedToolCall): string {
  const query = boundedArgument(call.args.query ?? call.args.pattern ?? call.args.search);
  const path = boundedArgument(call.args.path ?? call.args.directory ?? call.args.root);
  const details = [
    query ? `query="${query}"` : "",
    path ? `path="${path}"` : "",
  ].filter(Boolean);
  return details.length > 0 ? `${call.tool} (${details.join(", ")})` : call.tool;
}

function checklistLines(
  results: TaskChecklistItemResult[],
  isArabic: boolean,
): string[] {
  if (results.length === 0) {
    return [isArabic ? "- لا توجد بنود عقد مكتشفة." : "- No contract items were detected."];
  }
  return results.map((result) =>
    result.complete
      ? `- [x] ${result.item.text} — ${isArabic ? "دليل" : "Evidence"}: ${result.evidence.join("; ")}`
      : `- [ ] ${result.item.text} — ${isArabic ? "غير مثبت" : "Unproven"}: ${result.reason ?? "No direct telemetry evidence."}`,
  );
}

function timeoutPreamble(isArabic: boolean): string {
  return isArabic
    ? "توقف مزود الذكاء الاصطناعي بسبب انتهاء المهلة بعد تجميع الأدلة. "
    : "The AI provider timed out after collecting evidence. ";
}

function nextRecommendation(
  reason: TaskExecutionPartialReason,
  results: TaskChecklistItemResult[],
  readFileList: string[],
  searchList: string[],
  pendingChangesCount: number,
  isArabic: boolean,
): string {
  const prefix = reason === "PROVIDER_TIMEOUT" ? timeoutPreamble(isArabic) : "";
  const incomplete = results.find((result) => !result.complete);
  if (incomplete) {
    const item = incomplete.item.text;
    const normalized = item.toLowerCase();
    if (/(?:run|test|check|validat|typecheck|tsc|vitest|jest|pytest)/i.test(normalized)) {
      return isArabic
        ? `نفّذ بند التحقق غير المثبت أولاً: ${item}`
        : `Run the first unproven validation item: ${item}`;
    }
    if (/\b(?:search|find|locate|grep|scan)\b/i.test(normalized)) {
      return isArabic
        ? `أكمل عملية البحث غير المثبتة أولاً: ${item}`
        : `Complete the first unproven search item: ${item}`;
    }
    if (readFileList.length === 0) {
      return isArabic
        ? `اقرأ الملف المطلوب لإثبات البند أولاً: ${item}`
        : `Read the required source file before continuing: ${item}`;
    }
    return isArabic
      ? `أكمل أول بند غير مثبت دون إعادة القراءات المؤكدة: ${item}`
      : `Complete the first unproven contract item without repeating confirmed reads: ${item}`;
  }

  if (pendingChangesCount > 0) {
    return (
      prefix +
      (isArabic
        ? "راجع التغييرات المقترحة ووافق عليها، ثم نفّذ validation profile المسجل."
        : "Review and approve the pending changes, then run the registered validation profile.")
    );
  }
  if (searchList.length === 0) {
    return (
      prefix +
      (isArabic
        ? "نفّذ بحثاً موجهاً واحداً على الأقل قبل إعلان اكتمال المهمة."
        : "Run at least one targeted search before declaring the task complete.")
    );
  }
  if (reason === "PROVIDER_TIMEOUT") {
    return (
      prefix +
      (isArabic
        ? "أعد المحاولة عند توفر الشبكة؛ الأدلة المجمّعة محفوظة أعلاه ولا حاجة لإعادة القراءات."
        : "Retry when the provider is available; the collected evidence above is preserved and reads do not need to repeat.")
    );
  }
  return reason === "SOFT_LIMIT"
    ? isArabic
      ? "استأنف من أول خطوة غير مكتملة باستخدام الأدلة الحالية، دون إعادة قراءة الملفات المؤكدة."
      : "Resume from the first incomplete step using the recorded evidence; do not reread confirmed files."
    : isArabic
      ? "أعد المحاولة بعد مراجعة الأدلة الحالية، ولا تعتبر المهمة مكتملة دون استجابة JSON صالحة."
      : "Retry after reviewing the recorded evidence; do not mark the task complete without a valid JSON response.";
}

/**
 * Build the task-execution degradation response without consulting a model.
 * Every displayed fact comes from completed tool telemetry or server-owned
 * pending-change state.
 */
export function buildTaskExecutionPartialReport(
  options: TaskExecutionPartialReportOptions,
): string {
  const {
    reason,
    isArabic,
    taskChecklist,
    telemetry,
    toolSources,
    fileContents,
    pendingChangesCount,
  } = options;
  const completed = completedToolCalls(telemetry);
  const files = readFiles(telemetry, toolSources, fileContents);
  const searches = completed
    .filter((call) => call.tool === "search_code")
    .map(describeSearch);
  const results = evaluateTaskChecklist(taskChecklist, telemetry);
  const recommendation = nextRecommendation(
    reason,
    results,
    files,
    searches,
    pendingChangesCount,
    isArabic,
  );

  const timeoutNote =
    reason === "PROVIDER_TIMEOUT"
      ? isArabic
        ? "سبب التوقف: انتهت مهلة مزود الذكاء الاصطناعي — النتائج أدناه مستندة فقط إلى الأدلة المجمّعة."
        : "Stop reason: The AI provider timed out — findings below are based on collected evidence only."
      : undefined;

  const lines = [
    "## Task Execution Partial Report",
    "Status: PARTIALLY_COMPLETE",
    `Trigger: ${reason}`,
    ...(timeoutNote ? [timeoutNote] : []),
    "Report source: COMPLETED_TOOL_TELEMETRY_ONLY",
    "Model consulted for this report: NO",
    "",
    "### Files read",
    ...(files.length > 0
      ? files.map((file) => `- ${file}`)
      : [isArabic ? "- لا يوجد ملف مقروء مؤكد." : "- No confirmed file read."]),
    "",
    "### Searches completed",
    ...(searches.length > 0
      ? searches.map((search) => `- ${search}`)
      : [isArabic ? "- لا توجد عملية search_code مكتملة." : "- No completed search_code operation."]),
    "",
    "### Contract progress",
    ...checklistLines(results, isArabic),
    "",
    "### Next recommendation",
    `- ${recommendation}`,
  ];

  return lines.join("\n");
}