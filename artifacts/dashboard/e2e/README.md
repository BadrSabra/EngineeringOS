# Dashboard browser journey

This is an opt-in real-browser smoke test. It is separate from the dashboard
Vitest suite and never calls an AI provider or mutates projects, Git, or
production data.

## Run

Start the existing workflows first:

```sh
BASE_PATH=/dashboard/ PORT=5173 pnpm --filter @workspace/dashboard run dev
pnpm --filter @workspace/api-server run dev
```

Then run the journey from the workspace root:

```sh
DASHBOARD_E2E_BASE_URL=https://$REPLIT_DEV_DOMAIN/dashboard/ \
  pnpm --filter @workspace/dashboard run test:e2e
```

The Replit browser runner must provide the `signInClerkUser` helper described
in `.local/skills/clerk-auth-e2e-testing-only/SKILL.md`. The journey invokes
that helper to obtain a short-lived session URL and never fills Clerk forms.
Use `DASHBOARD_E2E_EMAIL` to select an isolated test-user email when the
controlled environment provisions one.

The API routes used by the journey are intercepted in the browser with
read-only fixtures. This keeps dashboard/project/event success states stable,
uses a controlled execution id for Flight Deck, and returns a deliberate
provider-unavailable response for AI. Routing, Clerk session handoff, and
rendering remain real browser behavior.

## Failure diagnostics

The Playwright config retains traces, screenshots, and video on failure. Check
the dashboard and API workflow logs first, then confirm `BASE_PATH=/dashboard/`,
the dashboard/API workflows are running, `DASHBOARD_E2E_BASE_URL` includes the
trailing `/dashboard/`, and the browser runner has injected
`signInClerkUser`. A missing helper is an environment/setup failure, not a
Clerk form failure.