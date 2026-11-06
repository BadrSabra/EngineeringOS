export interface SchemaGuardQueryClient {
  query(sql: string): Promise<{ rows: { column_name: string }[] }>;
}

const EXPECTED_COOLDOWN_PRIMARY_KEY = ["credential_fingerprint"];

/**
 * Drizzle Kit's non-interactive dev push can replace this existing primary
 * key. Fail closed unless the live key already matches the intended schema.
 */
export async function assertSafePostMergeSchemaPush(
  client: SchemaGuardQueryClient,
): Promise<void> {
  const result = await client.query(`
    SELECT attribute.attname AS column_name
    FROM pg_constraint constraint_row
    JOIN pg_class table_relation
      ON table_relation.oid = constraint_row.conrelid
    JOIN pg_namespace table_namespace
      ON table_namespace.oid = table_relation.relnamespace
    CROSS JOIN LATERAL unnest(constraint_row.conkey)
      WITH ORDINALITY AS primary_key_column(attnum, ordinal)
    JOIN pg_attribute attribute
      ON attribute.attrelid = table_relation.oid
     AND attribute.attnum = primary_key_column.attnum
    WHERE table_namespace.nspname = 'public'
      AND table_relation.relname = 'openrouter_credential_cooldowns'
      AND constraint_row.contype = 'p'
    ORDER BY primary_key_column.ordinal
  `);
  const actual = result.rows.map((row) => row.column_name);
  if (
    actual.length !== EXPECTED_COOLDOWN_PRIMARY_KEY.length ||
    actual.some((column, index) => column !== EXPECTED_COOLDOWN_PRIMARY_KEY[index])
  ) {
    throw new Error(
      `Refusing non-interactive schema push: expected openrouter_credential_cooldowns PRIMARY KEY ` +
        `(${EXPECTED_COOLDOWN_PRIMARY_KEY.join(", ")}), found ${actual.length ? `(${actual.join(", ")})` : "no primary key"}.`,
    );
  }
}
