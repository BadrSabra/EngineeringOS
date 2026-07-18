/**
 * Scan Analyst — analyzes scan results, metrics, and graph data to produce
 * actionable engineering improvement suggestions.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
import { GroqClientError } from "../errors.js";
import type { ProjectContext } from "../context-builder.js";
import { buildScanAnalystSystemPrompt, buildScanAnalystUserPrompt } from "../prompts/scan.prompt.js";
import { ScanSummarySchema, type ScanAnalysisOutput, type ScanInsight } from "../schemas/scan.schema.js";
import { parseAgentResponse } from "../parsing.js";

export type { ScanInsight, ScanAnalysisOutput };

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
): Promise<ScanAnalysisOutput> {
  const messages: Message[] = [
    { role: "system", content: buildScanAnalystSystemPrompt() },
    { role: "user", content: buildScanAnalystUserPrompt(projectContext) },
  ];

  // G-18: single retry on transient Groq failures.
  let response: Awaited<ReturnType<typeof complete>>;
  try {
    response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
  } catch (err) {
    if (err instanceof GroqClientError && (err.code === "NON_200" || err.code === "TIMEOUT")) {
      console.warn(JSON.stringify({ scope: "scan-analyst", code: "MODEL_RETRY", originalError: err.code }));
      response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
    } else {
      throw err;
    }
  }

  const parsed = parseAgentResponse(response.content, ScanSummarySchema, fallbackScanAnalysis);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "scan-analyst", code: parsed.code, message: parsed.message }));
  }
  return parsed.data;
}
