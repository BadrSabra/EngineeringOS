import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerEnvironments = [
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "GROQ_API_KEY",
] as const;
const originalEnvironment = Object.fromEntries(
  providerEnvironments.map((name) => [name, process.env[name]]),
);

describe("validateAiProvidersAtStartup", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const name of providerEnvironments) delete process.env[name];
  });

  afterEach(() => {
    vi.doUnmock("groq-sdk");
    for (const name of providerEnvironments) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("marks Groq invalid with an actionable reason when a default is retired", async () => {
    process.env.GROQ_API_KEY = "valid-groq-key";
    vi.doMock("groq-sdk", () => ({
      default: class {
        models = {
          list: vi.fn().mockResolvedValue({
            object: "list",
            data: [{ id: "openai/gpt-oss-20b" }],
          }),
        };
      },
    }));

    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    const results = await validateAiProvidersAtStartup();
    const groq = results.find((result) => result.provider === "groq");

    expect(groq).toMatchObject({
      provider: "groq",
      valid: false,
      modelCheck: "missing",
    });
    expect(groq?.reason).toContain("openai/gpt-oss-120b");
    expect(groq?.reason).toContain("Update the Groq default model IDs");
    expect(groq?.reason).not.toContain("valid-groq-key");
  });

  it("confirms Groq only after both defaults are present in the catalog", async () => {
    process.env.GROQ_API_KEY = "valid-groq-key";
    vi.doMock("groq-sdk", () => ({
      default: class {
        models = {
          list: vi.fn().mockResolvedValue({
            object: "list",
            data: [
              { id: "openai/gpt-oss-20b" },
              { id: "openai/gpt-oss-120b" },
            ],
          }),
        };
      },
    }));

    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    const results = await validateAiProvidersAtStartup();
    const groq = results.find((result) => result.provider === "groq");

    expect(groq).toMatchObject({
      provider: "groq",
      valid: true,
      modelCheck: "passed",
    });
  });

  it("publishes one safe callback per missing model role", async () => {
    process.env.GROQ_API_KEY = "valid-groq-key";
    vi.doMock("groq-sdk", () => ({
      default: class {
        models = {
          list: vi.fn().mockResolvedValue({
            object: "list",
            data: [],
          }),
        };
      },
    }));

    const onDrift = vi.fn();
    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    await validateAiProvidersAtStartup({ onGroqModelCatalogDrift: onDrift });

    expect(onDrift).toHaveBeenCalledTimes(2);
    expect(onDrift).toHaveBeenCalledWith({
      role: "fast",
      modelId: "openai/gpt-oss-20b",
    });
    expect(onDrift).toHaveBeenCalledWith({
      role: "powerful",
      modelId: "openai/gpt-oss-120b",
    });
    expect(JSON.stringify(onDrift.mock.calls)).not.toContain("valid-groq-key");
  });

  it("keeps healthy and unconfigured Groq checks quiet", async () => {
    const onDrift = vi.fn();
    const onHealthy = vi.fn();
    const onNotConfigured = vi.fn();
    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    await validateAiProvidersAtStartup({
      onGroqModelCatalogDrift: onDrift,
      onGroqModelCatalogHealthy: onHealthy,
      onGroqModelCatalogNotConfigured: onNotConfigured,
    });

    expect(onDrift).not.toHaveBeenCalled();
    expect(onHealthy).not.toHaveBeenCalled();
    expect(onNotConfigured).toHaveBeenCalledTimes(1);
  });
});