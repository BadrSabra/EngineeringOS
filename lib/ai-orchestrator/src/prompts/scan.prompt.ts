import type { ProjectContext } from "../context-builder.js";

export function buildScanAnalystSystemPrompt(): string {
  return `You are an expert engineering quality analyst for EngineeringOS.
Analyze the project data provided and produce actionable insights to improve code quality.

You must respond with valid JSON matching this schema:
{
  "summary": "2-3 sentence executive summary",
  "overallAssessment": "detailed overall assessment",
  "insights": [
    {
      "category": "architecture" | "security" | "performance" | "reliability" | "maintainability",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "short title",
      "description": "what the issue is",
      "recommendation": "what to do about it"
    }
  ],
  "topPriority": "the single most important thing to fix right now",
  "estimatedImpact": "what fixing the top priority would achieve"
}`;
}

export function buildScanAnalystUserPrompt(context: ProjectContext): string {
  return `Analyze this engineering project:

**Project:** ${context.project}

**Quality Metrics:** ${context.latestMetrics}

**Knowledge Graph:** ${context.graphSummary}

**Recent Tasks:**
${context.recentTasks}

**Recent Events:**
${context.recentEvents}

Produce a thorough analysis with specific, actionable insights ordered by importance.`;
}
