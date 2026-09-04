/**
 * Focused tests for chat-provider routing helpers.
 */
import { describe, expect, it } from "vitest";
import {
  GroqClientError,
  type ProviderId,
} from "@workspace/ai-orchestrator";
import {
  handleOrchestratorError,
  redactUserFacingText,
  redactUserFacingValue,
  providerAvailabilityProjection,
  requestLooksToolBound,
  normalizeProviderFailure,
} from "./ai-route-helpers.js";

describe("requestLooksToolBound", () => {
  it("flags code-analysis style messages as tool-bound", () => {
    expect(requestLooksToolBound("Please analyze the codebase and inspect the file tree")).toBe(true);
    expect(requestLooksToolBound("قم بتحليل الكود وافحص الملفات")).toBe(true);
  });

  it("does not over-trigger on simple greetings", () => {
    expect(requestLooksToolBound("hello there")).toBe(false);
    expect(requestLooksToolBound("شكراً جزيلاً")).toBe(false);
  });
});

describe("provider fallback error normalization", () => {
  it("turns an untyped provider exception into a fallback-worthy error", () => {
    const error = normalizeProviderFailure(new Error("raw parser/provider failure"));

    expect(error).toBeInstanceOf(GroqClientError);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.message).toBe("AI provider request failed");
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.message).not.toContain("raw parser/provider failure");
  });

  it.each([
    [404, "MODEL_NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "SERVER_ERROR"],
  ] as const)("maps an untyped HTTP %s provider error to %s", (status, code) => {
    expect(normalizeProviderFailure({ status }).code).toBe(code);
  });
});

