import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CAPABILITY_CONTRACT_VERSION,
  CapabilityRegistry,
  DEFAULT_CAPABILITY_POLICY,
  type CapabilityAdapter,
} from "../capability-contract.js";
import {
  advanceCompiledRecipeTransition,
  compileCapabilityRecipe,
  compileCapabilityRecipeOrThrow,
  DEFAULT_RECIPE_EXECUTION_POLICY,
  evaluateRecipeEvidencePredicate,
} from "../recipe-compiler.js";

function makeCapability(
  id = "validation.check",
  overrides: Partial<CapabilityAdapter> = {},
): CapabilityAdapter {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    id,
    supportedRecipeVersions: [1],
    policy: DEFAULT_CAPABILITY_POLICY,
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    outputSchema: z.object({ ok: z.boolean(), message: z.string() }).strict(),
    execute: ({ value }) => ({ ok: true, message: value }),
    ...overrides,
  };
}

function recipe(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    recipeId: "safe-check",
    recipeVersion: 1,
    nodes: [{
      id: "check",
      title: "Run the registered check",
      capabilityId: "validation.check",
      recipeVersion: 1,
      input: { value: "ready" },
      dependsOn: [],
      declaredOutputs: ["ok", "message"],
    }],
    transitions: [],
    outcome: {
      success: {
        kind: "all",
        predicates: [
          { kind: "node_status", nodeId: "check", status: "passed" },
          { kind: "evidence", nodeId: "check", evidenceType: "validation_passed" },
        ],
      },
      outputs: [{ name: "message", nodeId: "check", output: "message" }],
    },
    ...overrides,
  };
}

function options(registry = new CapabilityRegistry([makeCapability()])) {
  return {
    registry,
    context: {
      projectId: "project-1",
      rootPath: "/workspace/project-1",
      revision: "rev-1",
      allowedFiles: ["src/check.ts"],
    },
  };
}

