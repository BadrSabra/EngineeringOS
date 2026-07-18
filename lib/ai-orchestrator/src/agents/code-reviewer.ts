/**
 * Code Reviewer — reviews code quality based on project context and metrics,
 * produces a structured quality report.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
import { GroqClientError } from "../errors.js";
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

  // G-18: single retry on transient Groq failures.
  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
  } catch (err) {
    if (err instanceof GroqClientError && (err.code === "NON_200" || err.code === "TIMEOUT")) {
      console.warn(JSON.stringify({ scope: "code-reviewer", code: "MODEL_RETRY", originalError: err.code }));
      response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
    } else {
      throw err;
    }
  }

  const parsed = parseAgentResponse(response.content, CodeReviewResultSchema, fallbackCodeReview);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "code-reviewer", code: parsed.code, message: parsed.message }));
  }
  return parsed.data;
}
