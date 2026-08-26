/**
 * Code Reviewer — reviews code quality based on project context and metrics,
 * produces a structured quality report.
 */
import type { ProjectContext } from "../context-builder.js";
import { buildCodeReviewSystemPrompt, buildCodeReviewUserPrompt } from "../prompts/review.prompt.js";
import { CodeReviewResultSchema, type CodeReviewOutput, type CodeIssue } from "../schemas/code-review.schema.js";
import type { AgentCompleteOpts } from "../agent-complete.js";
import type { Message } from "../groq-client.js";
import { BaseAgent, type AgentRunResult } from "./base-agent.js";

export type { CodeIssue, CodeReviewOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with degraded fallback content.
 */
export type CodeReviewResult = AgentRunResult<CodeReviewOutput>;

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
): Promise<CodeReviewResult> {
  const result = await new CodeReviewAgent(fileContents).run(projectContext, opts);
  const selectedPaths = Object.keys(fileContents ?? {}).slice(0, 5);
  if (
    !result._parseError &&
    selectedPaths.length > 0 &&
    !result.issues.some((issue) => typeof issue.file === "string" && selectedPaths.includes(issue.file))
  ) {
    // A syntactically valid approval without a cited selected-file finding is
    // not trustworthy for file-gap analysis. Surface it as incomplete rather
    // than letting an empty issues array look like a verified review.
    return {
      ...result,
      _parseError: {
        code: "SCHEMA_VALIDATION_FAILED",
        message: "The review did not return a finding cited to a selected file.",
        raw: JSON.stringify(result),
      },
    };
  }
  return result;
}
