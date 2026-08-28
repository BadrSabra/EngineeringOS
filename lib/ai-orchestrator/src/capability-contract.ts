import { z } from "zod";

/**
 * The capability contract is intentionally independent from provider/tool
 * prompts. A model may name a capability and provide business input, but it
 * cannot provide an executable command, profile, path, or process settings.
 */
export const CAPABILITY_CONTRACT_VERSION = 1 as const;
export const SUPPORTED_RECIPE_VERSIONS = [1] as const;

export const CapabilityIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "capability IDs must be opaque safe identifiers");
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const RecipeVersionSchema = z.number().int().min(1).max(100);
export type RecipeVersion = z.infer<typeof RecipeVersionSchema>;

export const CapabilityRiskSchema = z.enum(["low", "medium", "high", "critical"]);
export type CapabilityRisk = z.infer<typeof CapabilityRiskSchema>;

/**
 * Catalog metadata is deliberately a small, descriptive projection. It is
 * not an execution recipe: command names, argv, cwd, environment, profiles,
 * and process limits are not representable here.
 */
const CATALOG_RESERVED_INPUT_NAMES = new Set([
  "args",
  "argv",
  "command",
  "commandline",
  "commandtext",
  "cwd",
  "env",
  "environment",
  "executable",
  "executablepath",
  "profile",
  "shell",
  "shellcommand",
  "workdir",
  "workingdir",
  "workingdirectory",
]);

export const CapabilityScopeKindSchema = z.enum([
  "none",
  "project",
  "paths",
  "file",
  "workspace",
]);
export type CapabilityScopeKind = z.infer<typeof CapabilityScopeKindSchema>;

export const CapabilityCostSchema = z.enum(["low", "medium", "high"]);
export type CapabilityCost = z.infer<typeof CapabilityCostSchema>;

export const CapabilityInputFieldSchema = z
  .object({
    name: z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    type: z.enum(["string", "number", "boolean", "object", "array"]),
    required: z.boolean(),
    description: z.string().min(1).max(180),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (CATALOG_RESERVED_INPUT_NAMES.has(field.name.replace(/[_-]/g, "").toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "catalog input fields cannot contain server-owned execution controls",
      });
    }
  });
export type CapabilityInputField = z.infer<typeof CapabilityInputFieldSchema>;

export const CapabilityInputShapeSchema = z
  .object({
    type: z.literal("object"),
    fields: z.array(CapabilityInputFieldSchema).max(24),
  })
  .strict();
export type CapabilityInputShape = z.infer<typeof CapabilityInputShapeSchema>;

export const CapabilityCatalogMetadataSchema = z
  .object({
    purpose: z.string().min(1).max(240),
    inputShape: CapabilityInputShapeSchema,
    defaultScope: CapabilityScopeKindSchema,
    supportedScopes: z.array(CapabilityScopeKindSchema).min(1).max(5),
    estimatedCost: CapabilityCostSchema,
    mutatesProject: z.boolean(),
    keywords: z.array(z.string().min(1).max(40)).max(16),
    allowedPhases: z.array(z.string().min(1).max(40)).max(8),
    /** Empty means all projects; values are never emitted in catalog output. */
    projectIds: z.array(z.string().min(1).max(160)).max(64),
    requiresAuthorization: z.boolean(),
    expectedEvidence: z.array(z.string().min(1).max(160)).max(5),
  })
  .strict()
  .superRefine((metadata, ctx) => {
    if (new Set(metadata.supportedScopes).size !== metadata.supportedScopes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedScopes"],
        message: "supported scopes must be unique",
      });
    }
    if (!metadata.supportedScopes.includes(metadata.defaultScope)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultScope"],
        message: "the default scope must be supported",
      });
    }
    if (new Set(metadata.allowedPhases).size !== metadata.allowedPhases.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedPhases"],
        message: "allowed phases must be unique",
      });
    }
    if (new Set(metadata.projectIds).size !== metadata.projectIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectIds"],
        message: "project IDs must be unique",
      });
    }
    if (new Set(metadata.inputShape.fields.map((field) => field.name)).size !== metadata.inputShape.fields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputShape", "fields"],
        message: "input field names must be unique",
      });
    }
  });
