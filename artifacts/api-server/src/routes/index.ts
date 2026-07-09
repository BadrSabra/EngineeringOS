import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import projectsRouter from "./projects.js";
import tasksRouter from "./tasks.js";
import rulesRouter from "./rules.js";
import workflowsRouter from "./workflows.js";
import eventsRouter from "./events.js";
import metricsRouter from "./metrics.js";
import graphRouter from "./graph.js";
import pluginsRouter from "./plugins.js";
import dashboardRouter from "./dashboard.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(tasksRouter);
router.use(rulesRouter);
router.use(workflowsRouter);
router.use(eventsRouter);
router.use(metricsRouter);
router.use(graphRouter);
router.use(pluginsRouter);
router.use(dashboardRouter);

export default router;
