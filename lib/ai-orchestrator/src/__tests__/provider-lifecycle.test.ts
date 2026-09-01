import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateGroqDefaultModels } from "../groq-client.js";
import { GroqClientError } from "../errors.js";
import {
  _resetProviderLifecycleForTest,
  getProviderLifecycleSnapshot,
  invalidateProviderLifecycle,
} from "../provider-lifecycle.js";

vi.mock("../groq-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../groq-client.js")>();
  return {
    ...actual,
    validateGroqDefaultModels: vi.fn(async (_apiKey: string, defaults: { fast: string; powerful: string }) => ({
      valid: true,
      missing: [],
      checkedModels: { ...defaults },
    })),
  };
});

describe("provider lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    vi.mocked(validateGroqDefaultModels).mockReset();
    vi.mocked(validateGroqDefaultModels).mockImplementation(async (_apiKey, defaults = { fast: "", powerful: "" }) => ({
      valid: true,
      missing: [],
      checkedModels: {
        fast: defaults.fast ?? "",
        powerful: defaults.powerful ?? "",
      },
    }));
    _resetProviderLifecycleForTest();
  });

  it("deduplicates checks and refreshes after the TTL", async () => {
    const first = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-test-key",
      source: "user",
      check: true,
    });
    const cached = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-test-key",
      source: "user",
      check: true,
    });

    expect(cached.revision).toBe(first.revision);
    expect(validateGroqDefaultModels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60_000 + 1);
    const refreshed = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-test-key",
      source: "user",
      check: true,
    });
    expect(refreshed.revision).toBeGreaterThan(first.revision);
    expect(validateGroqDefaultModels).toHaveBeenCalledTimes(2);
  });

  it("keeps a selectable last-known-good snapshot during a transient refresh failure", async () => {
    const healthy = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-lkg-key",
      source: "user",
      check: true,
    });
    vi.mocked(validateGroqDefaultModels).mockRejectedValueOnce(
      new GroqClientError("SERVER_ERROR", "transient provider failure"),
    );
    vi.advanceTimersByTime(5 * 60_000 + 1);

    const degraded = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-lkg-key",
      source: "user",
      check: true,
    });
    expect(healthy.selectable).toBe(true);
    expect(degraded.selectable).toBe(true);
    expect(degraded.overallStatus).toBe("degraded");
    expect(degraded.reasonCodes).toContain("catalog_temporarily_unavailable");
  });

  it("fails closed on authentication failure and isolates source and key identity", async () => {
    vi.mocked(validateGroqDefaultModels).mockRejectedValueOnce(
      new GroqClientError("AUTH_ERROR", "credential rejected"),
    );
    const invalid = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-invalid-key",
      source: "user",
      check: true,
    });
    expect(invalid.selectable).toBe(false);
    expect(invalid.credentialStatus).toBe("credentials_invalid");
    expect(invalid.reasonCodes).toContain("credentials_invalid");

    const server = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-invalid-key",
      source: "server",
      check: false,
    });
    expect(server.source).toBe("server");
    expect(server.keyIdentity).toBe(invalid.keyIdentity);
    expect(server.credentialStatus).toBe("credentials_unchecked");
  });

  it("forces a fresh check after invalidation", async () => {
    const first = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-invalidate-key",
      source: "user",
      check: true,
    });
    invalidateProviderLifecycle("groq", "user", "groq-invalidate-key");
    const refreshed = await getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-invalidate-key",
      source: "user",
      check: true,
    });
    expect(refreshed.revision).toBeGreaterThan(first.revision);
    expect(validateGroqDefaultModels).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight check between concurrent callers", async () => {
    let release!: () => void;
    vi.mocked(validateGroqDefaultModels).mockImplementationOnce(
      (_apiKey, defaults = { fast: "", powerful: "" }) => new Promise((resolve) => {
        release = () => resolve({
          valid: true,
          missing: [],
          checkedModels: {
            fast: defaults.fast ?? "",
            powerful: defaults.powerful ?? "",
          },
        });
      }),
    );

    const first = getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-concurrent-key",
      source: "user",
      check: true,
    });
    const second = getProviderLifecycleSnapshot({
      provider: "groq",
      apiKey: "groq-concurrent-key",
      source: "user",
      check: true,
    });
    release();

    const [left, right] = await Promise.all([first, second]);
    expect(left.revision).toBe(right.revision);
    expect(validateGroqDefaultModels).toHaveBeenCalledTimes(1);
  });
});