export type CapabilityCatalogMetadata = z.infer<typeof CapabilityCatalogMetadataSchema>;

export const CapabilityPolicySchema = z
  .object({
    risk: CapabilityRiskSchema,
    requiresApproval: z.boolean(),
    allowedOperations: z.array(z.string().min(1).max(80)).max(32),
    /**
     * These profiles are part of the server-owned registration. They are not
     * accepted from capability input and are checked against invocation
     * context before an adapter can run.
     */
    approvedCommandProfiles: z.array(z.string().min(1).max(120)).max(32),
    maxInputBytes: z.number().int().min(1).max(1024 * 1024),
    maxOutputBytes: z.number().int().min(1).max(8 * 1024 * 1024),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (new Set(policy.allowedOperations).size !== policy.allowedOperations.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedOperations"],
        message: "allowed operations must be unique",
      });
    }
    if (new Set(policy.approvedCommandProfiles).size !== policy.approvedCommandProfiles.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedCommandProfiles"],
        message: "approved command profiles must be unique",
      });
    }
  });
export type CapabilityPolicy = z.infer<typeof CapabilityPolicySchema>;

export const CapabilityDescriptorSchema = z
  .object({
    contractVersion: z.literal(CAPABILITY_CONTRACT_VERSION),
    id: CapabilityIdSchema,
    supportedRecipeVersions: z.array(RecipeVersionSchema).min(1).max(32),
    policy: CapabilityPolicySchema,
    catalog: CapabilityCatalogMetadataSchema.optional(),
  })
  .strict()
  .superRefine((descriptor, ctx) => {
    if (new Set(descriptor.supportedRecipeVersions).size !== descriptor.supportedRecipeVersions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedRecipeVersions"],
        message: "supported recipe versions must be unique",
      });
    }
    if (descriptor.supportedRecipeVersions.some(
      (version) => !(SUPPORTED_RECIPE_VERSIONS as readonly number[]).includes(version),
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supportedRecipeVersions"],
        message: "registration includes a recipe version unsupported by this contract",
      });
    }
  });
export type CapabilityDescriptor = z.infer<typeof CapabilityDescriptorSchema>;

/**
 * This is the serializable portion of a registration. The implementation is
 * deliberately kept out of the public contract schema.
 */
export const CapabilityRegistrationSchema = CapabilityDescriptorSchema;
export type CapabilityRegistration = CapabilityDescriptor;

/**
 * Names that could turn model-controlled input into process controls. The
 * check is recursive so a dangerous control cannot hide in a nested object.
 */
const RESERVED_INPUT_KEYS = new Set([
  "args",
  "argv",
  "command",
  "commandline",
  "commandtext",
  "cwd",
  "env",
  "environment",
  "executable",
  "executablepath",
  "environmentoverrides",
  "envoverrides",
  "profile",
  "shell",
  "shellcommand",
  "workdir",
  "workingdir",
  "workingdirectory",
]);

export const CAPABILITY_INPUT_LIMITS = {
  maxDepth: 12,
  maxKeys: 256,
} as const;

export type CapabilityExecutionContext = {
  /** Server-established project root; it is never read from capability input. */
  rootPath: string;
  /** Server-established operation name used for policy authorization. */
  operation: string;
  /** Server-owned approved profile set, if the capability uses profiles. */
  approvedCommandProfiles?: ReadonlySet<string>;
  /** Server-owned approval state; model output cannot satisfy this gate. */
  approvalState?: "APPROVED" | "PENDING_APPROVAL" | "REJECTED";
  signal?: AbortSignal;
};

export type CapabilityAdapter<Input = unknown, Output = unknown> = CapabilityRegistration & {
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  execute: (input: Input, context: CapabilityExecutionContext) => Promise<Output> | Output;
};

