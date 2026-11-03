import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const catalogSnapshotOnly =
  process.env.SCHEMA_APPLY_OPENROUTER_CATALOG_ONLY === "1";
const strictPreview = process.env.SCHEMA_APPLY_STRICT_PREVIEW === "1";

export default defineConfig({
  schema: path.join(
    __dirname,
    catalogSnapshotOnly
      ? "./src/schema/openrouter_catalog_snapshots.ts"
      : "./src/schema/index.ts",
  ),
  dialect: "postgresql",
  ...(catalogSnapshotOnly
    ? {
        strict: strictPreview,
        verbose: true,
      }
    : {}),
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
