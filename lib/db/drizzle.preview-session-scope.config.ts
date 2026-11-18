import { defineConfig } from "drizzle-kit";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the scoped preview.");
}

export default defineConfig({
  schema: path.join(
    __dirname,
    "./src/schema/preview-sessions-push-scope.ts",
  ),
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  tablesFilter: [
    "ai_change_proposals",
    "ai_chat_messages",
    "ai_chat_sessions",
    "preview_agent_nodes",
    "preview_build_jobs",
    "preview_sessions",
    "projects",
  ],
  strict: true,
  verbose: true,
});
