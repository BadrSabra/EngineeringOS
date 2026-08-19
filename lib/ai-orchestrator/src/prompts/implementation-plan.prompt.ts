import type { ProjectContext } from "../context-builder.js";
import {
  formatProjectFileManifest,
  formatProjectFileSources,
} from "../filesystem-manifest.js";

function bounded(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

export function buildImplementationPlanMessages(
  message: string,
  projectContext: ProjectContext,
): [
  { role: "system"; content: string },
  { role: "user"; content: string },
] {
  const project = bounded(projectContext.project, 3_000);
  const graph = bounded(projectContext.graphSummary, 7_000);
  const workflows = bounded(projectContext.workflows, 2_500);
  const filesystemManifest = bounded(formatProjectFileManifest(projectContext.filesystemManifest), 16_000);
  const filesystemSources = bounded(formatProjectFileSources(projectContext.filesystemSources), 42_000);

  return [
    {
      role: "system",
      content: `You are an implementation planning agent for EngineeringOS.

Produce ONLY valid JSON matching the requested schema. This is PLAN MODE:
- Do not propose autonomous edits, command execution, commits, or publishing.
- Do not claim that a file, test, dependency, or workflow exists unless it is
  visible in the supplied project context.
- Keep the plan concrete: each step must name project-relative files from the
  verified filesystem manifest and include a focused validation.
- If the filesystem manifest is UNAVAILABLE, do not invent file paths. Return
  one inspect step with an empty files array and explain that discovery is
  required before approval.
- If the manifest is truncated, stay within the retained inventory and state
  that limitation in assumptions or risks.
- If the context is insufficient, state the uncertainty in assumptions or risks
  instead of inventing details.
- A plan is considered source-grounded only when the verified source excerpts
  below contain relevant implementation evidence. If source excerpts are
  unavailable, return one inspect step with empty files.
- The plan must be safe to review and approve before any write access is granted.`,
    },
    {
      role: "user",
      content: `Create an implementation plan for this request:
${message}

Project context:
PROJECT:
${project}

KNOWLEDGE GRAPH:
${graph}

WORKFLOWS:
${workflows}

VERIFIED FILESYSTEM MANIFEST:
${filesystemManifest}

VERIFIED SOURCE EXCERPTS:
${filesystemSources}

Return exactly this JSON shape:
{
  "kind": "IMPLEMENTATION_PLAN_RESULT",
  "objective": "one sentence",
  "summary": "short implementation approach",
  "assumptions": [],
  "steps": [
    {
      "id": "step-1",
      "title": "short action",
      "description": "what will change and why",
      "action": "inspect",
      "files": ["project-relative/path"],
      "dependsOn": [],
      "validation": ["focused test or check"]
    }
  ],
  "validationCommands": [],
  "risks": [],
  "approvalStatus": "PENDING_APPROVAL",
  "writeAccess": "NOT_AUTHORIZED"
}`,
    },
  ];
}