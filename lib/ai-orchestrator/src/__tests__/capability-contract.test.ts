import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CAPABILITY_CONTRACT_VERSION,
  CapabilityRegistry,
  CapabilityRegistryError,
  DEFAULT_CAPABILITY_POLICY,
  type CapabilityAdapter,
} from "../capability-contract.js";

function makeCapability(
  overrides: Partial<CapabilityAdapter> = {},
): CapabilityAdapter {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    id: "test.echo",
    supportedRecipeVersions: [1],
    policy: DEFAULT_CAPABILITY_POLICY,
    inputSchema: z.object({ message: z.string().min(1) }).strict(),
    outputSchema: z.object({ message: z.string() }).strict(),
    execute: ({ message }) => ({ message }),
    ...overrides,
  };
}

describe("capability contract and registry", () => {
  it("registers immutable capabilities and lists them deterministically", () => {
    const registry = new CapabilityRegistry([
      makeCapability({ id: "z.last" }),
      makeCapability({ id: "a.first" }),
    ]);

    expect(registry.list().map((entry) => entry.id)).toEqual(["a.first", "z.last"]);
    expect(registry.list()[0]).not.toHaveProperty("execute");
    expect(registry.get("a.first")).toBeDefined();
  });

  it("rejects duplicate, malformed, and unsupported registrations", () => {
    expect(() => new CapabilityRegistry([
      makeCapability(),
      makeCapability(),
    ])).toThrowError(new CapabilityRegistryError("CAPABILITY_DUPLICATE_ID", 'Capability "test.echo" is already registered.'));

    expect(() => new CapabilityRegistry([
      makeCapability({ id: "not an opaque id" }),
    ])).toThrowError(CapabilityRegistryError);

    expect(() => new CapabilityRegistry([
      makeCapability({ contractVersion: 99 as typeof CAPABILITY_CONTRACT_VERSION }),
    ])).toThrowError(CapabilityRegistryError);

    expect(() => new CapabilityRegistry([
      makeCapability({ supportedRecipeVersions: [2] }),
    ])).toThrowError(CapabilityRegistryError);
  });

  it("fails closed for unknown IDs, malformed input, and unsupported recipe versions", async () => {
    const registry = new CapabilityRegistry([makeCapability()]);
    const context = { rootPath: "/server/project", operation: "recipe" };

    await expect(registry.invoke("missing", 1, { message: "ok" }, context)).resolves.toMatchObject({
      ok: false,
      code: "CAPABILITY_UNKNOWN_ID",
    });
    await expect(registry.invoke("test.echo", 2, { message: "ok" }, context)).resolves.toMatchObject({
      ok: false,
      code: "CAPABILITY_RECIPE_VERSION_UNSUPPORTED",
    });
    await expect(registry.invoke("test.echo", 1, { message: "" }, context)).resolves.toMatchObject({
      ok: false,
      code: "CAPABILITY_INPUT_INVALID",
    });
  });

  it("rejects model-controlled process and profile controls before the adapter runs", async () => {
    const execute = vi.fn().mockReturnValue({ message: "should not run" });
    const registry = new CapabilityRegistry([makeCapability({ execute })]);
    const context = { rootPath: "/server/project", operation: "recipe" };
    const controls = [
      { message: "ok", command: "rm -rf /" },
      { message: "ok", argv: ["--unsafe"] },
      { message: "ok", cwd: "/outside" },
      { message: "ok", environment: { SECRET: "no" } },
      { message: "ok", profile: "unapproved" },
      { message: "ok", nested: { executablePath: "/tmp/tool" } },
    ];

    for (const input of controls) {
      await expect(registry.invoke("test.echo", 1, input, context)).resolves.toMatchObject({
        ok: false,
        code: "CAPABILITY_INPUT_INVALID",
      });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("enforces operation and server-owned approved profile policy", async () => {
    const registry = new CapabilityRegistry([makeCapability({
      policy: {
        ...DEFAULT_CAPABILITY_POLICY,
        allowedOperations: ["approved-operation"],
        approvedCommandProfiles: ["safe-check"],
      },
    })]);
    const input = { message: "ok" };

    await expect(registry.invoke("test.echo", 1, input, {
      rootPath: "/server/project",
      operation: "wrong-operation",
      approvedCommandProfiles: new Set(["safe-check"]),
    })).resolves.toMatchObject({ ok: false, code: "CAPABILITY_OPERATION_NOT_ALLOWED" });

    await expect(registry.invoke("test.echo", 1, input, {
      rootPath: "/server/project",
      operation: "approved-operation",
      approvedCommandProfiles: new Set(["other-check"]),
    })).resolves.toMatchObject({ ok: false, code: "CAPABILITY_PROFILE_NOT_APPROVED" });

    await expect(registry.invoke("test.echo", 1, input, {
      rootPath: "/server/project",
      operation: "approved-operation",
      approvedCommandProfiles: new Set(["safe-check"]),
    })).resolves.toMatchObject({ ok: true, output: { message: "ok" } });
  });

  it("requires server approval for approval-gated capabilities", async () => {
    const registry = new CapabilityRegistry([makeCapability({
      policy: { ...DEFAULT_CAPABILITY_POLICY, requiresApproval: true },
    })]);
    const context = { rootPath: "/server/project", operation: "recipe" };

    await expect(registry.invoke("test.echo", 1, { message: "ok" }, context)).resolves.toMatchObject({
      ok: false,
      code: "CAPABILITY_APPROVAL_REQUIRED",
    });
    await expect(registry.invoke("test.echo", 1, { message: "ok" }, {
      ...context,
      approvalState: "APPROVED",
    })).resolves.toMatchObject({ ok: true });
  });

  it("bounds output and rejects output outside the registered schema", async () => {
    const registry = new CapabilityRegistry([makeCapability({
      policy: { ...DEFAULT_CAPABILITY_POLICY, maxOutputBytes: 20 },
      execute: () => ({ message: "this output is too long" }),
    })]);
    await expect(registry.invoke("test.echo", 1, { message: "ok" }, {
      rootPath: "/server/project",
      operation: "recipe",
    })).resolves.toMatchObject({ ok: false, code: "CAPABILITY_OUTPUT_TOO_LARGE" });

    const invalidOutput = new CapabilityRegistry([makeCapability({
      execute: () => ({ unexpected: true }),
    })]);
    await expect(invalidOutput.invoke("test.echo", 1, { message: "ok" }, {
      rootPath: "/server/project",
      operation: "recipe",
    })).resolves.toMatchObject({ ok: false, code: "CAPABILITY_OUTPUT_INVALID" });
  });
});