describe("AI user-facing JSON redaction contract", () => {
  it.each([
    {
      name: "analysis result",
      fixture: {
        summary: "See /workspace/projects/demo/src/index.ts",
        sources: ["/tmp/provider-output.txt (request 123e4567-e89b-12d3-a456-426614174000)"],
        trace: {
          file: "/home/runner/workspace/artifacts/api-server/src/routes/ai/analysis.ts",
          requestId: "123e4567-e89b-12d3-a456-426614174000",
        },
      },
    },
    {
      name: "workflow decision",
      fixture: {
        reasoning: "Provider response referenced /var/task/run.log",
        evidence: [{ source: "/mnt/data/evidence.json", id: "550e8400-e29b-41d4-a716-446655440000" }],
      },
    },
    {
      name: "provider error",
      fixture: {
        error: "Provider failed while reading /srv/app/config.json",
        details: { requestId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
      },
    },
  ])("redacts paths and opaque IDs from $name fields", ({ fixture }) => {
    const serialized = JSON.stringify(redactUserFacingValue(fixture));

    expect(serialized).not.toContain("/workspace/");
    expect(serialized).not.toContain("/tmp/");
    expect(serialized).not.toContain("/home/runner/");
    expect(serialized).not.toContain("/var/task/");
    expect(serialized).not.toContain("/mnt/data/");
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    expect(serialized).toContain("[runtime path]");
    expect(serialized).toContain("[internal id]");
  });

  it("redacts standalone provider error text without changing the contract shape", () => {
    expect(redactUserFacingText("failed at /app/run.txt for 123e4567-e89b-12d3-a456-426614174000"))
      .toBe("failed at [runtime path] for [internal id]");
  });

  it("redacts bare provider credentials from legacy history values", () => {
    const legacyTrace = {
      provider: "openrouter",
      detail: "request sk-or-v1-legacy-secret and Google AIza123456789012345678901",
    };
    const redacted = JSON.stringify(redactUserFacingValue(legacyTrace));

    expect(redacted).not.toContain("sk-or-v1-legacy-secret");
    expect(redacted).not.toContain("AIza123456789012345678901");
    expect(redacted).toContain("[redacted credential]");
  });
});

describe("provider health failure contract", () => {
  const provider = "openrouter" as ProviderId;
  const consoleUrl = "https://openrouter.ai/keys";
  const statusUrl = "https://status.openrouter.ai";
  const cases = [
    {
      name: "missing credentials",
      error: new GroqClientError("INVALID_CONFIG", "missing API key"),
      expected: "provider_outage",
    },
    {
      name: "authentication",
      error: new GroqClientError("AUTH_ERROR", "Authorization: Bearer sk-or-v1-secret"),
      expected: "authentication_failed",
    },
    {
      name: "incompatible model",
      error: new GroqClientError("MODEL_NOT_FOUND", "upstream model error: raw upstream detail"),
      expected: "incompatible_model",
    },
    {
      name: "stale catalog",
      error: new GroqClientError("INVALID_CONFIG", "catalog refresh failed: /srv/catalog.ts", {
        context: {
          providerCode: "NO_COMPATIBLE_FREE_MODEL",
          catalogStatus: "failed",
          catalogError: "raw upstream catalog response sk-or-v1-secret",
        },
      }),
      expected: "catalog_stale",
    },
    {
      name: "quota",
      error: new GroqClientError("QUOTA", "quota response contains raw upstream detail"),
      expected: "quota_exhausted",
    },
    {
      name: "rate limit",
      error: new GroqClientError("RATE_LIMITED", "429 raw upstream response"),
      expected: "rate_limited",
    },
    {
      name: "circuit open",
      error: new GroqClientError("MODEL_NOT_FOUND", "circuit detail raw upstream", {
        context: { providerCode: "CIRCUIT_OPEN" },
      }),
      expected: "circuit_open",
    },
    {
      name: "outage",
      error: new GroqClientError("SERVER_ERROR", "provider outage raw upstream"),
      expected: "provider_outage",
    },
  ] as const;

  it.each(cases)("classifies $name with a safe operator action", ({ error, expected }) => {
    const projection = providerAvailabilityProjection(error, provider, consoleUrl, statusUrl);
    expect(projection.availabilityState).toBe(expected);
    expect(projection.operatorAction).toMatch(/retry|configure|replace|select|choose|wait|credits/i);
    expect(JSON.stringify(projection)).not.toContain("sk-or-v1-secret");
    expect(JSON.stringify(projection)).not.toContain("raw upstream");
    expect(JSON.stringify(projection)).not.toContain("/srv/catalog.ts");
  });

  it("keeps circuit-open and stale-catalog failures distinct from incompatible models", () => {
    const stale = providerAvailabilityProjection(
      new GroqClientError("INVALID_CONFIG", "stale", {
        context: { providerCode: "NO_COMPATIBLE_FREE_MODEL", catalogStatus: "empty" },
      }),
      provider,
      consoleUrl,
      statusUrl,
    );
    const circuit = providerAvailabilityProjection(
      new GroqClientError("MODEL_NOT_FOUND", "circuit", {
        context: { providerCode: "CIRCUIT_OPEN" },
      }),
      provider,
      consoleUrl,
      statusUrl,
    );
    const incompatible = providerAvailabilityProjection(
      new GroqClientError("MODEL_NOT_FOUND", "model"),
      provider,
      consoleUrl,
      statusUrl,
    );

    expect(stale.availabilityState).toBe("catalog_stale");
    expect(circuit.availabilityState).toBe("circuit_open");
    expect(incompatible.availabilityState).toBe("incompatible_model");
    expect(stale.catalogStatus).toBe("empty");
  });

  it("renders real provider outages as terminal incomplete reviews", () => {
    let body: Record<string, unknown> | undefined;
    const response = {
      status: () => response,
      json: (value: Record<string, unknown>) => {
        body = value;
        return response;
      },
    } as never;

    expect(handleOrchestratorError(
      new GroqClientError("MODEL_UNAVAILABLE", "raw provider response /srv/provider.ts"),
      response,
      {
        provider,
        incompleteReview: { sessionId: "review-session", failureKind: "PROVIDER_FAILURE" },
      },
    )).toBe(true);
    expect(body).toMatchObject({
      code: "MODEL_UNAVAILABLE",
      incomplete: true,
      outcomeClass: "terminal-incomplete",
      terminalStatus: "INCOMPLETE",
      sessionId: "review-session",
      failureKind: "PROVIDER_FAILURE",
      availabilityState: "incompatible_model",
    });
    expect(JSON.stringify(body)).not.toContain("raw provider response");
  });

  it("serializes only safe provider reference details", () => {
    const error = new GroqClientError("INVALID_CONFIG", "raw /srv/provider.ts sk-or-v1-secret", {
      context: {
        providerCode: "NO_COMPATIBLE_FREE_MODEL",
        providerMessage: "raw upstream message",
        providerModel: "model-free",
        catalogStatus: "failed",
        catalogError: "raw catalog body",
      },
    });
    const context = error.toProviderContext();
    // The SSE route intentionally removes providerMessage before serializing
    // this context; keep that user-facing boundary explicit in the fixture.
    const publicContext = Object.fromEntries(
      Object.entries(context).filter(([key]) => key !== "providerMessage"),
    );
    const serialized = JSON.stringify(publicContext);

    expect(serialized).toContain("NO_COMPATIBLE_FREE_MODEL");
    expect(serialized).toContain("failed");
    expect(serialized).not.toContain("raw upstream message");
    expect(serialized).not.toContain("raw catalog body");
    expect(serialized).not.toContain("sk-or-v1-secret");
    expect(serialized).not.toContain("/srv/provider.ts");
  });
});
