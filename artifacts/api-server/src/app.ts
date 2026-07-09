import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Centralized error handler — maps Zod validation errors to 400, everything else to 500
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err && typeof err === "object" && "issues" in err) {
    return res.status(400).json({ error: "Validation error", issues: (err as { issues: unknown[] }).issues });
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  logger.error({ err }, message);
  return res.status(500).json({ error: message });
});

export default app;
