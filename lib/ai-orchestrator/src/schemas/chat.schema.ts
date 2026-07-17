import { z } from "zod";
import path from "node:path";

/**
 * Runtime schema for a proposed file change.
 *
 * PendingChange objects are produced server-side by executeFileTool and are
 * never written by the model directly. The schema exists for two reasons:
 *   1. Defence against bugs in executeFileTool that might produce a malformed
 *      object before it is stored or returned to the client.
 *   2. Validation of the inbound payload when the apply-changes endpoint
 *      receives a PendingChange from the dashboard — `absolutePath` is used
 *      to determine where to write on disk, so it must be verifiably absolute
 *      before the secondary safePath check runs.
 *
 * Field constraints mirror the guarantees provided by file-tools.ts:
 *   path           — normalized relative path (never empty after path.relative)
 *   absolutePath   — absolute OS path; the refine guard enforces this
 *                    structurally so a relative string cannot slip through
 *   newContent     — no min(1): an empty string is a valid "empty the file"
 *   originalContent — null when the file does not yet exist
 *   reason         — non-empty one-sentence explanation from the model
 *
 * .strict() rejects any unrecognised field — a PendingChange with extra keys
 * is a sign of a malformed or tampered payload.
 */
export const PendingChangeSchema = z
  .object({
    path: z.string().min(1),
    absolutePath: z
      .string()
      .min(1)
      .refine(path.isAbsolute, { message: "absolutePath must be an absolute filesystem path" }),
    newContent: z.string(),
    originalContent: z.string().nullable(),
    reason: z.string().min(1),
  })
  .strict();

export type PendingChange = z.infer<typeof PendingChangeSchema>;

export const ChatResponseSchema = z.object({
  response: z.string().min(1),
  sources: z.array(z.string()).default([]),
});

/**
 * ChatOutput is the full return value of the chat agent. The LLM-authored
 * fields (response, sources) come from ChatResponseSchema. pendingChanges
 * is appended server-side after the tool loop — it is never written by the
 * model — but it is typed here via PendingChangeSchema so the shape is a
 * single source of truth for both TypeScript and runtime validation.
 */
export type ChatOutput = z.infer<typeof ChatResponseSchema> & {
  pendingChanges?: PendingChange[];
};
