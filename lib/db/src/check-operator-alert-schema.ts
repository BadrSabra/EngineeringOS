import { assertOperatorAlertSchema } from "./operator-alert-schema-check.js";

try {
  await assertOperatorAlertSchema();
  console.log("Operator alert schema is ready: public.operator_alerts has all required columns and index.");
} catch (error) {
  console.error(
    error instanceof Error
      ? `Operator alert schema check failed: ${error.message}`
      : "Operator alert schema check failed. Apply the database schema and retry.",
  );
  process.exitCode = 1;
}