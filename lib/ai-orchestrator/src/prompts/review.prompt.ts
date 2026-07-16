import type { ProjectContext } from "../context-builder.js";

export function buildCodeReviewSystemPrompt(): string {
  return `You are a senior software engineer performing a code review for EngineeringOS.
Provide a thorough, constructive review based on the project data.

You must respond with valid JSON matching this schema:
{
  "summary": "2-3 sentence executive summary",
  "overallScore": 0-100,
  "strengths": ["strength 1", ...],
  "issues": [
    {
      "type": "bug" | "security" | "performance" | "style" | "architecture",
      "severity": "critical" | "high" | "medium" | "low",
      "file": "optional file path",
      "title": "short title",
      "description": "what the issue is",
      "suggestion": "how to fix it"
    }
  ],
  "refactoringOpportunities": ["opportunity 1", ...],
  "securityConcerns": ["concern 1", ...],
  "verdict": "approved" | "needs_changes" | "major_rework"
}`;
}

export function buildCodeReviewUserPrompt(context: ProjectContext, fileContents?: Record<string, string>): string {
  const fileSection =
    fileContents && Object.keys(fileContents).length > 0
      ? `\n**Selected file contents:**\n${Object.entries(fileContents)
          .slice(0, 5)
          .map(([path, content]) => `\`${path}\`:\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``)
          .join("\n\n")}`
      : "";

  return `Review this project:

**Project:** ${context.project}
**Quality Metrics:** ${context.latestMetrics}
**Knowledge Graph:** ${context.graphSummary}

**Recent Activity:**
Tasks:
${context.recentTasks}

Events:
${context.recentEvents}
${fileSection}

Provide a thorough code review with specific, actionable feedback.`;
}
