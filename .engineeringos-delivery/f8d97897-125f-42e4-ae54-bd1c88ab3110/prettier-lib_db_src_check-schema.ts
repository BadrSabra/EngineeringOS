import {
  ApplicationSchemaError,
  assertApplicationSchema,
  applicationSchemaDeliveryCommand,
} from "./application-schema-check.js";
import { pool } from "./index.js";

try {
  await assertApplicationSchema();
  console.log(
    "Application schema is ready: public.tasks and public.task_logs satisfy the release contract.",
  );
} catch (error) {
  if (error instanceof ApplicationSchemaError) {
    console.error(`Application schema check failed: ${error.message}`);
  } else {
    console.error(
      `Application schema check could not connect to PostgreSQL. Run \`${applicationSchemaDeliveryCommand}\` after verifying DATABASE_URL and database availability.`,
    );
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
