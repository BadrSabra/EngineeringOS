import { describe, it, expect } from "vitest";
import { z } from "zod";
import { extractJson, parseAgentResponse } from "../parsing.js";

const schema = z.object({ foo: z.string(), count: z.number() });
const fallback = (raw: string) => ({ foo: `fallback:${raw}`, count: -1 });

describe("extractJson", () => {
  it("parses plain JSON", () => {
    const result = extractJson('{"foo":"bar","count":1}');
    expect(result).toEqual({ ok: true, data: { foo: "bar", count: 1 } });
  });

  it("parses JSON inside ```json code fences", () => {
    const result = extractJson('```json\n{"foo":"bar","count":1}\n```');
    expect(result).toEqual({ ok: true, data: { foo: "bar", count: 1 } });
  });

  it("parses JSON inside plain ``` code fences", () => {
    const result = extractJson('```\n{"foo":"bar","count":1}\n```');
    expect(result).toEqual({ ok: true, data: { foo: "bar", count: 1 } });
  });

  it("extracts JSON with commentary before and after", () => {
    const result = extractJson('Sure, here you go:\n{"foo":"bar","count":1}\nHope that helps!');
    expect(result).toEqual({ ok: true, data: { foo: "bar", count: 1 } });
  });

  it("reports EMPTY_MODEL_RESPONSE for an empty string", () => {
    const result = extractJson("");
    expect(result).toEqual({ ok: false, code: "EMPTY_MODEL_RESPONSE", message: expect.any(String) });
  });

  it("reports EMPTY_MODEL_RESPONSE for whitespace-only input", () => {
    const result = extractJson("   \n  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_MODEL_RESPONSE");
  });

  it("reports MALFORMED_JSON for incomplete JSON", () => {
    const result = extractJson('{"foo": "bar", "count":');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_JSON");
  });

  it("reports MALFORMED_JSON for non-JSON prose", () => {
    const result = extractJson("this is not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MALFORMED_JSON");
  });
});

describe("parseAgentResponse", () => {
  it("returns validated data for a well-formed, schema-valid response", () => {
    const result = parseAgentResponse('{"foo":"bar","count":1}', schema, fallback);
    expect(result).toEqual({ ok: true, data: { foo: "bar", count: 1 } });
  });

  it("falls back on empty response without throwing", () => {
    const result = parseAgentResponse("", schema, fallback);
    expect(result.ok).toBe(false);
    expect(result.data).toEqual({ foo: "fallback:", count: -1 });
    if (!result.ok) expect(result.code).toBe("EMPTY_MODEL_RESPONSE");
  });

  it("falls back on malformed JSON without throwing", () => {
    const raw = "{not json";
    const result = parseAgentResponse(raw, schema, fallback);
    expect(result.ok).toBe(false);
    expect(result.data).toEqual({ foo: `fallback:${raw}`, count: -1 });
    if (!result.ok) expect(result.code).toBe("MALFORMED_JSON");
  });

  it("falls back when JSON is valid but fails schema validation (missing field)", () => {
    const raw = '{"foo":"bar"}';
    const result = parseAgentResponse(raw, schema, fallback);
    expect(result.ok).toBe(false);
    expect(result.data).toEqual({ foo: `fallback:${raw}`, count: -1 });
    if (!result.ok) expect(result.code).toBe("SCHEMA_VALIDATION_FAILED");
  });

  it("falls back when JSON is valid but has wrong field types", () => {
    const raw = '{"foo":"bar","count":"not-a-number"}';
    const result = parseAgentResponse(raw, schema, fallback);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SCHEMA_VALIDATION_FAILED");
  });

  it("never throws regardless of input", () => {
    for (const raw of ["", "   ", "not json", "{broken", '{"foo": 1, "count": "x"}', "```json\n\n```"]) {
      expect(() => parseAgentResponse(raw, schema, fallback)).not.toThrow();
    }
  });

  // PR-E: raw string is preserved on failure so callers can surface it in 422 responses.
  it("includes the original raw string in the failure result for EMPTY_MODEL_RESPONSE", () => {
    const result = parseAgentResponse("", schema, fallback);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.raw).toBe("");
  });

  it("includes the original raw string in the failure result for MALFORMED_JSON", () => {
    const raw = "{broken json";
    const result = parseAgentResponse(raw, schema, fallback);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.raw).toBe(raw);
  });

  it("includes the original raw string in the failure result for SCHEMA_VALIDATION_FAILED", () => {
    const raw = '{"foo":"bar"}'; // missing count
    const result = parseAgentResponse(raw, schema, fallback);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.raw).toBe(raw);
      expect(result.code).toBe("SCHEMA_VALIDATION_FAILED");
    }
  });
});
