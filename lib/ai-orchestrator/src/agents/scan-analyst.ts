/**
 * Scan Analyst — analyzes scan results, metrics, and graph data to produce
 * actionable engineering improvement suggestions.
 */
import type { ProjectContext } from "../context-builder.js";
import { buildScanAnalystSystemPrompt, buildScanAnalystUserPrompt } from "../prompts/scan.prompt.js";
import { ScanSummarySchema, type ScanAnalysisOutput, type ScanInsight } from "../schemas/scan.schema.js";
import type { AgentCompleteOpts } from "../agent-complete.js";
import type { Message } from "../groq-client.js";
import { BaseAgent, type AgentRunResult } from "./base-agent.js";

export type { ScanInsight, ScanAnalysisOutput };

/**
 * PR-E: Extended return type that carries an optional parse-failure marker.
 * When the model output cannot be parsed, the route surfaces `_parseError`
 * as HTTP 422 instead of a silent 200 with degraded fallback content.
 */
export type ScanAnalysisResult = AgentRunResult<ScanAnalysisOutput>;

function fallbackScanAnalysis(raw: string): ScanAnalysisOutput {
  return {
    summary: "Scan analysis completed",
    overallAssessment: raw.trim() || "The model did not return a structured assessment.",
    insights: [],
    topPriority: "Review the detailed analysis above",
    estimatedImpact: "Improved overall code quality",
  };
}

class ScanAnalystAgent extends BaseAgent<ProjectContext, ScanAnalysisOutput> {
  protected readonly scope = "scan-analyst";
  protected readonly schema = ScanSummarySchema;

  protected buildMessages(projectContext: ProjectContext): Message[] {
    return [
      { role: "system", content: buildScanAnalystSystemPrompt() },
      { role: "user", content: buildScanAnalystUserPrompt(projectContext) },
    ];
  }

  protected fallbackOutput(raw: string): ScanAnalysisOutput {
    return fallbackScanAnalysis(raw);
  }
}

const scanAnalystAgent = new ScanAnalystAgent();

export async function analyzeScan(
  projectContext: ProjectContext,
  opts?: AgentCompleteOpts,
): Promise<ScanAnalysisResult> {
  return scanAnalystAgent.run(projectContext, opts);
}
