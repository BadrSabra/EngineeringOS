import { pgTable, text, timestamp, real, pgEnum, index } from "drizzle-orm/pg-core";

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "scanning",
  "paused",
  "archived",
]);

export const projectsTable = pgTable("projects", {
  id: text("id").primaryKey(),
  /**
   * The Clerk user id (see requireAuth.ts) that owns this project. Every
   * project mutation/read route scopes on this column — there is no
   * team/org sharing yet, just single-owner access. Not nullable: every
   * project is created through POST /projects, which always stamps
   * ownerId from the authenticated request, never from client input.
   */
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  rootPath: text("root_path").notNull().unique(),
  language: text("language").notNull(),
  framework: text("framework"),
  status: projectStatusEnum("status").notNull().default("active"),
  qualityScore: real("quality_score"),
  lastScanAt: timestamp("last_scan_at"),
  /** HTTPS remote URL for git push/pull — e.g. https://github.com/user/repo.git */
  gitRemoteUrl: text("git_remote_url"),
  /** Default branch to push to — e.g. main */
  gitDefaultBranch: text("git_default_branch"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_projects_owner_id").on(t.ownerId),
  index("idx_projects_status").on(t.status),
]);

export type InsertProject = typeof projectsTable.$inferInsert;
export type Project = typeof projectsTable.$inferSelect;
