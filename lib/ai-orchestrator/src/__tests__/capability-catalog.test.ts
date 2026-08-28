import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CAPABILITY_CONTRACT_VERSION,
  CapabilityRegistry,
  DEFAULT_CAPABILITY_POLICY,
  type CapabilityAdapter,
  type CapabilityCatalogMetadata,
} from "../capability-contract.js";
import {
  buildCapabilityCatalog,
  formatCapabilityCatalogPrompt,
  resolveCapabilityCatalog,
  resolveCapabilityGap,
} from "../capability-catalog.js";
import { buildChatSystemPrompt } from "../prompts/chat.prompt.js";
import type { ProjectContext } from "../context-builder.js";

const safeCatalog: CapabilityCatalogMetadata = {
  purpose: "Inspect the active project for the requested behavior.",
  inputShape: {
    type: "object" as const,
    fields: [
      {
        name: "goal",
        type: "string" as const,
        required: true,
        description: "A short description of the behavior to inspect.",
      },
    ],
  },
  defaultScope: "project",
  supportedScopes: ["project", "paths"],
  estimatedCost: "low",
  mutatesProject: false,
  keywords: ["inspect", "behavior", "project"],
  allowedPhases: ["evidence"],
  projectIds: [],
  requiresAuthorization: false,
  expectedEvidence: ["A server-owned source evidence record."],
};

function makeCapability(
  id: string,
  overrides: Partial<CapabilityAdapter> = {},
): CapabilityAdapter {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    id,
    supportedRecipeVersions: [1],
    policy: DEFAULT_CAPABILITY_POLICY,
    catalog: safeCatalog,
    inputSchema: z.object({ goal: z.string() }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    execute: () => ({ ok: true }),
    ...overrides,
  };
}

function makeContext(): ProjectContext {
  return {
    project: "catalog test project",
    workflows: "",
    recentTasks: "",
    latestMetrics: "",
    graphSummary: "",
    recentEvents: "",
    metricsVerified: false,
  };
}

