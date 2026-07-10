import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

// ── Security hardening ──────────────────────────────────────────────────────

// Trust exactly one reverse-proxy hop (Replit's proxy layer) so that
// express-rate-limit reads the real client IP from X-Forwarded-For rather
// than always seeing the proxy IP (which would cause everyone to share one
// rate-limit bucket).
app.set("trust proxy", 1);

app.use(helmet({
  // Allow inline scripts/styles for the Vite dev banner in development
  contentSecurityPolicy: process.env.NODE_ENV === "production",
}));

// Rate limiting: 300 req / 5 min per IP — generous for an internal tool
app.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  }),
);

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
// Cap body size — prevent oversized payload attacks
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", router);

// Centralized error handler — maps Zod validation errors to 400, everything else to 500.
// In production, internal error details are never forwarded to the client.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err && typeof err === "object" && "issues" in err) {
    return res.status(400).json({ error: "Validation error", issues: (err as { issues: unknown[] }).issues });
  }
  const isProd = process.env.NODE_ENV === "production";
  const internalMsg = err instanceof Error ? err.message : String(err);
  logger.error({ err }, internalMsg);
  return res.status(500).json({
    error: isProd ? "Internal server error" : internalMsg,
  });
});

export default app;
