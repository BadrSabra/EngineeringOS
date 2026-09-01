/**
 * Code Reviewer — reviews code quality based on project context and metrics,
 * produces a structured quality report.
 */
import { createHash } from "node:crypto";
import type { ProjectContext } from "../context-builder.js";
import { buildCodeReviewSystemPrompt, buildCodeReviewUserPrompt } from "../prompts/review.prompt.js";
import { CodeReviewResultSchema, type CodeReviewOutput, type CodeIssue } from "../schemas/code-review.schema.js";
import type { AgentCompleteOpts, ProviderId } from "../agent-complete.js";
import { GroqClientError } from "../errors.js";
import { classifyOpenRouterFailure, type OpenRouterFailureAction } from "../openai-compatible-client.js";
import type { Message } from "../groq-client.js";
import { BaseAgent, type AgentRunResult } from "./base-agent.js";
import { normalizeReviewInputs, type ReviewScope } from "../review-scope.js";

export type { CodeIssue, CodeReviewOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with degraded fallback content.
 */
export type CodeReviewResult = AgentRunResult<CodeReviewOutput>;

export const CODE_REVIEW_CAMPAIGN_SCENARIOS = [
  "reasoning-only",
  "agent-harness",
  "rate-limit",
  "empty",
  "malformed",
] as const;

export type CodeReviewCampaignScenario = (typeof CODE_REVIEW_CAMPAIGN_SCENARIOS)[number];

export type CodeReviewCampaignReceipt = {
  kind: "code-review-provider-campaign-receipt";
  version: 1;
  scenario: CodeReviewCampaignScenario;
  provider: ProviderId;
  operationId: string;
  projectId: string;
  projectRevision: string;
  outcomeClass: "fallback-success" | "terminal-incomplete";
  terminalStatus: "COMPLETE" | "INCOMPLETE";
  failureCode?: string;
  recoveryAction: OpenRouterFailureAction | "retry-review";
  attemptedModels: string[];
  evidence: Array<{
    file: string;
    findingHash: string;
  }>;
};

function fallbackCodeReview(): CodeReviewOutput {
  return {
    summary: "Code review completed",
    overallScore: 70,
    strengths: [],
    issues: [],
    refactoringOpportunities: [],
    securityConcerns: [],
    verdict: "needs_changes",
  };
}

class CodeReviewAgent extends BaseAgent<ProjectContext, CodeReviewOutput> {
  protected readonly scope = "code-reviewer";
  protected readonly schema = CodeReviewResultSchema;

  constructor(private readonly fileContents?: Record<string, string>) {
    super();
  }

  protected buildMessages(projectContext: ProjectContext): Message[] {
    return [
      { role: "system", content: buildCodeReviewSystemPrompt() },
      { role: "user", content: buildCodeReviewUserPrompt(projectContext, this.fileContents) },
    ];
  }

  protected buildCompleteOpts(): AgentCompleteOpts {
    // A review should try a small number of currently usable JSON models and
    // then fail visibly. Walking the full free catalog can turn one bad
    // reasoning-only or rate-limited model into a very long request.
    // Let transient model-level failures advance immediately; OpenRouter can
    // rate-limit one upstream provider while other free candidates remain
    // usable.
    return { maxFallbackModels: 3, retryTransient: false };
  }

  protected fallbackOutput(): CodeReviewOutput {
    return fallbackCodeReview();
  }
}

export async function reviewCode(
  projectContext: ProjectContext,
  fileContents?: Record<string, string>,
  opts?: AgentCompleteOpts,
): Promise<CodeReviewResult & { reviewScope: ReviewScope }> {
  const accounting = normalizeReviewInputs(projectContext, fileContents);
  const result = await new CodeReviewAgent(fileContents).run(projectContext, opts);
  const selectedPaths = accounting.includedFilePaths;
  if (
    !result._parseError &&
    !result._qualityError &&
    selectedPaths.length > 0 &&
    !result.issues.some((issue) => typeof issue.file === "string" && selectedPaths.includes(issue.file))
  ) {
    // A syntactically valid approval without a cited selected-file finding is
    // not trustworthy for file-gap analysis. Surface it as incomplete rather
    // than letting an empty issues array look like a verified review.
    return {
      ...result,
      reviewScope: accounting.scope,
      _parseError: {
        code: "SCHEMA_VALIDATION_FAILED",
        message: "The review did not return a finding cited to a selected file.",
        raw: JSON.stringify(result),
      },
    };
  }
  return { ...result, reviewScope: accounting.scope };
}

const SAFE_MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,199}$/i;
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_RELATIVE_FILE_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.)(?:[a-z0-9._-]+\/)*[a-z0-9._-]+$/i;
const PROVIDER_ERROR_CODES = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "AUTH_ERROR",
  "RATE_LIMITED",
  "QUOTA",
  "SERVER_ERROR",
  "NON_200",
  "MODEL_NOT_FOUND",
  "PLAN_RESTRICTED",
  "MODEL_UNAVAILABLE",
  "EMPTY_RESPONSE",
  "INVALID_CONFIG",
]);
const AGENT_FAILURE_CODES = new Set([
  "EMPTY_MODEL_RESPONSE",
  "MALFORMED_JSON",
  "SCHEMA_VALIDATION_FAILED",
  "QUALITY_REVIEW_LOW",
]);
const SAFE_FAILURE_CODES = new Set([...PROVIDER_ERROR_CODES, ...AGENT_FAILURE_CODES]);

