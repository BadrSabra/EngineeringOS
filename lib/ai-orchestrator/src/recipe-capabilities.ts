import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import {
  CapabilityRegistry,
  DEFAULT_CAPABILITY_POLICY,
  type CapabilityAdapter,
} from "./capability-contract.js";
import type {
  BrowserValidationRunner,
  CommandProfile,
  CommandRunner,
  ValidationRunner,
} from "./tools/execution-tools.js";
import type { ValidationProfile } from "./schemas/chat.schema.js";

const ReadProjectFileInputSchema = z.object({
  path: z.string().min(1).max(240).regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/),
}).strict();

const ReadProjectFileOutputSchema = z.object({
  path: z.string().min(1).max(240),
  content: z.string().max(200_000),
}).strict();

/**
 * The recipe registry intentionally exposes one read-only capability. The
 * recipe supplies only the business path; the execution root and all resource
 * controls come from the server-owned context and policy.
 */
export const READ_PROJECT_FILE_CAPABILITY: CapabilityAdapter<
  z.infer<typeof ReadProjectFileInputSchema>,
  z.infer<typeof ReadProjectFileOutputSchema>
> = {
  contractVersion: 1,
  id: "project.read_file",
  supportedRecipeVersions: [1] as const,
  policy: { ...DEFAULT_CAPABILITY_POLICY, maxInputBytes: 2_048, maxOutputBytes: 200_000 },
  catalog: {
    purpose: "Read one text file from the established project root.",
    inputShape: {
      type: "object",
      fields: [{ name: "path", type: "string", required: true, description: "Project-relative file path." }],
    },
    defaultScope: "file",
    supportedScopes: ["file"],
    estimatedCost: "low",
    mutatesProject: false,
    keywords: ["read", "file", "inspect"],
    allowedPhases: ["analysis", "evidence"],
    projectIds: [],
    requiresAuthorization: false,
    expectedEvidence: ["file_read"],
  },
  inputSchema: ReadProjectFileInputSchema,
  outputSchema: ReadProjectFileOutputSchema,
  execute: async (input, context) => {
    const root = resolve(context.rootPath);
    const target = resolve(root, input.path);
    const relativeTarget = relative(root, target);
    if (!relativeTarget || isAbsolute(relativeTarget) || relativeTarget.startsWith(`..${"/"}`)) {
      throw new Error("Requested file is outside the established project root.");
    }
    const content = await readFile(target, "utf8");
    return { path: relativeTarget.replaceAll("\\", "/"), content: content.slice(0, 200_000) };
  },
};

const VALIDATION_PROFILES: readonly ValidationProfile[] = [
  "ai-orchestrator-tests",
  "knowledge-engine-tests",
  "api-ai-tests",
  "workspace-typecheck",
];

const ValidationOutputSchema = z.object({
  status: z.string().min(1).max(40),
  profile: z.string().min(1).max(120),
  evidence: z.record(z.unknown()).optional(),
  detail: z.string().max(4_000).optional(),
}).passthrough();

const TargetPathsSchema = z.object({
  targetPaths: z.array(z.string().min(1).max(500)).max(48),
}).strict();

export type RecipeCapabilityRuntime = {
  validationRunner?: ValidationRunner;
  browserValidationRunner?: BrowserValidationRunner;
  commandRunner?: CommandRunner;
  commandProfiles?: readonly CommandProfile[];
  browserProfiles?: readonly string[];
  /**
   * Server-owned external delivery adapter. The model can provide only the
   * business message; project, operation, proposal, credentials, and remote
   * controls stay inside the API-side callback.
   */
  githubDeliveryRunner?: GitHubDeliveryRunner;
};

export type GitHubDeliveryRunner = (args: {
  rootPath: string;
  projectId: string;
  operationId: string;
  message: string;
  signal?: AbortSignal;
}) => Promise<{
  status: "passed" | "blocked" | "unavailable";
  evidence?: {
    evidenceId: string;
    resultHash?: string;
    artifactRef?: string;
  };
  detail?: string;
  remoteCommitHash?: string;
  idempotent?: boolean;
}>;

