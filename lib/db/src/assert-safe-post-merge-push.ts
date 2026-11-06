import { pool } from "./index.js";
import { assertSafePostMergeSchemaPush } from "./schema-push-guard.js";

try {
  await assertSafePostMergeSchemaPush({
    query: (sql) => pool.query<{ column_name: string }>(sql),
  });
  console.log("Post-merge schema push guard passed.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Post-merge schema push guard failed.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
