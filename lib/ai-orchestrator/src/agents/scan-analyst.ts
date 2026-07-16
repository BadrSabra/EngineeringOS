/**
 * Scan Analyst — analyzes scan results, metrics, and graph data to produce
 * actionable engineering improvement suggestions.
 */
import { complete, MODEL_POWERFUL, type Message } from "../groq-client.js";
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

  const response = await complete(messages, { model: MODEL_POWERFUL, apiKey: opts?.apiKey });
  const parsed = parseAgentResponse(response.content, ScanSummarySchema, fallbackScanAnalysis);
  if (!parsed.ok) {
    console.warn(JSON.stringify({ scope: "scan-analyst", code: parsed.code, message: parsed.message }));
  }
  return parsed.data;
}
