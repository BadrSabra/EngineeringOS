import { createHash } from "node:crypto";
import { z } from "zod";

export const AGENT_STATE_SCHEMA_VERSION = "1" as const;

export const AGENT_STATE_LIMITS = {
  episodeEventPayloadBytes: 32 * 1024,
  observationValueBytes: 16 * 1024,
  effectPayloadBytes: 16 * 1024,
  failureDiagnosisBytes: 8 * 1024,
  strategyCandidateBytes: 32 * 1024,
  episodeReferences: 128,
  observationReferences: 128,
  strategyEpisodes: 64,
} as const;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12 || value === null) return value === null;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function canonicalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key]!)]),
  );
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function canonicalJsonHash(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function boundedJsonSchema(maxBytes: number) {
  return z.unknown().superRefine((value, ctx) => {
    if (!isJsonValue(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value must be bounded JSON" });
      return;
    }
    const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
    if (bytes > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `value exceeds ${maxBytes} bytes`,
      });
    }
  });
}

export function parseBoundedJson(value: unknown, maxBytes: number): JsonValue {
  const parsed = boundedJsonSchema(maxBytes).parse(value);
  return parsed as JsonValue;
}

export function boundedContractSchema<T extends z.ZodTypeAny>(schema: T, maxBytes: number) {
  return schema.superRefine((value, ctx) => {
    if (!isJsonValue(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "contract must be bounded JSON" });
      return;
    }
    if (Buffer.byteLength(canonicalJson(value), "utf8") > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `contract exceeds ${maxBytes} bytes`,
      });
    }
  });
}

export function boundedString(maxLength: number) {
  return z.string().min(1).max(maxLength);
}

export function safePublicString(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\/(?:home\/runner(?:\/workspace)?|workspace|tmp|app|srv|var\/task|mnt\/data)\/\S+/g, "[runtime path]")
    .replace(/\b(?:bearer|token|secret|password|api[_ -]?key)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .slice(0, maxLength);
}

export type { JsonValue };