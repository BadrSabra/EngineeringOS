import { z } from "zod";
import {
  CAPABILITY_CONTRACT_VERSION,
  CapabilityCatalogMetadataSchema,
  CapabilityInputShapeSchema,
  CapabilityIdSchema,
  CapabilityRegistry,
  RecipeVersionSchema,
  type CapabilityAdapter,
  type CapabilityCatalogMetadata,
  type CapabilityRisk,
  type CapabilityScopeKind,
} from "./capability-contract.js";
import { EXECUTION_PHASES, type ExecutionPhase } from "./quality/execution-phases.js";

export const CAPABILITY_CATALOG_VERSION = 1 as const;
export const MAX_CATALOG_ENTRIES = 32;
export const MAX_CATALOG_SUGGESTIONS = 3;

const MAX_CATALOG_TEXT = 240;
const MAX_CATALOG_ASSUMPTIONS = 3;
const MAX_CATALOG_EVIDENCE = 5;

const RISK_ORDER: readonly CapabilityRisk[] = ["low", "medium", "high", "critical"];

const CatalogDiscoveryRequestSchema = z
  .object({
    projectId: z.string().min(1).max(160).optional(),
    phase: z.enum(EXECUTION_PHASES as [ExecutionPhase, ...ExecutionPhase[]]).optional(),
    operation: z.string().min(1).max(80).optional(),
    approvalState: z.enum(["APPROVED", "PENDING_APPROVAL", "REJECTED"]).optional(),
    authorized: z.boolean().optional(),
    maxRisk: z.enum(["low", "medium", "high", "critical"]).optional(),
    automaticOnly: z.boolean().optional(),
    requestedScope: z
      .object({
        kind: z.enum(["none", "project", "paths", "file", "workspace"]),
        paths: z.array(z.string().min(1).max(256)).max(32).optional(),
      })
      .strict()
      .optional(),
    goal: z.string().max(400).optional(),
    includeUnavailable: z.boolean().optional(),
  })
  .strict();

export const CapabilityCatalogRequestSchema = CatalogDiscoveryRequestSchema;
export type CapabilityCatalogRequest = z.infer<typeof CapabilityCatalogRequestSchema>;

export const CapabilityAvailabilityReasonSchema = z.enum([
  "available",
  "project_required",
  "project_not_allowed",
  "phase_not_allowed",
  "operation_not_allowed",
  "authorization_required",
  "approval_required",
  "risk_not_allowed",
  "scope_not_supported",
  "automatic_execution_not_allowed",
  "stale_registration",
]);
export type CapabilityAvailabilityReason = z.infer<typeof CapabilityAvailabilityReasonSchema>;

export const CapabilityAutonomySchema = z
  .object({
    automaticExecution: z.enum(["eligible", "confirmation_required"]),
    confirmationReasons: z.array(z.enum(["mutation", "cost", "risk", "approval", "scope"])).max(5),
  })
  .strict();
export type CapabilityAutonomy = z.infer<typeof CapabilityAutonomySchema>;

export const CapabilityCatalogEntrySchema = z
  .object({
    id: CapabilityIdSchema,
    contractVersion: z.literal(CAPABILITY_CONTRACT_VERSION),
    supportedRecipeVersions: z.array(RecipeVersionSchema).min(1).max(32),
    purpose: z.string().min(1).max(MAX_CATALOG_TEXT),
    inputShape: CapabilityInputShapeSchema,
    cost: z.enum(["low", "medium", "high"]),
    risk: z.enum(["low", "medium", "high", "critical"]),
    defaultScope: z.enum(["none", "project", "paths", "file", "workspace"]),
    availability: z
      .object({
        available: z.boolean(),
        reason: CapabilityAvailabilityReasonSchema,
        operatorGuidance: z.string().min(1).max(MAX_CATALOG_TEXT),
      })
      .strict(),
    autonomy: CapabilityAutonomySchema,
  })
  .strict();
export type CapabilityCatalogEntry = z.infer<typeof CapabilityCatalogEntrySchema>;

export const CapabilitySuggestionSchema = z
  .object({
    capabilityId: CapabilityIdSchema,
    recipeVersion: RecipeVersionSchema,
    reason: z.string().min(1).max(180),
    confidence: z.number().min(0).max(1),
    assumptions: z.array(z.string().min(1).max(160)).max(MAX_CATALOG_ASSUMPTIONS),
    expectedEvidence: z.array(z.string().min(1).max(160)).max(MAX_CATALOG_EVIDENCE),
  })
  .strict();
