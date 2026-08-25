import { AuditSchemaError, assertAuditOutboxSchema } from "./audit-schema-check.js";
import { pool } from "./index.js";

try {
  await assertAuditOutboxSchema();
  console.log(
    "Audit outbox schema is ready: public.pending_audit_logs has all required columns and index.",
  );
} catch (error) {
  if (error instanceof AuditSchemaError) {
    console.error(`Audit outbox schema check failed: ${error.message}`);
  } else {
    console.error(
      "Audit outbox schema check could not connect to PostgreSQL. Verify DATABASE_URL and database availability.",
      error,
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
