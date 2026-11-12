import { defineConfig } from "drizzle-kit";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the scoped preview.");
}

export default defineConfig({
  schema: path.join(
    __dirname,
    "./src/schema/preview-build-jobs-push-scope.ts",
  ),
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  tablesFilter: ["preview_build_jobs"],
  strict: true,
  verbose: true,
});
