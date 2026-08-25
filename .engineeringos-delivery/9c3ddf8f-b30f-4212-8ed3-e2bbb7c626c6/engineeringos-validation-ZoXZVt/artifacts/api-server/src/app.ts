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

function isAllowedApplicationOrigin(origin: string, req: Request): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    return false;
  }

  const normalizedOrigin = parsed.origin;
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  if (normalizedOrigin === requestOrigin) return true;
  if (config.applicationOrigins.includes(normalizedOrigin)) return true;

  // The development dashboard may run on a local port or a Replit preview
  // domain. These are intentionally not accepted in production.
  if (!config.isProduction) {
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".replit.dev") ||
      hostname.endsWith(".repl.co")
    ) {
      return true;
    }
  }
  return false;
}

function rejectCrossOriginMutations(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  const hasCookies = Boolean(req.get("cookie"));
  const csrfCookie = req.get("cookie")?.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
  const csrfHeader = req.get("x-csrf-token");
  if (
    (origin && !isAllowedApplicationOrigin(origin, req)) ||
    (!origin && fetchSite === "cross-site")
  ) {
    res.status(403).json({
      error: "Cross-origin state-changing requests are not allowed",
      code: "cross_origin_request",
    });
    return;
  }
  // Cookie-authenticated requests without browser provenance headers are
  // accepted only with a matching double-submit CSRF token. Same-origin
  // browser requests retain their normal Fetch Metadata path.
  if (hasCookies && !origin && fetchSite !== "same-origin"
    && (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader)) {
    res.status(403).json({
      error: "CSRF validation failed",
      code: "csrf_failed",
    });
    return;
  }
  next();
}

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
// Never reflect an arbitrary Origin while also enabling credentials. The
// request host and explicitly configured application origins are trusted;
// rejected origins receive no CORS permission and cannot use Clerk cookies.
app.use((req, res, next) =>
  cors({
    credentials: true,
    origin: (origin, callback) => {
      callback(null, origin ? isAllowedApplicationOrigin(origin, req) : false);
    },
  })(req, res, next),
);
// Cap body size — prevent oversized payload attacks
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Health checks must be registered BEFORE Clerk middleware — the deployment
// platform's health probe and uptime monitors don't carry a Clerk session, and
// clerkMiddleware will throw "Missing Clerk Secret Key" if it intercepts any
// request when CLERK_SECRET_KEY is not set (e.g. in a new deployment that has
// not yet been provisioned with Clerk secrets). The healthz route must always
// respond 200 regardless of auth/Clerk configuration state.
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", healthRouter);

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
//
// Skipped in the vitest test environment (NODE_ENV=test): Clerk requires
// CLERK_SECRET_KEY at middleware-mount time, but tests run without Clerk
// credentials. The requireAuth middleware below already injects a synthetic
// "test-user" identity when NODE_ENV=test, so skipping clerkMiddleware here
// does not affect handler behaviour in tests — they still exercise the same
// authContext shape that production code sees.
if (config.nodeEnv !== "test") {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

// Every other route under /api requires a signed-in user (requireAuth =
// authentication: "who is this"). Per-project ownership authorization
// ("which projects can they touch") is enforced per-route via
// requireProjectAccess/requireProjectWriteAccess (for path-param :projectId
// routes) or loadProjectByIdForUser (for routes with projectId in query/body).
// See middlewares/requireProjectAccess.ts.
app.use("/api", rejectCrossOriginMutations, requireAuth, router);

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
