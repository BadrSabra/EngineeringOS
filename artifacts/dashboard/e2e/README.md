# Dashboard browser journey

This is a release-only real-browser smoke test, separate from the dashboard
Vitest suite. It never calls an AI provider or mutates projects, Git, or
production data.

## Run

The dedicated release validation job starts or selects the existing dashboard
and API workflows. Those workflows use the registered artifact paths and ports:

```sh
PORT=23183 BASE_PATH=/dashboard/ pnpm --filter @workspace/dashboard run dev
PORT=8080 pnpm --filter @workspace/api-server run dev
```

It checks `/dashboard/` and `/api/healthz` before running the journey. To run
the same controlled job locally after starting those workflows:

```sh
RUN_CONTROLLED_RELEASE_VALIDATION=1 \
DASHBOARD_E2E_BASE_URL=https://$REPLIT_DEV_DOMAIN/dashboard/ \
DASHBOARD_E2E_API_HEALTH_URL=https://$REPLIT_DEV_DOMAIN/api/healthz \
pnpm run validate:dashboard-journey
```

The release environment provisions or selects the isolated user named by
`DASHBOARD_E2E_EMAIL` (default:
`engineeringos-dashboard-release@example.com`). The Replit browser runner
provides the `signInClerkUser` helper described in
`.local/skills/clerk-auth-e2e-testing-only/SKILL.md`; the journey invokes that
helper to obtain a short-lived session URL and never fills Clerk forms. When
the release job runs outside that browser runner, it uses `CLERK_SECRET_KEY`
to create the same short-lived Clerk sign-in token through the Backend API.

The API routes used by the journey are intercepted in the browser with
read-only fixtures. This keeps dashboard/project/event success states stable,
uses a controlled execution id for Flight Deck, and returns a deliberate
provider-unavailable response for AI. Routing, Clerk session handoff, and
rendering remain real browser behavior.

## Failure diagnostics

The Playwright config retains traces, screenshots, and video on failure under
`test-results/dashboard-journey`. Check the dashboard and API workflow logs
first, then confirm `BASE_PATH=/dashboard/`, the dashboard/API workflows are
running, both health checks pass, `DASHBOARD_E2E_BASE_URL` includes the
trailing `/dashboard/`, and the browser runner has injected
`signInClerkUser`. A missing helper is an environment/setup failure, not a
Clerk form failure.