export type CapabilityFailureCode =
  | "CAPABILITY_CONTRACT_INVALID"
  | "CAPABILITY_DUPLICATE_ID"
  | "CAPABILITY_UNKNOWN_ID"
  | "CAPABILITY_RECIPE_VERSION_UNSUPPORTED"
  | "CAPABILITY_OPERATION_NOT_ALLOWED"
  | "CAPABILITY_PROFILE_NOT_APPROVED"
  | "CAPABILITY_APPROVAL_REQUIRED"
  | "CAPABILITY_INPUT_INVALID"
  | "CAPABILITY_INPUT_TOO_LARGE"
  | "CAPABILITY_OUTPUT_INVALID"
  | "CAPABILITY_OUTPUT_TOO_LARGE"
  | "CAPABILITY_EXECUTION_FAILED";

export type CapabilityFailure = {
  ok: false;
  capabilityId: string;
  recipeVersion: number;
  code: CapabilityFailureCode;
  detail: string;
};

export type CapabilityValidation<Input = unknown> =
  | { ok: true; capability: CapabilityAdapter<Input>; input: Input }
  | CapabilityFailure;

export type CapabilityInvocationResult<Output = unknown> =
  | {
      ok: true;
      capabilityId: CapabilityId;
      recipeVersion: RecipeVersion;
      output: Output;
    }
  | CapabilityFailure;

function failure(
  capabilityId: string,
  recipeVersion: number,
  code: CapabilityFailureCode,
  detail: string,
): CapabilityFailure {
  return { ok: false, capabilityId, recipeVersion, code, detail };
}

function jsonByteLength(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : Buffer.byteLength(serialized, "utf8");
  } catch {
    return undefined;
  }
}

function hasReservedInputKey(
  value: unknown,
  depth = 0,
  keyCount = { value: 0 },
  seen = new WeakSet<object>(),
): boolean {
  if (depth > CAPABILITY_INPUT_LIMITS.maxDepth || value === null || typeof value !== "object") {
    return depth > CAPABILITY_INPUT_LIMITS.maxDepth;
  }
  if (seen.has(value)) return true;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasReservedInputKey(item, depth + 1, keyCount, seen));
  }

  for (const [key, child] of Object.entries(value)) {
    keyCount.value += 1;
    if (keyCount.value > CAPABILITY_INPUT_LIMITS.maxKeys) return true;
    if (RESERVED_INPUT_KEYS.has(key.replace(/[_-]/g, "").toLowerCase())) return true;
    if (hasReservedInputKey(child, depth + 1, keyCount, seen)) return true;
  }
  return false;
}

function validateRegistration(adapter: CapabilityAdapter | null | undefined): CapabilityFailure | undefined {
  if (!adapter || typeof adapter !== "object") {
    return failure("", 0, "CAPABILITY_CONTRACT_INVALID", "A capability registration must be an object.");
  }
  const parsed = CapabilityRegistrationSchema.safeParse({
    contractVersion: adapter.contractVersion,
    id: adapter.id,
    supportedRecipeVersions: adapter.supportedRecipeVersions,
    policy: adapter.policy,
  });
  if (!parsed.success) {
    return failure(
      String(adapter.id ?? ""),
      Number(adapter.supportedRecipeVersions?.[0] ?? 0),
      "CAPABILITY_CONTRACT_INVALID",
      "The server capability registration does not satisfy the capability contract.",
    );
  }
  if (adapter.inputSchema === undefined || adapter.outputSchema === undefined || typeof adapter.execute !== "function") {
    return failure(
      adapter.id,
      adapter.supportedRecipeVersions[0],
      "CAPABILITY_CONTRACT_INVALID",
      "A capability requires input and output schemas plus an implementation.",
    );
  }
  if (typeof adapter.inputSchema.safeParse !== "function" ||
      typeof adapter.outputSchema.safeParse !== "function") {
    return failure(
      adapter.id,
      adapter.supportedRecipeVersions[0],
      "CAPABILITY_CONTRACT_INVALID",
      "A capability requires runtime-valid input and output schemas.",
    );
  }
  return undefined;
}

