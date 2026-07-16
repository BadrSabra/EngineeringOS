import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes/index.js";
import healthRouter from "./routes/health.js";
import { logger } from "./lib/logger.js";
import { config } from "./config.js";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware.js";
import { requireAuth } from "./middlewares/requireAuth.js";

const app: Express = express();

// Express auto-generates an ETag for every JSON response by default. That
// lets a client (or an intermediate proxy) send a conditional GET later and
// get back a bodyless 304 — which fetch() treats as a failed response
// (response.ok is false for 304), even though the data hasn't "failed",
// it's just being served from the client's own cache validation. All of our
// API data is dynamic and per-user, so there's nothing worth conditionally
// revalidating; disable ETags entirely so every request gets a full 200
// with a real body.
app.disable("etag");

// Clerk's Frontend API proxy must be mounted first — it streams raw bytes
// and only activates in production (see clerkProxyMiddleware.ts).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ── Security hardening ──────────────────────────────────────────────────────

// Trust exactly one reverse-proxy hop (Replit's proxy layer) so that
// express-rate-limit reads the real client IP from X-Forwarded-For rather
// than always seeing the proxy IP (which would cause everyone to share one
// rate-limit bucket).
app.set("trust proxy", 1);

app.use(helmet({
  // Allow inline scripts/styles for the Vite dev banner in development
  contentSecurityPolicy: config.isProduction,
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
app.use(cors({ credentials: true, origin: true }));
// Cap body size — prevent oversized payload attacks
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// API responses are dynamic, per-user, and change frequently — never let a
// browser or intermediate proxy cache them. Without this, a stale response
// (e.g. an empty project list fetched before a project existed) can get
// served from the browser's HTTP cache indefinitely, with no further
// request ever reaching this server, making the UI look permanently broken.
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Health checks stay unauthenticated — uptime monitors and the deployment
// platform's health probe don't carry a Clerk session.
app.use("/api", healthRouter);

// Every other route under /api requires a signed-in user (requireAuth =
// authentication: "who is this"). Per-project ownership authorization
// ("which projects can they touch") is enforced per-route via
// requireProjectAccess/requireProjectWriteAccess (for path-param :projectId
// routes) or loadProjectByIdForUser (for routes with projectId in query/body).
// See middlewares/requireProjectAccess.ts.
app.use("/api", requireAuth, router);

// Centralized error handler — maps Zod validation errors to 400, everything else to 500.
// In production, internal error details are never forwarded to the client.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err && typeof err === "object" && "issues" in err) {
    return res.status(400).json({ error: "Validation error", issues: (err as { issues: unknown[] }).issues });
  }
  const isProd = config.isProduction;
  const internalMsg = err instanceof Error ? err.message : String(err);
  logger.error({ err }, internalMsg);
  return res.status(500).json({
    error: isProd ? "Internal server error" : internalMsg,
  });
});

export default app;