function validationCapability(
  profile: ValidationProfile,
  runtime: RecipeCapabilityRuntime,
): CapabilityAdapter {
  return {
    contractVersion: 1,
    id: `validation.run.${profile}`,
    supportedRecipeVersions: [1] as const,
    policy: { ...DEFAULT_CAPABILITY_POLICY, maxOutputBytes: 256_000 },
    catalog: {
      purpose: `Run the server-registered ${profile} validation profile.`,
      inputShape: {
        type: "object",
        fields: [{ name: "targetPaths", type: "array", required: true, description: "Approved project-relative validation targets." }],
      },
      defaultScope: "paths",
      supportedScopes: ["paths", "project"],
      estimatedCost: "high",
      mutatesProject: false,
      keywords: ["validation", "test", profile],
      allowedPhases: ["validation", "recovery"],
      projectIds: [],
      requiresAuthorization: true,
      expectedEvidence: ["validation_passed"],
    },
    inputSchema: TargetPathsSchema,
    outputSchema: ValidationOutputSchema,
    execute: async (input, context) => {
      const parsedInput = TargetPathsSchema.parse(input);
      if (!runtime.validationRunner) {
        return { status: "unavailable", profile, detail: "Validation runner is not enabled for this operation." };
      }
      const result = await runtime.validationRunner(profile, parsedInput.targetPaths, context.signal);
      return {
        status: result.status,
        profile,
        detail: result.detail?.slice(0, 4_000),
        ...("evidence" in result && result.evidence ? { evidence: result.evidence } : {}),
      };
    },
  };
}

function browserCapability(profile: string, runtime: RecipeCapabilityRuntime): CapabilityAdapter {
  return {
    contractVersion: 1,
    id: `browser.verify.${profile}`,
    supportedRecipeVersions: [1] as const,
    policy: { ...DEFAULT_CAPABILITY_POLICY, maxOutputBytes: 256_000 },
    catalog: {
      purpose: `Run the server-registered ${profile} browser verification profile.`,
      inputShape: {
        type: "object",
        fields: [{ name: "targetPaths", type: "array", required: true, description: "Approved project-relative browser targets." }],
      },
      defaultScope: "workspace",
      supportedScopes: ["workspace", "paths"],
      estimatedCost: "high",
      mutatesProject: false,
      keywords: ["browser", "verification", profile],
      allowedPhases: ["validation"],
      projectIds: [],
      requiresAuthorization: true,
      expectedEvidence: ["browser_verified"],
    },
    inputSchema: TargetPathsSchema,
    outputSchema: ValidationOutputSchema,
    execute: async (input, context) => {
      if (!runtime.browserValidationRunner) {
        return { status: "unavailable", profile, detail: "Browser validation runner is not enabled for this operation." };
      }
      const result = await runtime.browserValidationRunner({
        profile,
        rootPath: context.rootPath,
        operationId: context.operation,
        revision: context.revision,
        signal: context.signal,
      });
      return {
        status: result.status,
        profile,
        detail: result.detail?.slice(0, 4_000),
        evidence: result.evidence,
      };
    },
  };
}