export type CapabilitySuggestion = z.infer<typeof CapabilitySuggestionSchema>;

export const CapabilityCatalogResultSchema = z
  .object({
    kind: z.literal("capability_catalog"),
    catalogVersion: z.literal(CAPABILITY_CATALOG_VERSION),
    entries: z.array(CapabilityCatalogEntrySchema).max(MAX_CATALOG_ENTRIES),
    suggestions: z.array(CapabilitySuggestionSchema).max(MAX_CATALOG_SUGGESTIONS),
  })
  .strict();
export type CapabilityCatalogResult = z.infer<typeof CapabilityCatalogResultSchema>;

export const CapabilityGapCodeSchema = z.enum([
  "MALFORMED_REQUEST",
  "CAPABILITY_UNKNOWN_ID",
  "CAPABILITY_RECIPE_VERSION_UNSUPPORTED",
  "CAPABILITY_UNAVAILABLE",
  "CAPABILITY_POLICY_BLOCKED",
  "CAPABILITY_SCOPE_UNSUPPORTED",
]);
export type CapabilityGapCode = z.infer<typeof CapabilityGapCodeSchema>;

export const CapabilityGapSchema = z
  .object({
    kind: z.literal("capability_gap"),
    code: CapabilityGapCodeSchema,
    capabilityId: z.string().max(80),
    recipeVersion: z.number().int().min(1).max(100),
    reason: z.string().min(1).max(MAX_CATALOG_TEXT),
    operatorGuidance: z.string().min(1).max(MAX_CATALOG_TEXT),
    availableAlternatives: z.array(CapabilityIdSchema).max(MAX_CATALOG_SUGGESTIONS),
  })
  .strict();
export type CapabilityGap = z.infer<typeof CapabilityGapSchema>;

export type CapabilityRequest = {
  capabilityId: string;
  recipeVersion: number;
  discovery?: CapabilityCatalogRequest;
};

type Availability = {
  available: boolean;
  reason: CapabilityAvailabilityReason;
  operatorGuidance: string;
};

const FALLBACK_METADATA = (adapter: CapabilityAdapter): CapabilityCatalogMetadata => ({
  purpose: `Use ${adapter.id} for its registered project operation.`,
  inputShape: { type: "object", fields: [] },
  defaultScope: "project",
  supportedScopes: ["project"],
  estimatedCost: adapter.policy.risk === "critical" ? "high" : adapter.policy.risk === "high" ? "medium" : "low",
  mutatesProject: adapter.policy.risk !== "low",
  keywords: adapter.id.split(/[.:_-]+/).filter(Boolean).slice(0, 8),
  allowedPhases: [],
  projectIds: [],
  requiresAuthorization: false,
  expectedEvidence: ["A server-owned capability result matching the registered output schema."],
});

function metadataFor(adapter: CapabilityAdapter): CapabilityCatalogMetadata {
  const candidate = adapter.catalog;
  if (!candidate) return FALLBACK_METADATA(adapter);
  const parsed = CapabilityCatalogMetadataSchema.safeParse(candidate);
  return parsed.success ? parsed.data : FALLBACK_METADATA(adapter);
}

