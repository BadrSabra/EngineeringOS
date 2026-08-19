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
});

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
