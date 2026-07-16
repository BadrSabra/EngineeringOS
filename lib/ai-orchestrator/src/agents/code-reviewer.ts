/**
 * Code Reviewer — reviews code quality based on project context and metrics,
 * produces a structured quality report.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildCodeReviewSystemPrompt, buildCodeReviewUserPrompt } from "../prompts/review.prompt.js";
import { CodeReviewResultSchema, type CodeReviewOutput, type CodeIssue } from "../schemas/code-review.schema.js";
import { parseAgentResponse } from "../parsing.js";

export type { CodeIssue, CodeReviewOutput };

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

export async function reviewCode(
  projectContext: ProjectContext,
  fileContents?: Record<string, string>,
  opts?: { apiKey?: string },
): Promise<CodeReviewOutput> {
  const messages: Message[] = [
    { role: "system", content: buildCodeReviewSystemPrompt() },
    { role: "user", content: buildCodeReviewUserPrompt(projectContext, fileContents) },
  ];

  const response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
  const parsed = parseAgentResponse(response.content, CodeReviewResultSchema, fallbackCodeReview);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "code-reviewer", code: parsed.code, message: parsed.message }));
  }
  return parsed.data;
}