function cleanText(value: string, max = MAX_CATALOG_TEXT): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function availabilityFor(
  adapter: CapabilityAdapter,
  metadata: CapabilityCatalogMetadata,
  request: CapabilityCatalogRequest,
): Availability {
  if (adapter.contractVersion !== CAPABILITY_CONTRACT_VERSION ||
      adapter.supportedRecipeVersions.some((version) => !Number.isInteger(version) || version < 1)) {
    return {
      available: false,
      reason: "stale_registration",
      operatorGuidance: "Refresh the server capability registration before requesting this capability.",
    };
  }
  if (metadata.allowedPhases.some((phase) =>
    !EXECUTION_PHASES.includes(phase as ExecutionPhase),
  )) {
    return {
      available: false,
      reason: "stale_registration",
      operatorGuidance: "Refresh the server capability registration before requesting this capability.",
    };
  }
  if (metadata.projectIds.length > 0 && !request.projectId) {
    return {
      available: false,
      reason: "project_required",
      operatorGuidance: "Select an active project before requesting this capability.",
    };
  }
  if (metadata.projectIds.length > 0 && request.projectId && !metadata.projectIds.includes(request.projectId)) {
    return {
      available: false,
      reason: "project_not_allowed",
      operatorGuidance: "Request this capability from a project explicitly approved by its registration.",
    };
  }
  if (request.phase && metadata.allowedPhases.length > 0 && !metadata.allowedPhases.includes(request.phase)) {
    return {
      available: false,
      reason: "phase_not_allowed",
      operatorGuidance: "Wait for a server-approved execution phase for this capability.",
    };
  }
  const operation = request.operation ?? "recipe";
  if (!adapter.policy.allowedOperations.includes(operation)) {
    return {
      available: false,
      reason: "operation_not_allowed",
      operatorGuidance: "Use the capability only from an operation named in its server policy.",
    };
  }
  if (metadata.requiresAuthorization && request.authorized !== true) {
    return {
      available: false,
      reason: "authorization_required",
      operatorGuidance: "An authorized project session is required before requesting this capability.",
    };
  }
  if (adapter.policy.requiresApproval && request.approvalState !== "APPROVED") {
    return {
      available: false,
      reason: "approval_required",
      operatorGuidance: "Obtain explicit server approval before requesting this capability.",
    };
  }
  if (request.maxRisk && RISK_ORDER.indexOf(adapter.policy.risk) > RISK_ORDER.indexOf(request.maxRisk)) {
    return {
      available: false,
      reason: "risk_not_allowed",
      operatorGuidance: "Choose a lower-risk capability or obtain a policy allowing this risk level.",
    };
  }
  if (request.requestedScope && !metadata.supportedScopes.includes(request.requestedScope.kind)) {
    return {
      available: false,
      reason: "scope_not_supported",
      operatorGuidance: "Narrow or change the requested scope to one supported by this capability.",
    };
  }
  const requiresConfirmation =
    metadata.mutatesProject ||
    metadata.estimatedCost !== "low" ||
    adapter.policy.risk === "high" ||
    adapter.policy.risk === "critical" ||
    adapter.policy.requiresApproval;
  if (request.automaticOnly && requiresConfirmation) {
    return {
      available: false,
      reason: "automatic_execution_not_allowed",
      operatorGuidance: "Ask for confirmation before using this mutation, cost, risk, or approval-gated capability.",
    };
  }
  return {
    available: true,
    reason: "available",
    operatorGuidance: "This capability is available within the active server policy.",
  };
}

function autonomyFor(
  adapter: CapabilityAdapter,
  metadata: CapabilityCatalogMetadata,
  requestedScope: CapabilityScopeKind | undefined,
): CapabilityAutonomy {
  const confirmationReasons: CapabilityAutonomy["confirmationReasons"] = [];
  if (metadata.mutatesProject) confirmationReasons.push("mutation");
  if (metadata.estimatedCost !== "low") confirmationReasons.push("cost");
  if (adapter.policy.risk === "high" || adapter.policy.risk === "critical") confirmationReasons.push("risk");
  if (adapter.policy.requiresApproval) confirmationReasons.push("approval");
  if (requestedScope && requestedScope !== metadata.defaultScope) confirmationReasons.push("scope");
  return {
    automaticExecution: confirmationReasons.length === 0 ? "eligible" : "confirmation_required",
    confirmationReasons,
  };
}

function projectEntry(adapter: CapabilityAdapter, request: CapabilityCatalogRequest): CapabilityCatalogEntry {
  const metadata = metadataFor(adapter);
  const availability = availabilityFor(adapter, metadata, request);
  return {
    id: adapter.id,
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    supportedRecipeVersions: [...adapter.supportedRecipeVersions].sort((a, b) => a - b),
    purpose: cleanText(metadata.purpose),
    inputShape: {
      type: "object",
      fields: metadata.inputShape.fields.map((field) => ({
        name: field.name,
        type: field.type,
        required: field.required,
        description: cleanText(field.description, 180),
      })),
    },
    cost: metadata.estimatedCost,
    risk: adapter.policy.risk,
    defaultScope: metadata.defaultScope,
    availability,
    autonomy: autonomyFor(adapter, metadata, request.requestedScope?.kind),
  };
}

function goalTokens(goal: string | undefined): string[] {
  return [...new Set((goal ?? "").toLocaleLowerCase().match(/[a-z0-9][a-z0-9._:-]*/g) ?? [])].slice(0, 32);
}

