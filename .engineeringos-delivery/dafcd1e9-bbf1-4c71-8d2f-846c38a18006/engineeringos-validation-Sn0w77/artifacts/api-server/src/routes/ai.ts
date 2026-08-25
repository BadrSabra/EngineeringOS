/**
 * AI route barrel — re-exports the composed router and public helpers from
 * the subroute modules in routes/ai/.
 *
 * Kept as a single file so existing imports (`import { scheduleAiTaskExecution }
 * from "./ai.js"` in routes/tasks.ts) continue to work without changes.
 */
export { default, scheduleAiTaskExecution } from "./ai/index.js";
