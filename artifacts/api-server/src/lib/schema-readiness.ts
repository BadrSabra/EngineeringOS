import {
  ApplicationSchemaError,
  assertApplicationSchema,
} from "@workspace/db";

export type SchemaReadiness =
  | { status: "ready"; checkedAt: string }
  | {
      status: "blocked";
      reason: "schema_incomplete" | "schema_unavailable";
      issueCount?: number;
      checkedAt: string;
    };

export function createSchemaReadinessProbe(
  check: () => Promise<{ reason?: "schema_incomplete" | "schema_unavailable"; issueCount?: number }>,
  options: { ttlMs?: number; now?: () => number } = {},
) {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let cached: SchemaReadiness | undefined;
  let cachedAt = 0;
  let inFlight: Promise<SchemaReadiness> | undefined;

  return {
    async read(): Promise<SchemaReadiness> {
      const currentTime = now();
      if (cached && currentTime - cachedAt < ttlMs) return cached;
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const result = await check();
        const checkedAt = new Date(now()).toISOString();
        cachedAt = now();
        cached = result.reason
          ? {
              status: "blocked",
              reason: result.reason,
              ...(result.issueCount === undefined ? {} : { issueCount: result.issueCount }),
              checkedAt,
            }
          : { status: "ready", checkedAt };
        return cached;
      })();
      try {
        return await inFlight;
      } finally {
        inFlight = undefined;
      }
    },
    invalidate(): void {
      cached = undefined;
      cachedAt = 0;
    },
  };
}

const schemaProbe = createSchemaReadinessProbe(async () => {
  try {
    await assertApplicationSchema();
    return {};
  } catch (error) {
    if (error instanceof ApplicationSchemaError) {
      return { reason: "schema_incomplete" as const, issueCount: error.issues.length };
    }
    return { reason: "schema_unavailable" as const };
  }
});

export function getApplicationSchemaReadiness(): Promise<SchemaReadiness> {
  return schemaProbe.read();
}

export function invalidateApplicationSchemaReadiness(): void {
  schemaProbe.invalidate();
}