function cloneRegistration(adapter: CapabilityAdapter): CapabilityAdapter {
  const catalog = adapter.catalog
    ? Object.freeze({
        ...adapter.catalog,
        inputShape: Object.freeze({
          ...adapter.catalog.inputShape,
          fields: Object.freeze(adapter.catalog.inputShape.fields.map((field) => Object.freeze({ ...field }))),
        }),
        supportedScopes: Object.freeze([...adapter.catalog.supportedScopes]),
        keywords: Object.freeze([...adapter.catalog.keywords]),
        allowedPhases: Object.freeze([...adapter.catalog.allowedPhases]),
        projectIds: Object.freeze([...adapter.catalog.projectIds]),
        expectedEvidence: Object.freeze([...adapter.catalog.expectedEvidence]),
      })
    : undefined;
  return Object.freeze({
    ...adapter,
    supportedRecipeVersions: Object.freeze([...adapter.supportedRecipeVersions]),
    policy: Object.freeze({
      ...adapter.policy,
      allowedOperations: Object.freeze([...adapter.policy.allowedOperations]),
      approvedCommandProfiles: Object.freeze([...adapter.policy.approvedCommandProfiles]),
    }),
    ...(catalog ? { catalog } : {}),
  }) as unknown as CapabilityAdapter;
}

/**
 * Deterministic registry of server-approved capability adapters.
 *
 * Registrations are immutable after insertion. All public execution paths
 * validate the opaque ID, recipe version, input, operation, and output before
 * returning a success value.
 */
export class CapabilityRegistry {
  private readonly adapters = new Map<CapabilityId, CapabilityAdapter>();

