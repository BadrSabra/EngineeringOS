import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";
import {
  attachDatabasePoolErrorHandler,
  parseDatabasePoolMax,
  readDatabasePoolMetrics,
  type DatabasePoolMetrics,
} from "./pool-runtime.js";

const { Pool } = pg;
const databasePoolMax = parseDatabasePoolMax(process.env.DATABASE_POOL_MAX);

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: databasePoolMax,
});
attachDatabasePoolErrorHandler(pool);
export const db = drizzle(pool, { schema });

export function getDatabasePoolMetrics(): DatabasePoolMetrics {
  return readDatabasePoolMetrics(pool, databasePoolMax);
}

export * from "./schema/index.js";
export {
  AuditSchemaError,
  assertAuditOutboxSchema,
} from "./audit-schema-check.js";
export type { DatabasePoolMetrics } from "./pool-runtime.js";
export {
  OperatorAlertSchemaError,
  assertOperatorAlertSchema,
} from "./operator-alert-schema-check.js";
export {
  APPLICATION_SCHEMA_CONTRACT,
  ApplicationSchemaError,
  applicationSchemaDeliveryCommand,
  assertApplicationSchema,
  assertApplicationSchemaWithClient,
  findApplicationSchemaIssues,
  formatApplicationSchemaIssues,
  readApplicationSchemaSnapshot,
} from "./application-schema-check.js";
export type {
  ApplicationSchemaIssue,
  ApplicationSchemaIssueKind,
  ApplicationSchemaSnapshot,
} from "./application-schema-check.js";