function safeIdentifier(value: string): string {
  const trimmed = value.trim();
  return SAFE_IDENTIFIER_PATTERN.test(trimmed)
    ? trimmed
    : `redacted-${createHash("sha256").update(trimmed).digest("hex").slice(0, 16)}`;
}

function safeModels(models: readonly string[] | undefined): string[] {
  return [...new Set((models ?? [])
    .map((model) => model.trim())
    .filter((model) => SAFE_MODEL_PATTERN.test(model))
    .slice(0, 8))];
}

function findingHash(issue: CodeIssue): string {
  return createHash("sha256")
    .update(JSON.stringify({
      file: issue.file,
      type: issue.type,
      severity: issue.severity,
      title: issue.title,
    }))
    .digest("hex")
    .slice(0, 16);
}

function recoveryActionFor(
  code: string | undefined,
): OpenRouterFailureAction | "retry-review" {
  if (!code || !PROVIDER_ERROR_CODES.has(code)) return "retry-review";
  const knownCode = code as Parameters<typeof classifyOpenRouterFailure>[0];
  return classifyOpenRouterFailure(knownCode).action;
}

function safeFailureCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return SAFE_FAILURE_CODES.has(code) ? code : "REVIEW_INCOMPLETE";
}

/**
 * Build the only receipt format permitted for the credential-gated review
 * campaign. Provider responses, parser raw text, prompts, and paths never
 * cross this boundary.
 */
export function buildCodeReviewCampaignReceipt(params: {
  scenario: CodeReviewCampaignScenario;
  provider: ProviderId;
  operationId: string;
  projectId: string;
  projectRevision: string;
  selectedFile: string;
  result?: CodeReviewResult;
  error?: unknown;
  attemptedModels?: readonly string[];
}): CodeReviewCampaignReceipt {
  const selectedFile = params.selectedFile.trim();
  const safeSelectedFile = SAFE_RELATIVE_FILE_PATTERN.test(selectedFile);
  const citedIssue = safeSelectedFile && params.result && !params.result._parseError
    ? params.result.issues.find((issue) => issue.file === selectedFile)
    : undefined;
  const hasAcceptedFinding = Boolean(citedIssue);
  const errorCode = safeFailureCode(
    params.result?._parseError?.code ??
      (params.error instanceof GroqClientError ? params.error.code : undefined),
  );

  return {
    kind: "code-review-provider-campaign-receipt",
    version: 1,
    scenario: params.scenario,
    provider: params.provider,
    operationId: safeIdentifier(params.operationId),
    projectId: safeIdentifier(params.projectId),
    projectRevision: safeIdentifier(params.projectRevision),
    outcomeClass: hasAcceptedFinding ? "fallback-success" : "terminal-incomplete",
    terminalStatus: hasAcceptedFinding ? "COMPLETE" : "INCOMPLETE",
    ...(errorCode ? { failureCode: errorCode } : {}),
    recoveryAction: recoveryActionFor(errorCode),
    attemptedModels: safeModels(params.attemptedModels),
    evidence: hasAcceptedFinding
      ? [{ file: selectedFile, findingHash: findingHash(citedIssue!) }]
      : [],
  };
}