  public constructor(adapters: readonly CapabilityAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  public register(adapter: CapabilityAdapter): void {
    const invalid = validateRegistration(adapter);
    if (invalid) {
      throw new CapabilityRegistryError("CAPABILITY_CONTRACT_INVALID", invalid.detail);
    }
    const id = adapter.id as CapabilityId;
    if (this.adapters.has(id)) {
      throw new CapabilityRegistryError(
        "CAPABILITY_DUPLICATE_ID",
        `Capability "${id}" is already registered.`,
      );
    }
    this.adapters.set(id, cloneRegistration(adapter));
  }

  public has(capabilityId: string): boolean {
    return this.adapters.has(capabilityId as CapabilityId);
  }

  public get(capabilityId: string): CapabilityAdapter | undefined {
    const parsed = CapabilityIdSchema.safeParse(capabilityId);
    return parsed.success ? this.adapters.get(parsed.data) : undefined;
  }

  public list(): readonly CapabilityDescriptor[] {
    return [...this.adapters.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ inputSchema: _inputSchema, outputSchema: _outputSchema, execute: _execute, ...descriptor }) => descriptor);
  }

  public validateInput(
    capabilityId: string,
    recipeVersion: number,
    input: unknown,
  ): CapabilityValidation {
    const id = CapabilityIdSchema.safeParse(capabilityId);
    if (!id.success) return failure(capabilityId, recipeVersion, "CAPABILITY_UNKNOWN_ID", "The capability ID is not registered.");

    const adapter = this.adapters.get(id.data);
    if (!adapter) return failure(id.data, recipeVersion, "CAPABILITY_UNKNOWN_ID", "The capability ID is not registered.");
    if (!RecipeVersionSchema.safeParse(recipeVersion).success ||
        !adapter.supportedRecipeVersions.includes(recipeVersion as RecipeVersion)) {
      return failure(id.data, recipeVersion, "CAPABILITY_RECIPE_VERSION_UNSUPPORTED", "The recipe version is not supported by this capability.");
    }

    const inputBytes = jsonByteLength(input);
    if (inputBytes === undefined) {
      return failure(id.data, recipeVersion, "CAPABILITY_INPUT_INVALID", "Capability input must be JSON-serializable.");
    }
    if (inputBytes > adapter.policy.maxInputBytes) {
      return failure(id.data, recipeVersion, "CAPABILITY_INPUT_TOO_LARGE", "Capability input exceeds the server input limit.");
    }
    if (hasReservedInputKey(input)) {
      return failure(id.data, recipeVersion, "CAPABILITY_INPUT_INVALID", "Capability input contains a server-owned execution control.");
    }

    let parsedInput: ReturnType<typeof adapter.inputSchema.safeParse>;
    try {
      parsedInput = adapter.inputSchema.safeParse(input);
    } catch {
      return failure(id.data, recipeVersion, "CAPABILITY_INPUT_INVALID", "Capability input could not be validated.");
    }
    if (!parsedInput.success) {
      return failure(id.data, recipeVersion, "CAPABILITY_INPUT_INVALID", "Capability input does not match the registered input schema.");
    }
    return { ok: true, capability: adapter, input: parsedInput.data };
  }

  public async invoke(
    capabilityId: string,
    recipeVersion: number,
    input: unknown,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityInvocationResult> {
    const validation = this.validateInput(capabilityId, recipeVersion, input);
    if (!validation.ok) return validation;
    const { capability } = validation;

    if (capability.policy.requiresApproval && context.approvalState !== "APPROVED") {
      return failure(capability.id, recipeVersion, "CAPABILITY_APPROVAL_REQUIRED", "The capability requires server approval before execution.");
    }
    if (!capability.policy.allowedOperations.includes(context.operation)) {
      return failure(capability.id, recipeVersion, "CAPABILITY_OPERATION_NOT_ALLOWED", "The capability is not approved for this operation.");
    }
    if (capability.policy.approvedCommandProfiles.some(
      (profile) => !context.approvedCommandProfiles?.has(profile),
    )) {
      return failure(capability.id, recipeVersion, "CAPABILITY_PROFILE_NOT_APPROVED", "The capability requires a server-approved command profile.");
    }

    let output: unknown;
    try {
      output = await capability.execute(validation.input, context);
    } catch {
      return failure(capability.id, recipeVersion, "CAPABILITY_EXECUTION_FAILED", "The registered capability failed during execution.");
    }

    let parsedOutput: ReturnType<typeof capability.outputSchema.safeParse>;
    try {
      parsedOutput = capability.outputSchema.safeParse(output);
    } catch {
      return failure(capability.id, recipeVersion, "CAPABILITY_OUTPUT_INVALID", "Capability output could not be validated.");
    }
    if (!parsedOutput.success) {
      return failure(capability.id, recipeVersion, "CAPABILITY_OUTPUT_INVALID", "The capability produced output outside its registered schema.");
    }
    const outputBytes = jsonByteLength(parsedOutput.data);
    if (outputBytes === undefined || outputBytes > capability.policy.maxOutputBytes) {
      return failure(capability.id, recipeVersion, "CAPABILITY_OUTPUT_TOO_LARGE", "Capability output exceeds the server output limit.");
    }
    return {
      ok: true,
      capabilityId: capability.id,
      recipeVersion: recipeVersion as RecipeVersion,
      output: parsedOutput.data,
    };
  }
}

export class CapabilityRegistryError extends Error {
  public readonly code: "CAPABILITY_CONTRACT_INVALID" | "CAPABILITY_DUPLICATE_ID";

  public constructor(
    code: "CAPABILITY_CONTRACT_INVALID" | "CAPABILITY_DUPLICATE_ID",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityRegistryError";
    this.code = code;
  }
}

export const DEFAULT_CAPABILITY_POLICY: CapabilityPolicy = {
  risk: "low",
  requiresApproval: false,
  allowedOperations: ["recipe"],
  approvedCommandProfiles: [],
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 256 * 1024,
};