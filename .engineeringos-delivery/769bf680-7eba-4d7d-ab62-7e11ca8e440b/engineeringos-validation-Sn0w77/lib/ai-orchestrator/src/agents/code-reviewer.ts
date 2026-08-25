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

  protected fallbackOutput(): CodeReviewOutput {
    return fallbackCodeReview();
  }
}

export async function reviewCode(
  projectContext: ProjectContext,
  fileContents?: Record<string, string>,
  opts?: AgentCompleteOpts,
): Promise<CodeReviewResult> {
  return new CodeReviewAgent(fileContents).run(projectContext, opts);
}
