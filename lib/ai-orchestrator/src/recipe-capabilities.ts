import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import {
  CapabilityRegistry,
  DEFAULT_CAPABILITY_POLICY,
  type CapabilityAdapter,
} from "./capability-contract.js";

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

export function createServerCapabilityRegistry(): CapabilityRegistry {
  return new CapabilityRegistry([READ_PROJECT_FILE_CAPABILITY]);
}