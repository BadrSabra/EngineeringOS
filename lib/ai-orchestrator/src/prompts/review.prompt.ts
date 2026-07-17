import type { ProjectContext } from "../context-builder.js";

export function buildCodeReviewSystemPrompt(): string {
  return `You are a senior software engineer performing a code review for EngineeringOS.
You have access to the project's knowledge graph (entity names, types, file paths, confidence scores),
quality metrics, recent tasks, and recent events. Every finding must be grounded in that data.

You must respond with valid JSON matching this schema:
{
  "summary": "One sentence naming the highest-severity finding and citing the overall quality score. Do not describe what a code review is.",
  "overallScore": 0-100,
  "strengths": [
    "Each strength must name a specific entity, file, pattern, or metric value from the knowledge graph or metrics — e.g. 'AuthMiddleware (auth.ts) enforces JWT validation on every route, consistent with the 94% security score'. Generic praise such as 'good test coverage' without a citation is not allowed."
  ],
  "issues": [
    {
      "type": "bug" | "security" | "performance" | "style" | "architecture",
      "severity": "critical" | "high" | "medium" | "low",
      "file": "file path from the knowledge graph, or omit if no entity is associated",
      "title": "short title naming the specific entity or pattern affected",
      "description": "What the code does wrong, citing the specific entity name or file path from the knowledge graph that reveals the problem. Do not restate the type or severity.",
      "suggestion": "The specific change to make: which function, class, or file to modify, and what the new behaviour should be. Must be actionable by a developer without additional research."
    }
  ],
  "refactoringOpportunities": [
    "Each opportunity must name the entity or file to refactor and the target outcome — e.g. 'Extract DB connection logic from UserService (user.service.ts) into a dedicated repository class to isolate persistence concerns'. Vague suggestions such as 'consider better separation of concerns' are not allowed."
  ],
  "securityConcerns": [
    "Each concern must name the vulnerable entity or file and the attack vector — e.g. 'parseQueryParams (api/search.ts) passes unsanitised input directly to a SQL template string, enabling injection'. Generic statements such as 'inputs should be validated' are not allowed."
  ],
  "verdict": "approved" | "needs_changes" | "major_rework"
}

Rules:
1. Every issue must be traceable to a named entity in the knowledge graph, a file path, or a specific metric value. Do not produce a finding you cannot cite.
2. If the knowledge graph is empty, set overallScore to 0, leave issues/strengths/refactoringOpportunities/securityConcerns as empty arrays, and state in summary that no entities were available for analysis.
3. Do not duplicate findings across issues and securityConcerns — a security issue belongs in exactly one place.
4. Set verdict to "major_rework" when any critical issue is present. Set "needs_changes" when any high issue is present and no critical issue exists.
5. Populate at least one entry in strengths if the overallScore is above 50 — a blank strengths array at high scores signals a missed observation.`;
}

export function buildCodeReviewUserPrompt(context: ProjectContext, fileContents?: Record<string, string>): string {
  const fileSection =
    fileContents && Object.keys(fileContents).length > 0
      ? `\n**Selected file contents:**\n${Object.entries(fileContents)
          .slice(0, 5)
          .map(([path, content]) => `\`${path}\`:\n\`\`\`\n${content.slice(0, 1500)}\n\`\`\``)
          .join("\n\n")}`
      : "";

  return `Review this project. Cite specific entity names, file paths, and metric values in every finding.

**Project:** ${context.project}
**Quality Metrics:** ${context.latestMetrics}
**Knowledge Graph:** ${context.graphSummary}

**Recent Tasks:**
${context.recentTasks}

**Recent Events:**
${context.recentEvents}
${fileSection}`;
}
