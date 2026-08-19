import type { ProjectContext } from "../context-builder.js";
import type { AgentCompleteOpts } from "../agent-complete.js";
import type { Message } from "../groq-client.js";
import { BaseAgent, type AgentRunResult } from "./base-agent.js";
import {
  ImplementationPlanSchema,
  type ImplementationPlan,
} from "../schemas/implementation-plan.schema.js";
import { buildImplementationPlanMessages } from "../prompts/implementation-plan.prompt.js";
import type { ProjectFileManifest } from "../filesystem-manifest.js";

export type ImplementationPlanInput = {
  message: string;
  projectContext: ProjectContext;
};

export type ImplementationPlanResult = AgentRunResult<ImplementationPlan>;

function fallbackPlan(message: string, reason = "The available project context was insufficient for a verified file-level plan."): ImplementationPlan {
  return {
    kind: "IMPLEMENTATION_PLAN_RESULT",
    objective: message.trim().slice(0, 500) || "Define the requested implementation",
    summary: "A safe implementation plan could not be structured by the provider. Review the request and retry before granting write access.",
    assumptions: [reason],
    steps: [
      {
        id: "step-1",
        title: "Inspect the requested area",
        description: "Identify the relevant source files and current behavior before proposing changes.",
        action: "inspect",
        files: [],
        dependsOn: [],
        validation: ["Confirm the target files and current behavior from the workspace."],
      },
    ],
    validationCommands: [],
    risks: ["No file-level changes are authorized until the project files are verified."],
    approvalStatus: "PENDING_APPROVAL",
    writeAccess: "NOT_AUTHORIZED",
  };
}

function normalizePlanPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isGroundedPlanPath(
  value: string,
  action: ImplementationPlan["steps"][number]["action"],
  manifest: ProjectFileManifest,
): boolean {
  const normalized = normalizePlanPath(value);
  const knownFiles = new Set(manifest.files.map(normalizePlanPath));
  const knownDirectories = new Set(manifest.directories.map(normalizePlanPath));
  if (knownFiles.has(normalized) || knownDirectories.has(normalized)) return true;
  if (action !== "create") return false;

  const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  return parent === "" || knownDirectories.has(parent);
}

function guardPlanPaths(plan: ImplementationPlan, manifest: ProjectFileManifest): string[] {
  return plan.steps.flatMap((step) =>
    step.files
      .filter((file) => !isGroundedPlanPath(file, step.action, manifest))
      .map((file) => `${step.id}: ${file}`),
  );
}

class ImplementationPlannerAgent extends BaseAgent<ImplementationPlanInput, ImplementationPlan> {
  protected readonly scope = "implementation-plan";
  protected readonly schema = ImplementationPlanSchema;

  protected buildQualityProfile(): "analysis" {
    return "analysis";
  }

  protected buildMessages(input: ImplementationPlanInput): Message[] {
    return buildImplementationPlanMessages(input.message, input.projectContext);
  }

  protected fallbackOutput(raw: string): ImplementationPlan {
    return fallbackPlan(raw);
  }
}

const implementationPlanner = new ImplementationPlannerAgent();

export async function createImplementationPlan(
  input: ImplementationPlanInput,
  opts?: AgentCompleteOpts,
): Promise<ImplementationPlanResult> {
  const manifest = input.projectContext.filesystemManifest;
  if (!manifest || manifest.status !== "VERIFIED" || (manifest.files.length === 0 && manifest.directories.length === 0)) {
    return fallbackPlan(
      input.message,
      manifest?.reason ?? "No verified project filesystem manifest was available; discover files before approving a plan.",
    );
  }
  const sources = input.projectContext.filesystemSources;
  if (!sources || sources.status !== "VERIFIED" || sources.files.length === 0) {
    return fallbackPlan(
      input.message,
      sources?.reason ?? "No verified source excerpts were read; discover source files before approving a file-grounded plan.",
    );
  }

  const result = await implementationPlanner.run(input, opts);
  const { _parseError, ...plan } = result;
  const ungroundedPaths = guardPlanPaths(plan, manifest);
  if (ungroundedPaths.length === 0) return result;

  const guarded = fallbackPlan(
    input.message,
    `The provider referenced unverified project paths: ${ungroundedPaths.slice(0, 8).join(", ")}.`,
  );
  return _parseError ? { ...guarded, _parseError } : guarded;
}

export function renderImplementationPlan(plan: ImplementationPlan): string {
  const lines = [
    `## Implementation plan`,
    `**Objective:** ${plan.objective}`,
    "",
    plan.summary,
    "",
    `**Approval:** pending approval · write access not authorized`,
    "",
    "### Steps",
    ...plan.steps.map(
      (step, index) =>
        `${index + 1}. **${step.title}** — ${step.description}\n   - Action: ${step.action}\n   - Files: ${step.files.length > 0 ? step.files.join(", ") : "to be confirmed during inspection"}\n   - Validation: ${step.validation.join("; ") || "to be defined"}`,
    ),
  ];

  if (plan.risks.length > 0) {
    lines.push("", "### Risks", ...plan.risks.map((risk) => `- ${risk}`));
  }

  return lines.join("\n");
}