function buildSuggestions(
  adapters: readonly CapabilityAdapter[],
  entries: readonly CapabilityCatalogEntry[],
  request: CapabilityCatalogRequest,
): CapabilitySuggestion[] {
  const tokens = goalTokens(request.goal);
  if (tokens.length === 0) return [];
  return adapters
    .map((adapter) => {
      const metadata = metadataFor(adapter);
      const entry = entries.find((candidate) => candidate.id === adapter.id);
      if (!entry?.availability.available) return null;
      const haystack = [adapter.id, metadata.purpose, ...metadata.keywords]
        .join(" ")
        .toLocaleLowerCase();
      const hits = tokens.filter((token) => haystack.includes(token)).length;
      if (hits === 0) return null;
      const confidence = Math.min(1, Math.round((0.35 + (hits / tokens.length) * 0.65) * 100) / 100);
      const assumptions = [
        request.projectId ? "The active project is the intended target." : "The active project will be established by the server.",
        `The request fits the ${metadata.defaultScope} default scope.`,
      ];
      if (entry.autonomy.automaticExecution === "confirmation_required") {
        assumptions.push("Any required confirmation will be collected before execution.");
      }
      return {
        capabilityId: adapter.id,
        recipeVersion: entry.supportedRecipeVersions[0],
        reason: cleanText(`Matches the requested goal through ${metadata.purpose.toLocaleLowerCase()}`, 180),
        confidence,
        assumptions: assumptions.slice(0, MAX_CATALOG_ASSUMPTIONS),
        expectedEvidence: metadata.expectedEvidence.slice(0, MAX_CATALOG_EVIDENCE).map((item) => cleanText(item, 160)),
      };
    })
    .filter((suggestion): suggestion is CapabilitySuggestion => suggestion !== null)
    .sort((left, right) =>
      right.confidence - left.confidence ||
      left.capabilityId.localeCompare(right.capabilityId),
    )
    .slice(0, MAX_CATALOG_SUGGESTIONS);
}

/**
 * Build a deterministic, bounded, server-owned catalog projection. By
 * default only available registrations are returned; callers may set
 * includeUnavailable to true when operators need to understand why a
 * registration was not selected.
 */
