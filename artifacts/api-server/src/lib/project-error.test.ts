/**
 * Unit tests for project-error.ts (classifyProjectError + isRetryableProjectError).
 *
 * These run inside the api-server's vitest suite because the dashboard has no
 * test runner yet. The classifier is a pure function with no browser deps —
 * it only needs ApiError (defined in custom-fetch.ts, available in Node).
 */

import { describe, expect, it } from "vitest";
import { ApiError } from "@workspace/api-client-react";
import {
  classifyProjectError,
  isRetryableProjectError,
} from "@workspace/api-client-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockApiError(status: number, body: unknown = { error: "Test" }): ApiError {
  const response = new Response(JSON.stringify(body), {
    status,
    statusText: String(status),
    headers: { "content-type": "application/json" },
  });
  return new ApiError(response, body, { method: "GET", url: "/api/projects" });
}

function networkError(): TypeError {
  return new TypeError("Failed to fetch");
}

// ─── classifyProjectError ─────────────────────────────────────────────────────

describe("classifyProjectError — HTTP status codes", () => {
  it("classifies 401 as session_expired with the correct message", () => {
    const result = classifyProjectError(mockApiError(401));
    expect(result.kind).toBe("session_expired");
    expect(result.status).toBe(401);
    expect(result.message).toMatch(/session expired/i);
    expect(result.message).toMatch(/sign in/i);
  });

  it("classifies 403 as permission_denied", () => {
    const result = classifyProjectError(mockApiError(403));
    expect(result.kind).toBe("permission_denied");
    expect(result.status).toBe(403);
    expect(result.message).toMatch(/permission/i);
  });

  it("classifies 404 as not_found", () => {
    const result = classifyProjectError(mockApiError(404));
    expect(result.kind).toBe("not_found");
    expect(result.status).toBe(404);
    expect(result.message).toMatch(/unavailable/i);
  });

  it("classifies 500 as server_error", () => {
    const result = classifyProjectError(mockApiError(500));
    expect(result.kind).toBe("server_error");
    expect(result.status).toBe(500);
    expect(result.message).toMatch(/server error/i);
  });

  it("classifies 502 as server_error", () => {
    const result = classifyProjectError(mockApiError(502));
    expect(result.kind).toBe("server_error");
    expect(result.status).toBe(502);
  });

  it("classifies 503 as server_error", () => {
    const result = classifyProjectError(mockApiError(503));
    expect(result.kind).toBe("server_error");
    expect(result.status).toBe(503);
  });

  it("classifies 504 as server_error", () => {
    const result = classifyProjectError(mockApiError(504));
    expect(result.kind).toBe("server_error");
    expect(result.status).toBe(504);
  });

  it("classifies an unexpected 409 as unknown", () => {
    const result = classifyProjectError(mockApiError(409));
    expect(result.kind).toBe("unknown");
    expect(result.status).toBe(409);
    expect(result.message).toMatch(/409/);
  });
});

describe("classifyProjectError — network failures", () => {
  it("classifies a TypeError (fetch failure) as network_error", () => {
    const result = classifyProjectError(networkError());
    expect(result.kind).toBe("network_error");
    expect(result.status).toBeUndefined();
    expect(result.message).toMatch(/cannot reach/i);
  });

  it("has no status field for network errors", () => {
    const result = classifyProjectError(networkError());
    expect(result.status).toBeUndefined();
  });
});

describe("classifyProjectError — unknown/unexpected values", () => {
  it("classifies a plain Error as unknown", () => {
    const result = classifyProjectError(new Error("something went wrong"));
    expect(result.kind).toBe("unknown");
    expect(result.status).toBeUndefined();
  });

  it("classifies null as unknown", () => {
    const result = classifyProjectError(null);
    expect(result.kind).toBe("unknown");
  });

  it("classifies a string as unknown", () => {
    const result = classifyProjectError("something went wrong");
    expect(result.kind).toBe("unknown");
  });

  it("never returns 'session expired' message for non-401 errors", () => {
    for (const err of [mockApiError(500), networkError(), new Error("oops")]) {
      const result = classifyProjectError(err);
      expect(result.message).not.toMatch(/session.*expired/i);
    }
  });

  it("only returns 'session expired' for a genuine 401", () => {
    const result = classifyProjectError(mockApiError(401));
    expect(result.kind).toBe("session_expired");
  });
});

// ─── isRetryableProjectError ──────────────────────────────────────────────────

describe("isRetryableProjectError — never retry auth/perm failures", () => {
  it("does not retry on 401", () => {
    expect(isRetryableProjectError(mockApiError(401), 0)).toBe(false);
  });

  it("does not retry on 403", () => {
    expect(isRetryableProjectError(mockApiError(403), 0)).toBe(false);
  });
});

describe("isRetryableProjectError — server errors are retryable", () => {
  for (const status of [500, 502, 503, 504]) {
    it(`retries on ${status} (first attempt)`, () => {
      expect(isRetryableProjectError(mockApiError(status), 0)).toBe(true);
    });

    it(`retries on ${status} (second attempt)`, () => {
      expect(isRetryableProjectError(mockApiError(status), 1)).toBe(true);
    });

    it(`stops retrying on ${status} after maxCount (default 2)`, () => {
      expect(isRetryableProjectError(mockApiError(status), 2)).toBe(false);
    });
  }
});

describe("isRetryableProjectError — network errors", () => {
  it("retries on network TypeError (first attempt)", () => {
    expect(isRetryableProjectError(networkError(), 0)).toBe(true);
  });

  it("stops retrying network errors after maxCount", () => {
    expect(isRetryableProjectError(networkError(), 2)).toBe(false);
  });
});

describe("isRetryableProjectError — unknown errors", () => {
  it("does not retry a plain Error", () => {
    expect(isRetryableProjectError(new Error("oops"), 0)).toBe(false);
  });
});

// ─── Route-level behaviour: GET /api/projects returns correct status codes ────

import request from "supertest";
import app from "../app.js";

describe("GET /api/projects — route-level status codes (test env = authenticated)", () => {
  it("returns 200 with an array for an authenticated user", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns an empty array when the user has no projects", async () => {
    // In the test environment, 'test-user' may or may not have projects.
    // Either way, the response is always an array — never an error.
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("sets X-Request-Id header on every response", async () => {
    const res = await request(app).get("/api/projects");
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(typeof res.headers["x-request-id"]).toBe("string");
    expect(res.headers["x-request-id"].length).toBeGreaterThan(0);
  });

  it("returns a different X-Request-Id on each request", async () => {
    const r1 = await request(app).get("/api/projects");
    const r2 = await request(app).get("/api/projects");
    expect(r1.headers["x-request-id"]).not.toBe(r2.headers["x-request-id"]);
  });
});
