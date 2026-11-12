import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for the approved development preview.");
}

export default defineConfig({
  schema: path.join(
    __dirname,
    "./src/schema/preview-build-jobs-push-scope.ts",
  ),
  dialect: "postgresql",
  tablesFilter: ["preview_build_jobs"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