describe("safe capability recipe compiler", () => {
  it("compiles deterministic, dependency-ordered nodes with server-owned controls", () => {
    const registry = new CapabilityRegistry([makeCapability(), makeCapability("validation.followup")]);
    const input = recipe({
      nodes: [
        {
          id: "followup",
          title: "Follow up",
          capabilityId: "validation.followup",
          recipeVersion: 1,
          input: { value: "second" },
          dependsOn: ["check"],
          declaredOutputs: ["ok"],
        },
        recipe().nodes[0],
      ],
    });

    const first = compileCapabilityRecipe(input, options(registry));
    const second = compileCapabilityRecipe(input, options(registry));
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.plan.nodes.map((node) => node.id)).toEqual([
      "recipe:safe-check:check",
      "recipe:safe-check:followup",
    ]);
    expect(first.plan.nodes[1]).toMatchObject({
      dependencies: ["recipe:safe-check:check"],
      attempts: 0,
      executionTimeoutMs: DEFAULT_RECIPE_EXECUTION_POLICY.nodeTimeoutMs,
      maxAttempts: DEFAULT_RECIPE_EXECUTION_POLICY.maxAttempts,
      capabilityId: "validation.followup",
      recipeVersion: 1,
      executionContext: {
        projectId: "project-1",
        revision: "rev-1",
        rootPath: "/workspace/project-1",
      },
    });
    expect(first.plan.transitions).toHaveLength(2);
    expect(first.plan.transitions[0]?.id).toBe("recipe:safe-check:transition:auto-check");
  });

  it("rejects unknown capabilities, unsupported versions, invalid inputs, and policy failures", () => {
    const unknown = compileCapabilityRecipe(recipe({
      nodes: [{ ...recipe().nodes[0], capabilityId: "missing.capability" }],
    }), options());
    expect(unknown).toMatchObject({ ok: false, diagnostics: [{ code: "CAPABILITY_UNKNOWN_ID" }] });

    const version = compileCapabilityRecipe(recipe({
      nodes: [{ ...recipe().nodes[0], recipeVersion: 2 }],
    }), options());
    expect(version).toMatchObject({ ok: false, diagnostics: [{ code: "CAPABILITY_RECIPE_VERSION_UNSUPPORTED" }] });

    const invalidInput = compileCapabilityRecipe(recipe({
      nodes: [{ ...recipe().nodes[0], input: { value: "" } }],
    }), options());
    expect(invalidInput).toMatchObject({ ok: false, diagnostics: [{ code: "CAPABILITY_INPUT_INVALID" }] });

    const approvalRegistry = new CapabilityRegistry([makeCapability("validation.check", {
      policy: { ...DEFAULT_CAPABILITY_POLICY, requiresApproval: true },
    })]);
    const approval = compileCapabilityRecipe(recipe(), options(approvalRegistry));
    expect(approval).toMatchObject({ ok: false, diagnostics: [{ code: "CAPABILITY_APPROVAL_REQUIRED" }] });
  });

  it("rejects duplicate IDs, unknown dependencies, cycles, undeclared outputs, and model controls", () => {
    const duplicate = compileCapabilityRecipe(recipe({
      nodes: [recipe().nodes[0], recipe().nodes[0]],
    }), options());
    expect(duplicate).toMatchObject({ ok: false, diagnostics: [{ code: "DUPLICATE_NODE_ID" }] });

    const dependency = compileCapabilityRecipe(recipe({
      nodes: [{ ...recipe().nodes[0], dependsOn: ["missing"] }],
    }), options());
    expect(dependency).toMatchObject({ ok: false, diagnostics: [{ code: "UNKNOWN_DEPENDENCY" }] });

    const cycle = compileCapabilityRecipe(recipe({
      nodes: [
        { ...recipe().nodes[0], id: "first", dependsOn: ["second"] },
        { ...recipe().nodes[0], id: "second", dependsOn: ["first"] },
      ],
    }), options());
    expect(cycle.ok).toBe(false);
    expect(cycle.ok ? [] : cycle.diagnostics.map((item) => item.code)).toContain("DEPENDENCY_CYCLE");

    const output = compileCapabilityRecipe(recipe({
      outcome: {
        ...recipe().outcome,
        success: { kind: "output_present", nodeId: "check", output: "not_declared" },
      },
    }), options());
    expect(output).toMatchObject({ ok: false, diagnostics: [{ code: "UNDECLARED_OUTPUT" }] });

    for (const key of ["argv", "cwd", "env", "profile", "shell"]) {
      const control = compileCapabilityRecipe(recipe({
        nodes: [{
          ...recipe().nodes[0],
          input: { value: "ready", [key]: key === "argv" ? ["unsafe"] : "unsafe" },
        }],
      }), options());
      expect(control.ok).toBe(false);
      expect(control.ok ? [] : control.diagnostics.map((item) => item.code)).toContain("CAPABILITY_INPUT_INVALID");
    }
  });

  it("bounds branches, rejects contradictory/non-terminating transitions, and preserves terminal safety", () => {
    const branching = compileCapabilityRecipe(recipe({
      transitions: [
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `branch-${index}`,
          fromNodeId: "check",
          predicate: { kind: "node_status", nodeId: "check", status: "passed" },
          then: { kind: "terminal", status: "success" },
          otherwise: { kind: "terminal", status: "failure" },
        })),
      ],
    }), options());
    expect(branching.ok).toBe(false);
    expect(branching.ok ? [] : branching.diagnostics.map((item) => item.code)).toContain("TOO_MANY_BRANCHES");

    const contradictory = compileCapabilityRecipe(recipe({
      outcome: {
        ...recipe().outcome,
        success: {
          kind: "all",
          predicates: [
            { kind: "node_status", nodeId: "check", status: "passed" },
            { kind: "node_status", nodeId: "check", status: "failed" },
          ],
        },
      },
    }), options());
    expect(contradictory).toMatchObject({ ok: false, diagnostics: [{ code: "CONTRADICTORY_PREDICATE" }] });

    const nonTerminating = compileCapabilityRecipe(recipe({
      transitions: [{
        id: "loop",
        fromNodeId: "check",
        predicate: { kind: "node_status", nodeId: "check", status: "passed" },
        then: { kind: "node", nodeId: "check" },
        otherwise: { kind: "node", nodeId: "check" },
      }],
    }), options());
    expect(nonTerminating.ok).toBe(false);
    expect(nonTerminating.ok ? [] : nonTerminating.diagnostics.map((item) => item.code)).toContain("NON_TERMINATING_PLAN");

    const overBudget = compileCapabilityRecipe(recipe(), {
      ...options(),
      policy: { ...DEFAULT_RECIPE_EXECUTION_POLICY, nodeTimeoutMs: 100, maxTotalTimeoutMs: 99 },
    });
    expect(overBudget).toMatchObject({ ok: false, diagnostics: [{ code: "PLAN_TOO_LARGE" }] });
  });

  it("advances only on typed evidence and preserves cancellation/terminal state", () => {
    const compiled = compileCapabilityRecipe(recipe(), options());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const nodeId = compiled.plan.nodes[0]!.id;
    const waiting = advanceCompiledRecipeTransition(compiled.plan, {
      [nodeId]: { status: "passed" },
    });
    expect(waiting.status).toBe("blocked");
    expect(waiting.state.status).toBe("running");

    const passed = advanceCompiledRecipeTransition(compiled.plan, {
      [nodeId]: {
        status: "passed",
        outputs: { ok: true, message: "ready" },
        evidence: [{ type: "validation_passed" }],
      },
    });
    expect(passed.status).toBe("succeeded");
    expect(passed.state.completedNodeIds).toEqual([nodeId]);

    const controller = new AbortController();
    controller.abort();
    const cancelled = advanceCompiledRecipeTransition(compiled.plan, {}, controller.signal);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.state.status).toBe("cancelled");
    expect(evaluateRecipeEvidencePredicate(
      { kind: "evidence", nodeId, evidenceType: "validation_passed" },
      { [nodeId]: { status: "passed", evidence: [{ type: "validation_passed" }] } },
    )).toBe(true);
  });

  it("exposes a fail-closed throwing compiler for callers that require a plan", () => {
    expect(() => compileCapabilityRecipeOrThrow(recipe({
      nodes: [{ ...recipe().nodes[0], capabilityId: "missing.capability" }],
    }), options())).toThrow(/CAPABILITY_UNKNOWN_ID/);
    const execute = vi.fn();
    expect(execute).not.toHaveBeenCalled();
  });
});