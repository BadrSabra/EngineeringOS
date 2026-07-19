/**
 * Code Reviewer — reviews code quality based on project context and metrics,
 * produces a structured quality report.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
import { GroqClientError, type AgentErrorCode } from "../errors.js";
import type { ProjectContext } from "../context-builder.js";
import { buildCodeReviewSystemPrompt, buildCodeReviewUserPrompt } from "../prompts/review.prompt.js";
import { CodeReviewResultSchema, type CodeReviewOutput, type CodeIssue } from "../schemas/code-review.schema.js";
import { parseAgentResponse } from "../parsing.js";

export type { CodeIssue, CodeReviewOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with degraded fallback content.
 */
export type CodeReviewResult = CodeReviewOutput & {
  _parseError?: { code: AgentErrorCode; message: string; raw: string };
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

export async function reviewCode(
  projectContext: ProjectContext,
  fileContents?: Record<string, string>,
  opts?: { apiKey?: string },
): Promise<CodeReviewResult> {
  const messages: Message[] = [
    { role: "system", content: buildCodeReviewSystemPrompt() },
    { role: "user", content: buildCodeReviewUserPrompt(projectContext, fileContents) },
  ];

  // G-18: single retry on transient Groq failures.
  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
  } catch (err) {
    // Retry only NON_200 — TIMEOUT/NETWORK_ERROR/RATE_LIMITED/SERVER_ERROR
    // are already retried 3× by the base completeRaw() client.
    if (err instanceof GroqClientError && err.code === "NON_200") {
      console.warn(JSON.stringify({ scope: "code-reviewer", code: "MODEL_RETRY", originalError: err.code }));
      response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
    } else {
      throw err;
    }
  }

  const parsed = parseAgentResponse(response.content, CodeReviewResultSchema, fallbackCodeReview);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "code-reviewer", code: parsed.code, message: parsed.message }));
    // PR-E: surface parse failure to the route so it can return 422 instead of
    // silently returning degraded fallback content as a 200.
    return { ...parsed.data, _parseError: { code: parsed.code, message: parsed.message, raw: parsed.raw } };
  }
  return parsed.data;
}
