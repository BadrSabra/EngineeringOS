/**
 * AI route hub — composes all AI subrouters into a single Express Router.
 *
 * Subroutes:
 *   providers  — deepseek/groq key management, active-provider
 *   chat       — chat, stream, sessions, messages, apply-changes
 *   analysis   — scan analysis, code review
 *   workflows  — workflow orchestration
 *   tasks      — task execution + scheduleAiTaskExecution
 */
import { Router } from "express";
import providersRouter from "./providers.js";
import chatRouter from "./chat.js";
import analysisRouter from "./analysis.js";
import workflowsRouter from "./workflows.js";
import tasksRouter from "./tasks.js";

export { scheduleAiTaskExecution } from "./tasks.js";

const router = Router();

router.use(providersRouter);
router.use(chatRouter);
router.use(analysisRouter);
router.use(workflowsRouter);
router.use(tasksRouter);

export default router;
