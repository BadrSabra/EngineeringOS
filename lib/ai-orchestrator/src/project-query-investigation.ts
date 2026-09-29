import { createHash } from "node:crypto";
import { z } from "zod";

export const PROJECT_QUERY_FACT_MAX_FILES = 4;
export const PROJECT_QUERY_FACT_MAX_ITERATIONS = 2;
export const PROJECT_QUERY_FACT_MAX_TOOL_CALLS = 8;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const projectRelativePathSchema = z.string()
  .min(1)
  .max(500)
  .refine((value) => {
    const normalized = value.replaceAll("\\", "/");
    return !normalized.startsWith("/")
      && !/^[a-zA-Z]:/.test(normalized)
      && !normalized.split("/").includes("..")
      && normalized.split("/").filter(Boolean).every((segment) => segment !== ".");
  }, "Path must be a normalized project-relative path");

export const ProjectQueryInvestigationContractSchema = z.object({
  schemaVersion: z.literal("v1"),
  kind: z.literal("FACT"),
  investigationId: z.string().min(8).max(120),
  ownerId: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  operationId: z.string().min(1).max(200),
  workspaceRevision: z.string().min(1).max(240),
  workspaceRoot: z.string().max(2000).nullable(),
  question: z.string().min(1).max(1200),
  questionHash: sha256Schema,
  requiredObligationIds: z.array(z.literal("original-question")).length(1),
  maxFiles: z.literal(PROJECT_QUERY_FACT_MAX_FILES),
  maxIterations: z.literal(PROJECT_QUERY_FACT_MAX_ITERATIONS),
  maxToolCalls: z.literal(PROJECT_QUERY_FACT_MAX_TOOL_CALLS),
  allowedPaths: z.array(projectRelativePathSchema).max(PROJECT_QUERY_FACT_MAX_FILES),
  manifestId: sha256Schema.nullable(),
}).strict().superRefine((contract, context) => {
  if (new Set(contract.allowedPaths).size !== contract.allowedPaths.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allowedPaths"],
      message: "FACT scope paths must be unique",
    });
  }
  if ((contract.allowedPaths.length === 0) !== (contract.manifestId === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestId"],
      message: "A FACT manifest identity is required exactly when paths are bound",
    });
  }
});
export type ProjectQueryInvestigationContract = z.infer<
  typeof ProjectQueryInvestigationContractSchema
>;

export const ProjectQueryInvestigationStatusSchema = z.enum([
  "ANSWER_COMPLETE",
  "ANSWER_PARTIAL",
  "ANSWER_EVIDENCE_ONLY",
  "ANSWER_UNDETERMINED",
  "ANSWER_BLOCKED",
]);
export type ProjectQueryInvestigationStatus = z.infer<
  typeof ProjectQueryInvestigationStatusSchema
>;

export const ProjectQueryInvestigationResultSchema = z.object({
  kind: z.literal("PROJECT_QUERY_INVESTIGATION_RESULT"),
  investigationId: z.string().min(8).max(120),
  class: z.literal("FACT"),
  status: ProjectQueryInvestigationStatusSchema,
  answer: z.string().max(12000),
  answerAssessment: z.enum(["MODEL_PROPOSED", "SOURCE_OBSERVED_ONLY", "MODEL_UNDETERMINED", "NONE"]),
  requiredCoverage: z.object({
    obligationId: z.literal("original-question"),
    questionHash: sha256Schema,
    status: z.enum(["ANSWERED", "PARTIAL", "UNANSWERED"]),
  }).strict(),
  sources: z.array(z.object({
    observationId: sha256Schema,
    path: projectRelativePathSchema,
    contentSha256: sha256Schema,
    byteLength: z.number().int().min(0).max(20_000_000),
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
    readStatus: z.literal("READ_COMPLETE"),
    workspaceRevision: z.string().min(1).max(240),
    operationId: z.string().min(1).max(200),
    executionId: z.string().min(1).max(200).nullable(),
    attempt: z.number().int().min(0).max(10000).nullable(),
  }).strict()).max(PROJECT_QUERY_FACT_MAX_FILES),
  manifestId: sha256Schema.nullable(),
  workspaceRevision: z.string().min(1).max(240),
  operationId: z.string().min(1).max(200),
  executionId: z.string().min(1).max(200).nullable(),
  attempt: z.number().int().min(0).max(10000).nullable(),
  reasonCode: z.enum([
    "NO_ACCEPTED_OBSERVATION",
    "INCOMPLETE_OBSERVATION",
    "EMPTY_ANSWER",
    "ANSWER_UNCERTAIN",
    "ANSWER_PARTIAL",
    "SCOPE_UNAVAILABLE",
    "IDENTITY_MISMATCH",
  ]).optional(),
  assurance: z.literal("INVESTIGATION_ONLY"),
}).strict();
export type ProjectQueryInvestigationResult = z.infer<
  typeof ProjectQueryInvestigationResultSchema
