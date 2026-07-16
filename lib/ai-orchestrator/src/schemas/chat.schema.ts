import { z } from "zod";
import type { PendingChange } from "../tools/file-tools.js";

export const ChatResponseSchema = z.object({
  response: z.string().min(1),
  sources: z.array(z.string()).default([]),
});

/**
 * ChatOutput extends the LLM schema result with an optional array of file
 * changes the model has proposed. These are never applied automatically —
 * the user must approve them through the dashboard UI.
 */
export type ChatOutput = z.infer<typeof ChatResponseSchema> & {
  pendingChanges?: PendingChange[];
};
