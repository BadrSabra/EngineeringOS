import { z } from "zod";

/**
 * Centralized, validated environment configuration.
 *
 * This is the ONLY place in the api-server that should read `process.env`
 * directly. Every other module imports `config` from here instead. This
 * gives us two things a scattered `process.env.X` never can:
 *   1. Fail-fast at startup with a clear message if a required var is
 *      missing or malformed, instead of failing lazily deep in a request.
 *   2. A single, typed source of truth for what the server's runtime
 *      configuration surface actually is.
 */
// PORT is intentionally NOT part of this base schema: it's only meaningful
// to the process that actually binds a listener (src/index.ts), and
// requiring it here would force every module that imports `config` — the
// app, the logger, tests that only exercise the Express app via supertest —
// to have PORT set even though they never open a socket. See `getPort()`
// below for the lazy, listener-only check.
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Comma-separated browser origins that are allowed to call the API with
  // Clerk credentials. The API host itself is always allowed as well.
  APP_ORIGINS: z.string().default(""),
  // Comma-separated Clerk user IDs allowed to change server-wide policy.
  ADMIN_USER_IDS: z.string().default(""),
});

const ApplicationOriginSchema = z
  .string()
  .url()
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a valid URL" });
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      ctx.addIssue({ code: "custom", message: "must use http or https" });
    }
    if (parsed.username || parsed.password) {
      ctx.addIssue({ code: "custom", message: "must not contain credentials" });
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      ctx.addIssue({ code: "custom", message: "must be a bare origin without a path, query, or hash" });
    }
  });

/**
 * Parse the comma-separated browser origin allowlist. Keeping this separate
 * from loadConfig makes the production deployment contract easy to validate
 * without booting Express.
 */
export function parseApplicationOrigins(raw: string, isProduction: boolean): string[] {
  const entries = raw.split(",").map((origin) => origin.trim());
  if (isProduction && (entries.length === 0 || entries.every((origin) => !origin))) {
    throw new Error("APP_ORIGINS must contain at least one approved dashboard origin in production");
  }

  const origins: string[] = [];
  for (const entry of entries.filter(Boolean)) {
    const result = ApplicationOriginSchema.safeParse(entry);
    if (!result.success) {
      const details = result.error.issues.map((issue) => issue.message).join(", ");
      throw new Error(`Invalid APP_ORIGINS entry "${entry}": ${details}`);
    }
    const normalized = new URL(entry).origin;
    if (origins.includes(normalized)) {
      throw new Error(`Duplicate APP_ORIGINS entry "${entry}"`);
    }
    origins.push(normalized);
  }
  return origins;
}

function expandApplicationOriginVariables(raw: string): string {
  return raw.replace(/\$([A-Z][A-Z0-9_]*)/g, (_, name: string) => process.env[name] ?? "");
}

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    isProduction: parsed.data.NODE_ENV === "production",
    logLevel: parsed.data.LOG_LEVEL,
    applicationOrigins: parseApplicationOrigins(
      expandApplicationOriginVariables(parsed.data.APP_ORIGINS),
      parsed.data.NODE_ENV === "production",
    ),
    adminUserIds: parsed.data.ADMIN_USER_IDS.split(",").map((id) => id.trim()).filter(Boolean),
  } as const;
}

export const config = loadConfig();
export type Config = typeof config;

/**
 * Validates and returns PORT. Only called from src/index.ts, right before
 * binding the listener — fails fast with a clear message if PORT is
 * missing or malformed, without forcing every other module that imports
 * `config` to also require a bound port.
 */
export function getPort(): number {
  const result = z.coerce.number().int().positive().safeParse(process.env.PORT);
  if (!result.success) {
    throw new Error(
      `Invalid or missing PORT environment variable: "${process.env.PORT}"`,
    );
  }
  return result.data;
}
