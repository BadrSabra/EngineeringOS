/**
 * Scan Analyst — analyzes scan results, metrics, and graph data to produce
 * actionable engineering improvement suggestions.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
import { GroqClientError, type AgentErrorCode } from "../errors.js";
import type { ProjectContext } from "../context-builder.js";
import { buildScanAnalystSystemPrompt, buildScanAnalystUserPrompt } from "../prompts/scan.prompt.js";
import { ScanSummarySchema, type ScanAnalysisOutput, type ScanInsight } from "../schemas/scan.schema.js";
import { parseAgentResponse } from "../parsing.js";

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
  opts?: { apiKey?: string },
): Promise<ScanAnalysisResult> {
  const messages: Message[] = [
    { role: "system", content: buildScanAnalystSystemPrompt() },
    { role: "user", content: buildScanAnalystUserPrompt(projectContext) },
  ];

  // G-18: single retry on transient Groq failures.
  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
  } catch (err) {
    // Retry only NON_200 — TIMEOUT/NETWORK_ERROR/RATE_LIMITED/SERVER_ERROR
    // are already retried 3× by the base completeRaw() client.
    if (err instanceof GroqClientError && err.code === "NON_200") {
      console.warn(JSON.stringify({ scope: "scan-analyst", code: "MODEL_RETRY", originalError: err.code }));
      response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
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
