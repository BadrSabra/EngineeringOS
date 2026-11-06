import type { RequestHandler } from "express";
import { getStartupMaintenanceReadiness } from "../lib/startup-migrations.js";

type MaintenanceReadiness = ReturnType<typeof getStartupMaintenanceReadiness>;

export function createStartupMaintenanceGate(
  readReadiness: () => MaintenanceReadiness = getStartupMaintenanceReadiness,
): RequestHandler {
  return (_req, res, next) => {
    if (readReadiness().status === "blocked") {
      res.status(503).json({
        status: "blocked",
        error: "startup_maintenance_in_progress",
      });
      return;
    }
    next();
  };
}

export const startupMaintenanceGate = createStartupMaintenanceGate();
