import { Router, type IRouter } from "express";
import discoveryRouter from "./discovery.js";
import projectsRouter from "./projects.js";
import tasksRouter from "./tasks.js";
import rulesRouter from "./rules.js";
import workflowsRouter from "./workflows.js";
import eventsRouter from "./events.js";
import metricsRouter from "./metrics.js";
import graphRouter from "./graph.js";
import pluginsRouter from "./plugins.js";
import dashboardRouter from "./dashboard.js";
import aiRouter from "./ai.js";
import gitRouter from "./git.js";

const router: IRouter = Router();

// Discovery must come before projectsRouter so /projects/discover/:id
// is matched before /projects/:projectId
router.use(discoveryRouter);
router.use(projectsRouter);
router.use(tasksRouter);
router.use(rulesRouter);
router.use(workflowsRouter);
router.use(eventsRouter);
router.use(metricsRouter);
router.use(graphRouter);
router.use(pluginsRouter);
router.use(dashboardRouter);
router.use(aiRouter);
router.use(gitRouter);

export default router;