describe("capability catalog", () => {
  it("projects stable, bounded entries without implementations or execution controls", () => {
    const registry = new CapabilityRegistry([
      makeCapability("z.inspect", {
        policy: {
          ...DEFAULT_CAPABILITY_POLICY,
          approvedCommandProfiles: ["server-owned-profile"],
        },
      }),
      makeCapability("a.inspect"),
    ]);

    const result = buildCapabilityCatalog(registry, { phase: "evidence" });
    expect(result.entries.map((entry) => entry.id)).toEqual(["a.inspect", "z.inspect"]);
    expect(result.entries[0]).toMatchObject({
      contractVersion: 1,
      purpose: safeCatalog.purpose,
      defaultScope: "project",
      availability: { available: true, reason: "available" },
      autonomy: { automaticExecution: "eligible", confirmationReasons: [] },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("execute");
    expect(serialized).not.toContain("server-owned-profile");
    expect(serialized).not.toMatch(/\b(command|argv|cwd|shell|environment|secret)\b/i);
  });

  it("filters by project, phase, authorization, approval, scope, risk, and automatic execution", () => {
    const registry = new CapabilityRegistry([
      makeCapability("project.mutate", {
        policy: {
          ...DEFAULT_CAPABILITY_POLICY,
          risk: "high",
          requiresApproval: true,
        },
        catalog: {
          ...safeCatalog,
          mutatesProject: true,
          estimatedCost: "high",
          projectIds: ["project-1"],
          requiresAuthorization: true,
          allowedPhases: ["patch_proposal"],
          supportedScopes: ["paths"],
          defaultScope: "paths",
        },
      }),
    ]);

    const unavailable = buildCapabilityCatalog(registry, {
      projectId: "project-2",
      phase: "evidence",
      authorized: false,
      approvalState: "PENDING_APPROVAL",
      requestedScope: { kind: "project" },
      maxRisk: "low",
      automaticOnly: true,
      includeUnavailable: true,
    }).entries[0];
    expect(unavailable.availability.available).toBe(false);
    expect(unavailable.availability.reason).toBe("project_not_allowed");
    expect(unavailable.autonomy).toEqual({
      automaticExecution: "confirmation_required",
      confirmationReasons: ["mutation", "cost", "risk", "approval", "scope"],
    });

    const filtered = buildCapabilityCatalog(registry, {
      projectId: "project-2",
      phase: "evidence",
      includeUnavailable: false,
    });
    expect(filtered.entries).toEqual([]);
  });

  it("returns ranked, bounded suggestions based on the inferred goal", () => {
    const registry = new CapabilityRegistry([
      makeCapability("behavior.inspect", {
        catalog: { ...safeCatalog, keywords: ["behavior", "inspect"] },
      }),
      makeCapability("behavior.report", {
        catalog: {
          ...safeCatalog,
          purpose: "Produce a behavior report from verified evidence.",
          keywords: ["behavior", "report"],
        },
      }),
      makeCapability("unrelated.capability", {
        catalog: { ...safeCatalog, purpose: "Manage unrelated records.", keywords: ["records"] },
      }),
    ]);

    const result = buildCapabilityCatalog(registry, {
      phase: "evidence",
      goal: "inspect behavior",
    });
    expect(result.suggestions.map((suggestion) => suggestion.capabilityId)).toEqual([
      "behavior.inspect",
      "behavior.report",
    ]);
    expect(result.suggestions.every((suggestion) =>
      suggestion.confidence >= 0 && suggestion.confidence <= 1 &&
      suggestion.assumptions.length <= 3 &&
      suggestion.expectedEvidence.length <= 5,
    )).toBe(true);
  });

  it("returns structured gaps instead of pretending unsupported requests ran", () => {
    const registry = new CapabilityRegistry([makeCapability("behavior.inspect")]);

    expect(resolveCapabilityGap(registry, {})).toMatchObject({
      kind: "capability_gap",
      code: "MALFORMED_REQUEST",
    });
    expect(resolveCapabilityGap(registry, {
      capabilityId: "missing.capability",
      recipeVersion: 1,
    })).toMatchObject({
      kind: "capability_gap",
      code: "CAPABILITY_UNKNOWN_ID",
    });
    expect(resolveCapabilityGap(registry, {
      capabilityId: "behavior.inspect",
      recipeVersion: 1,
      discovery: { requestedScope: { kind: "workspace" } },
    })).toMatchObject({
      kind: "capability_gap",
      code: "CAPABILITY_SCOPE_UNSUPPORTED",
    });
    expect(resolveCapabilityGap(registry, {
      capabilityId: "behavior.inspect",
      recipeVersion: 1,
      discovery: { phase: "evidence" },
    })).toBeNull();
  });

  it("rejects malformed catalog requests and keeps prompt output bounded to safe fields", () => {
    const registry = new CapabilityRegistry([makeCapability("behavior.inspect")]);
    expect(resolveCapabilityCatalog(registry, {
      goal: "x",
      unknownControl: "must be rejected",
    })).toMatchObject({
      kind: "capability_gap",
      code: "MALFORMED_REQUEST",
    });

    const prompt = formatCapabilityCatalogPrompt(buildCapabilityCatalog(registry, {
      goal: "inspect behavior",
    }));
    expect(prompt).toContain("CAPABILITY CATALOG — PLANNING ONLY");
    expect(prompt).toContain("behavior.inspect");
    expect(prompt).not.toContain("server-owned-profile");
    expect(prompt).not.toMatch(/\b(command|argv|cwd|shell|environment)\s*[:=]/i);
  });

  it("adds the catalog to planning context without widening the executable tool manifest", () => {
    const registry = new CapabilityRegistry([makeCapability("behavior.inspect", {
      policy: {
        ...DEFAULT_CAPABILITY_POLICY,
        approvedCommandProfiles: ["never-exposed"],
      },
    })]);
    const catalogPrompt = formatCapabilityCatalogPrompt(buildCapabilityCatalog(registry));
    const systemPrompt = buildChatSystemPrompt({
      context: makeContext(),
      hasTools: true,
      capabilityCatalog: catalogPrompt,
    });

    expect(systemPrompt).toContain("Registered capabilities for planning");
    expect(systemPrompt).toContain("behavior.inspect");
    expect(systemPrompt).toContain("PLANNING ONLY");
    expect(systemPrompt).not.toContain("never-exposed");
  });
});