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
    vi.unstubAllGlobals();
    for (const name of providerEnvironments) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete process.env.AI_VALIDATE_GEMINI_MODELS;
    delete process.env.RUN_CONTROLLED_RELEASE_VALIDATION;
    delete process.env.GEMINI_MODEL_CHECK_FIXTURE_MODE;
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

  it("publishes a safe callback when the Groq catalog check is temporarily unavailable", async () => {
    process.env.GROQ_API_KEY = "valid-groq-key";
    vi.doMock("groq-sdk", () => ({
      default: class {
        models = {
          list: vi.fn().mockRejectedValue(new Error("network failure apiKey=valid-groq-key")),
        };
      },
    }));

    const onUnavailable = vi.fn();
    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    const results = await validateAiProvidersAtStartup({
      onGroqModelCatalogUnavailable: onUnavailable,
    });
    const groq = results.find((result) => result.provider === "groq");

    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onUnavailable.mock.calls)).not.toContain("valid-groq-key");
    expect(groq).toMatchObject({
      provider: "groq",
      valid: true,
      modelCheck: "unavailable",
    });
  });

  it("does not contact Gemini during ordinary startup", async () => {
    process.env.GEMINI_API_KEY = "valid-gemini-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    const results = await validateAiProvidersAtStartup();
    const gemini = results.find((result) => result.provider === "gemini");

    expect(gemini).toMatchObject({
      provider: "gemini",
      valid: true,
      modelCheck: "skipped",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports Gemini retired defaults when the opt-in catalog check finds drift", async () => {
    process.env.GEMINI_API_KEY = "valid-gemini-key";
    process.env.AI_VALIDATE_GEMINI_MODELS = "1";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [],
      }),
    }) as Response));

    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    const results = await validateAiProvidersAtStartup();
    const gemini = results.find((result) => result.provider === "gemini");

    expect(gemini).toMatchObject({
      provider: "gemini",
      valid: false,
      modelCheck: "missing",
    });
    expect(gemini?.reason).toContain("Update the Gemini default model IDs");
    expect(gemini?.reason).not.toContain("valid-gemini-key");
  });

  it("keeps Gemini usable when its opt-in availability check is transiently unavailable", async () => {
    process.env.GEMINI_API_KEY = "valid-gemini-key";
    process.env.AI_VALIDATE_GEMINI_MODELS = "1";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: "temporary outage" } }),
    }) as Response));

    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    const results = await validateAiProvidersAtStartup();
    const gemini = results.find((result) => result.provider === "gemini");

    expect(gemini).toMatchObject({
      provider: "gemini",
      valid: true,
      modelCheck: "unavailable",
    });
  });

  it("confirms Gemini when both configured defaults are present", async () => {
    process.env.GEMINI_API_KEY = "valid-gemini-key";
    process.env.AI_VALIDATE_GEMINI_MODELS = "1";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [{ name: "models/gemini-3-flash-preview" }],
      }),
    }) as Response));

    const { validateAiProvidersAtStartup } = await import("../startup-validator.js");
    const results = await validateAiProvidersAtStartup();
    const gemini = results.find((result) => result.provider === "gemini");

    expect(gemini).toMatchObject({
      provider: "gemini",
      valid: true,
      modelCheck: "passed",
    });
  });
});