export function buildCapabilityCatalog(
  registry: CapabilityRegistry,
  request: CapabilityCatalogRequest = {},
): CapabilityCatalogResult {
  const adapters = registry
    .list()
    .map((descriptor) => registry.get(descriptor.id))
    .filter((adapter): adapter is CapabilityAdapter => adapter !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  const projected = adapters
    .map((adapter) => projectEntry(adapter, request))
    .filter((entry) => request.includeUnavailable !== false || entry.availability.available)
    .slice(0, MAX_CATALOG_ENTRIES);
  return {
    kind: "capability_catalog",
    catalogVersion: CAPABILITY_CATALOG_VERSION,
    entries: projected,
    suggestions: buildSuggestions(adapters, projected, request),
  };
}

function gap(
  code: CapabilityGapCode,
  capabilityId: string,
  recipeVersion: number,
  reason: string,
  operatorGuidance: string,
  alternatives: readonly string[] = [],
): CapabilityGap {
  return {
    kind: "capability_gap",
    code,
    capabilityId: capabilityId.slice(0, 80),
    recipeVersion: Number.isInteger(recipeVersion) ? Math.max(1, Math.min(100, recipeVersion)) : 1,
    reason: cleanText(reason),
    operatorGuidance: cleanText(operatorGuidance),
    availableAlternatives: alternatives.slice(0, MAX_CATALOG_SUGGESTIONS) as string[],
  };
}

/**
 * Resolve a model/requested capability against the same filtered catalog used
 * for planning. This returns a gap rather than an execution-looking success;
 * recipe binding and invocation remain separate server-owned operations.
 */
export function resolveCapabilityGap(
  registry: CapabilityRegistry,
  rawRequest: unknown,
): CapabilityGap | null {
  const parsed = z
    .object({
      capabilityId: z.string().max(80).optional(),
      recipeVersion: z.number().int().min(1).max(100).optional(),
      discovery: CapabilityCatalogRequestSchema.optional(),
    })
    .strict()
    .safeParse(rawRequest);
  if (!parsed.success || !parsed.data.capabilityId || parsed.data.recipeVersion === undefined) {
    return gap(
      "MALFORMED_REQUEST",
      typeof (rawRequest as Record<string, unknown> | null)?.capabilityId === "string"
        ? String((rawRequest as Record<string, unknown>).capabilityId)
        : "",
      typeof (rawRequest as Record<string, unknown> | null)?.recipeVersion === "number"
        ? Number((rawRequest as Record<string, unknown>).recipeVersion)
        : 1,
      "The capability request is malformed or incomplete.",
      "Provide only a capability ID, a supported recipe version, and server-owned discovery context.",
    );
  }
  const id = CapabilityIdSchema.safeParse(parsed.data.capabilityId);
  if (!id.success || !registry.has(parsed.data.capabilityId)) {
    return gap(
      "CAPABILITY_UNKNOWN_ID",
      parsed.data.capabilityId,
      parsed.data.recipeVersion,
      "The requested capability is not registered.",
      "Choose an ID from the current capability catalog.",
      buildCapabilityCatalog(registry, { includeUnavailable: false }).entries.map((entry) => entry.id),
    );
  }
  const adapter = registry.get(parsed.data.capabilityId);
  if (!adapter || !adapter.supportedRecipeVersions.includes(parsed.data.recipeVersion as never)) {
    return gap(
      "CAPABILITY_RECIPE_VERSION_UNSUPPORTED",
      parsed.data.capabilityId,
      parsed.data.recipeVersion,
      "The requested recipe version is not supported by this capability.",
      "Choose one of the supported recipe versions shown in the current catalog.",
      adapter ? [adapter.id] : [],
    );
  }
  const discovery = parsed.data.discovery ?? {};
  const entry = buildCapabilityCatalog(registry, { ...discovery, includeUnavailable: true }).entries
    .find((candidate) => candidate.id === adapter.id);
  if (!entry?.availability.available) {
    const policyReason = entry?.availability.reason === "scope_not_supported"
      ? "CAPABILITY_SCOPE_UNSUPPORTED"
      : entry?.availability.reason === "stale_registration"
        ? "CAPABILITY_UNAVAILABLE"
        : "CAPABILITY_POLICY_BLOCKED";
    return gap(
      policyReason,
      adapter.id,
      parsed.data.recipeVersion,
      entry?.availability.operatorGuidance ?? "The capability is unavailable in the current server context.",
      entry?.availability.operatorGuidance ?? "Refresh the catalog and retry with an allowed server context.",
    );
  }
  return null;
}

export function resolveCapabilityCatalog(
  registry: CapabilityRegistry,
  rawRequest: unknown,
): CapabilityCatalogResult | CapabilityGap {
  const parsed = CapabilityCatalogRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    return gap(
      "MALFORMED_REQUEST",
      "",
      1,
      "The capability catalog request is malformed.",
      "Use bounded catalog filters and do not include execution controls.",
    );
  }
  return buildCapabilityCatalog(registry, parsed.data);
}

/**
 * Safe prompt projection for planning. It intentionally omits availability
 * internals such as project IDs and all policy implementation controls.
 */
export function formatCapabilityCatalogPrompt(catalog: CapabilityCatalogResult): string {
  const lines = catalog.entries.map((entry) => {
    const fields = entry.inputShape.fields.map((field) =>
      `${field.name}${field.required ? "*" : ""}:${field.type}`,
    ).join(", ");
    const availability = entry.availability.available
      ? "available"
      : `unavailable (${entry.availability.reason})`;
    return `- ${entry.id} v${entry.supportedRecipeVersions.join("/")} — ${entry.purpose}; input {${fields}}; scope ${entry.defaultScope}; cost ${entry.cost}; risk ${entry.risk}; ${availability}; automatic execution ${entry.autonomy.automaticExecution}`;
  });
  const suggestions = catalog.suggestions.length > 0
    ? catalog.suggestions.map((suggestion) =>
      `- ${suggestion.capabilityId} v${suggestion.recipeVersion}: ${suggestion.reason} (confidence ${suggestion.confidence})`,
    )
    : ["- No ranked suggestion matched the current goal."];
  return [
    "CAPABILITY CATALOG — PLANNING ONLY",
    "Capability IDs and recipe versions are opaque request identifiers. This catalog is not a tool manifest and does not grant execution authority.",
    ...(lines.length > 0 ? lines : ["- No registered capabilities are available."]),
    "Suggested next actions:",
    ...suggestions,
    "To request a capability, name only its capability ID, recipe version, and business input. Never provide commands, argv, cwd, environment, profiles, or process settings.",
  ].join("\n");
}

/** Compatibility names for callers that treat the catalog as a read-only query. */
export const getCapabilityCatalog = buildCapabilityCatalog;
export const getCapabilityGap = resolveCapabilityGap;
export const buildCapabilityCatalogPrompt = formatCapabilityCatalogPrompt;
