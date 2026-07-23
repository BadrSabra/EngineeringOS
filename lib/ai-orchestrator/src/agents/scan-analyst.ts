/**
 * Scan Analyst — analyzes scan results, metrics, and graph data to produce
 * actionable engineering improvement suggestions.
 */
import { GroqClientError, type AgentErrorCode } from "../errors.js";
import type { Message } from "../groq-client.js";
import type { ProjectContext } from "../context-builder.js";
import { buildScanAnalystSystemPrompt, buildScanAnalystUserPrompt } from "../prompts/scan.prompt.js";
import { ScanSummarySchema, type ScanAnalysisOutput, type ScanInsight } from "../schemas/scan.schema.js";
import { parseAgentResponse } from "../parsing.js";
import { agentComplete, type AgentCompleteOpts } from "../agent-complete.js";

export type { ScanInsight, ScanAnalysisOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with degraded fallback content.
 */
export type ScanAnalysisResult = ScanAnalysisOutput & {
  _parseError?: { code: AgentErrorCode; message: string; raw: string };
};

function fallbackScanAnalysis(raw: string): ScanAnalysisOutput {
  return {
    summary: "Scan analysis completed",
    overallAssessment: raw.trim() || "The model did not return a structured assessment.",
    insights: [],
    topPriority: "Review the detailed analysis above",
    estimatedImpact: "Improved overall code quality",
  };
}

export async function analyzeScan(
  projectContext: ProjectContext,
  opts?: AgentCompleteOpts,
): Promise<ScanAnalysisResult> {
  const messages: Message[] = [
    { role: "system", content: buildScanAnalystSystemPrompt() },
    { role: "user", content: buildScanAnalystUserPrompt(projectContext) },
  ];

  // G-18: single retry on transient NON_200 failures.
  let response: { content: string };
  try {
    response = await agentComplete(messages, opts ?? {});
  } catch (err) {
    if (err instanceof GroqClientError && err.code === "NON_200") {
      console.warn(JSON.stringify({ scope: "scan-analyst", code: "MODEL_RETRY", originalError: err.code }));
      response = await agentComplete(messages, opts ?? {});
    } else {
      throw err;
    }
  }

  const parsed = parseAgentResponse(response.content, ScanSummarySchema, fallbackScanAnalysis);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "scan-analyst", code: parsed.code, message: parsed.message }));
    // PR-E: surface parse failure to the route so it can return 422 instead of
    // silently returning degraded fallback content as a 200.
    return { ...parsed.data, _parseError: { code: parsed.code, message: parsed.message, raw: parsed.raw } };
  }
  return parsed.data;
}