>;

export function normalizeProjectQueryFactPath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/")
    || /^[a-zA-Z]:/.test(normalized)
    || normalized.split("/").includes("..")
  ) return null;
  const result = normalized
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
  return result || null;
}

export function normalizeProjectQueryFactQuestion(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function hashProjectQueryFactQuestion(value: string): string {
  return createHash("sha256")
    .update(normalizeProjectQueryFactQuestion(value))
    .digest("hex");
}

export function hashProjectQueryFactManifest(input: {
  projectId: string;
  workspaceRevision: string;
  workspaceRoot: string | null;
  allowedPaths: string[];
}): string {
  const allowedPaths = [...new Set(input.allowedPaths)]
    .map(normalizeProjectQueryFactPath)
    .filter((path): path is string => Boolean(path))
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({
      schemaVersion: "v1",
      kind: "FACT",
      projectId: input.projectId,
      workspaceRevision: input.workspaceRevision,
      workspaceRoot: input.workspaceRoot,
      allowedPaths,
    }))
    .digest("hex");
}

/**
 * Deterministic first-slice eligibility. The caller must additionally require
 * PROJECT_QUERY, no canonical objective, and no orientation/capability mode.
 */
export function classifyProjectQueryInvestigationQuestion(
  message: string,
): "FACT" | "UNSUPPORTED" {
  const question = message.normalize("NFKC").trim();
  if (!question || question.length > 480 || /```|[\r\n]/.test(question)) {
    return "UNSUPPORTED";
  }

  const normalized = normalizeProjectQueryFactQuestion(question);
  const questionMarks = (question.match(/[?؟]/g) ?? []).length;
  if (
    questionMarks > 1
    || /[;；]/.test(question)
    || /\b(?:and|or|also|then|as well as|compared with|versus)\b|(?:وما|وماذا|وكيف|ثم)/i.test(normalized)
  ) return "UNSUPPORTED";

  const unsupportedConcept = /\b(?:how|why|explain|architecture|overview|summary|summarize|root cause|cause|impact|compare|comparison|difference|relationship|flow|current|runtime|state|behavior|behaviour|plan|fix|change|modify|implement|write|run|deploy|test|debug|analy[sz]e)\b|(?:لماذا|كيف|اشرح|معمارية|بنية|حالة|تأثير|مقارنة|سبب|أصلح|عدّل|نفّذ|شغّل)/i;
  if (unsupportedConcept.test(normalized)) return "UNSUPPORTED";

  const questionLead =
    /^(?:where|which|what|who)\b|^(?:أين|فين|ما|ماذا|أي|من)(?:\s|[?؟]|$)/i;
  const sourceFactAnchor = /\b(?:file|function|class|module|route|handler|symbol|method|endpoint|variable|constant|config(?:uration)?|setting|table|field|property|export|declaration|definition|middleware|component|package|service|provider|auth(?:entication)?|login|session|database|api|server|client|defined|declared|stored|created|registered|exported|returns?|uses?|located|handled|initialized|configured)\b|(?:ملف|دالة|صنف|فئة|وحدة|مسار|معالج|رمز|طريقة|نقطة|متغير|ثابت|إعداد|جدول|حقل|خاصية|تصدير|تعريف|مكوّن|حزمة|خدمة|مصادقة|تسجيل|جلسة|قاعدة بيانات|واجهة|خادم|عميل|موجود|مُعرّف|مخزّن|منشأ|مسجّل|يستخدم|يتعامل|تهيئة)/i;
  return questionLead.test(normalized) && sourceFactAnchor.test(normalized)
    ? "FACT"
    : "UNSUPPORTED";
}