function commandCapability(profile: CommandProfile, runtime: RecipeCapabilityRuntime): CapabilityAdapter {
  return {
    contractVersion: 1,
    id: `command.run.${profile.name}`,
    supportedRecipeVersions: [1] as const,
    policy: { ...DEFAULT_CAPABILITY_POLICY, maxOutputBytes: profile.maxOutputBytes },
    catalog: {
      purpose: `Run the server-registered ${profile.name} command profile.`,
      inputShape: {
        type: "object",
        fields: [{ name: "targetPaths", type: "array", required: true, description: "Approved project-relative command targets." }],
      },
      defaultScope: "paths",
      supportedScopes: ["paths", "project"],
      estimatedCost: "high",
      mutatesProject: false,
      keywords: ["command", profile.name],
      allowedPhases: ["validation", "recovery"],
      projectIds: [],
      requiresAuthorization: true,
      expectedEvidence: ["command_result"],
    },
    inputSchema: TargetPathsSchema,
    outputSchema: z.object({
      status: z.string().min(1).max(40),
      profile: z.string().min(1).max(120),
      exitCode: z.number().int().nullable().optional(),
      detail: z.string().max(4_000).optional(),
    }).passthrough(),
    execute: async (input, context) => {
      const parsedInput = TargetPathsSchema.parse(input);
      if (!runtime.commandRunner) {
        return { status: "unavailable", profile: profile.name, detail: "Command runner is not enabled for this operation." };
      }
      const result = await runtime.commandRunner({
        profile,
        rootPath: context.rootPath,
        signal: context.signal,
        operationId: context.operation,
        targetPaths: parsedInput.targetPaths,
      });
      return {
        status: result.status,
        profile: profile.name,
        exitCode: result.exitCode,
        detail: result.status === "passed" ? "Registered command completed successfully." : "Registered command failed.",
      };
    },
  };
}

function githubDeliveryCapability(runtime: RecipeCapabilityRuntime): CapabilityAdapter | undefined {
  if (!runtime.githubDeliveryRunner) return undefined;
  const inputSchema = z.object({
    message: z.string().min(1).max(240),
  }).strict();
  return {
    contractVersion: 1,
    id: "github.push_verified_commit",
    supportedRecipeVersions: [1] as const,
    policy: {
      ...DEFAULT_CAPABILITY_POLICY,
      risk: "critical",
      requiresApproval: true,
      maxInputBytes: 4_096,
      maxOutputBytes: 32_768,
    },
    catalog: {
      purpose: "Push the server-approved verified delivery through the GitHub integration.",
      inputShape: {
        type: "object",
        fields: [{ name: "message", type: "string", required: true, description: "Business commit message for the verified delivery." }],
      },
      defaultScope: "none",
      supportedScopes: ["none"],
      estimatedCost: "high",
      mutatesProject: false,
      mutatesExternal: true,
      keywords: ["github", "push", "delivery"],
      allowedPhases: ["delivery"],
      projectIds: [],
      requiresAuthorization: true,
      expectedEvidence: ["integration_verified"],
    },
    inputSchema,
    outputSchema: z.object({
      status: z.enum(["passed", "blocked", "unavailable"]),
      evidence: z.object({
        evidenceId: z.string().min(1).max(240),
        resultHash: z.string().max(128).optional(),
        artifactRef: z.string().max(240).optional(),
      }).optional(),
      detail: z.string().max(4_000).optional(),
      remoteCommitHash: z.string().max(160).optional(),
      idempotent: z.boolean().optional(),
    }).strict(),
    execute: async (input, context) => {
      const parsedInput = inputSchema.parse(input);
      if (!context.projectId || !context.operationId) {
        return {
          status: "blocked",
          detail: "A durable project and operation identity are required for external delivery.",
        };
      }
      return runtime.githubDeliveryRunner!({
        rootPath: context.rootPath,
        projectId: context.projectId,
        operationId: context.operationId,
        message: parsedInput.message,
        signal: context.signal,
      });
    },
  };
}

export function createServerCapabilityRegistry(runtime: RecipeCapabilityRuntime = {}): CapabilityRegistry {
  const githubCapability = githubDeliveryCapability(runtime);
  const adapters: CapabilityAdapter[] = [
    READ_PROJECT_FILE_CAPABILITY,
    ...VALIDATION_PROFILES.map((profile) => validationCapability(profile, runtime)),
    ...(runtime.browserProfiles ?? []).map((profile) => browserCapability(profile, runtime)),
    ...(runtime.commandProfiles ?? []).map((profile) => commandCapability(profile, runtime)),
    ...(githubCapability ? [githubCapability] : []),
  ];
  return new CapabilityRegistry(adapters);
}