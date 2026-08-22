# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> exports one redacted live-provider mission correlation report
- Location: e2e/dashboard.journey.ts:706:3

# Error details

```
Error: Live-provider mission failed to start (404).
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - generic [ref=f1e3]:
    - generic [ref=f1e4]:
      - generic [ref=f1e5]: EngineeringOS
      - generic [ref=f1e13]:
        - generic [ref=f1e14]: Core Ops
        - link "Dashboard" [ref=f1e15] [cursor=pointer]:
          - /url: /dashboard/
        - link "Projects" [ref=f1e21] [cursor=pointer]:
          - /url: /dashboard/projects
        - link "Tasks" [ref=f1e27] [cursor=pointer]:
          - /url: /dashboard/tasks
        - link "Rules Engine" [ref=f1e31] [cursor=pointer]:
          - /url: /dashboard/rules
        - link "Workflows" [ref=f1e34] [cursor=pointer]:
          - /url: /dashboard/workflows
        - link "Event Stream" [ref=f1e39] [cursor=pointer]:
          - /url: /dashboard/events
        - link "Metrics" [ref=f1e42] [cursor=pointer]:
          - /url: /dashboard/metrics
        - link "Knowledge Graph" [ref=f1e45] [cursor=pointer]:
          - /url: /dashboard/graph
        - link "AI Assistant" [ref=f1e51] [cursor=pointer]:
          - /url: /dashboard/ai
        - link "Flight Deck" [ref=f1e55] [cursor=pointer]:
          - /url: /dashboard/flight-deck
        - link "Mission Control" [ref=f1e58] [cursor=pointer]:
          - /url: /dashboard/mission-control
      - generic [ref=f1e63]:
        - generic [ref=f1e64]: ED
        - generic [ref=f1e65]:
          - generic [ref=f1e66]: EngineeringOS Dashboard Smoke
          - generic [ref=f1e67]: Connected
        - button "Sign out" [ref=f1e69]
    - generic [ref=f1e73]:
      - banner [ref=f1e74]:
        - textbox "Search projects, tasks, rules... (Press '/')" [ref=f1e79]
        - generic [ref=f1e80]:
          - generic [ref=f1e81]: v1.0.4-stable
          - button [ref=f1e86]
      - main [ref=f1e91]
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  628 |     globalThis.__ENGINEERINGOS_SIGN_IN_CLERK_USER__;
  629 |   if (!helper) {
  630 |     if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
  631 |       throw new Error(
  632 |         "Clerk browser helper is unavailable. Run this journey in the Replit browser runner, which injects signInClerkUser.",
  633 |       );
  634 |     }
  635 |     await page.goto(await createReleaseSignInUrl(page));
  636 |     await expect(page).toHaveURL(
  637 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  638 |     );
  639 |     return;
  640 |   }
  641 |   const signInUrl = await helper({
  642 |     ...TEST_USER,
  643 |     ttl: 900,
  644 |     basePath: DASHBOARD_PATH,
  645 |   });
  646 |   await page.goto(signInUrl);
  647 |   await expect(page).toHaveURL(
  648 |     new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  649 |   );
  650 | }
  651 | 
  652 | async function openNavigation(page: Page, label: string, path: string) {
  653 |   await page.getByRole("link", { name: label, exact: true }).click();
  654 |   await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  655 | }
  656 | 
  657 | function apiUrl(page: Page, path: string): string {
  658 |   return new URL(path, page.url()).toString();
  659 | }
  660 | 
  661 | function parseSse(body: string): Array<Record<string, unknown>> {
  662 |   return body
  663 |     .split(/\n\n+/)
  664 |     .flatMap((chunk) => {
  665 |       const data = chunk
  666 |         .split("\n")
  667 |         .find((line) => line.startsWith("data: "))
  668 |         ?.slice("data: ".length);
  669 |       if (!data) return [];
  670 |       try {
  671 |         const value = JSON.parse(data) as unknown;
  672 |         return value && typeof value === "object"
  673 |           ? [value as Record<string, unknown>]
  674 |           : [];
  675 |       } catch {
  676 |         return [];
  677 |       }
  678 |     });
  679 | }
  680 | 
  681 | async function liveJson(page: Page, path: string): Promise<Record<string, any>> {
  682 |   const response = await page.request.get(apiUrl(page, path));
  683 |   if (!response.ok()) throw new Error(`Live correlation request failed: ${path} (${response.status()})`);
  684 |   return (await response.json()) as Record<string, any>;
  685 | }
  686 | 
  687 | async function liveArray(page: Page, path: string): Promise<Array<Record<string, any>>> {
  688 |   const response = await page.request.get(apiUrl(page, path));
  689 |   if (response.status() === 404) return [];
  690 |   if (!response.ok()) throw new Error(`Live correlation request failed: ${path} (${response.status()})`);
  691 |   const value = await response.json();
  692 |   return Array.isArray(value) ? value : [];
  693 | }
  694 | 
  695 | async function liveOptionalRecord(page: Page, path: string): Promise<Record<string, any> | undefined> {
  696 |   const response = await page.request.get(apiUrl(page, path));
  697 |   if (response.status() === 404) return undefined;
  698 |   if (!response.ok()) throw new Error(`Live correlation request failed: ${path} (${response.status()})`);
  699 |   const value = await response.json();
  700 |   return value && typeof value === "object" && !Array.isArray(value)
  701 |     ? value as Record<string, any>
  702 |     : undefined;
  703 | }
  704 | 
  705 | test.describe("EngineeringOS dashboard browser journey", () => {
  706 |   test("exports one redacted live-provider mission correlation report", async ({ page }) => {
  707 |     // The Playwright deadline must leave room for the provider-bound request
  708 |     // and polling loop to consume their complete configured budget.
  709 |     test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
  710 |     test.skip(
  711 |       process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1",
  712 |       "Live-provider release journey is opt-in.",
  713 |     );
  714 |     const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
  715 |     if (!projectId) throw new Error("DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.");
  716 | 
  717 |     await programmaticSignIn(page);
  718 |     const streamResponse = await page.request.post(apiUrl(page, "/api/ai/chat/stream"), {
  719 |       data: {
  720 |         projectId,
  721 |         message: process.env.DASHBOARD_E2E_LIVE_PROMPT
  722 |           ?? "Run one bounded read-only mission and report the verified evidence.",
  723 |         idempotencyKey: `dashboard-live-${Date.now()}`,
  724 |       },
  725 |       timeout: liveTimeoutMs(),
  726 |     });
  727 |     if (!streamResponse.ok()) {
> 728 |       throw new Error(`Live-provider mission failed to start (${streamResponse.status()}).`);
      |             ^ Error: Live-provider mission failed to start (404).
  729 |     }
  730 |     const sseEvents = parseSse(await streamResponse.text());
  731 |     const started = sseEvents.find((event) => event.type === "execution_started");
  732 |     const executionId = typeof started?.executionId === "string" ? started.executionId : undefined;
  733 |     if (!executionId) throw new Error("Live-provider stream did not emit execution_started.");
  734 | 
  735 |     let execution: Record<string, any> = {};
  736 |     const deadline = Date.now() + liveTimeoutMs();
  737 |     while (Date.now() < deadline) {
  738 |       execution = await liveJson(page, `/api/ai/executions/${executionId}`);
  739 |       if (["completed", "failed", "cancelled"].includes(String(execution.status))) break;
  740 |       await new Promise((resolve) => setTimeout(resolve, 750));
  741 |     }
  742 |     if (!["completed", "failed", "cancelled"].includes(String(execution.status))) {
  743 |       throw new Error("Live-provider mission did not reach a terminal state within its bound.");
  744 |     }
  745 | 
  746 |     const sessionId = String(execution.sessionId);
  747 |     const messages = await liveArray(page, `/api/ai/chat/${sessionId}/messages`);
  748 |     const events = await liveArray(
  749 |       page,
  750 |       `/api/events?projectId=${encodeURIComponent(projectId)}&correlationId=${encodeURIComponent(String(execution.operationId ?? ""))}`,
  751 |     );
  752 |     const proposal = await liveOptionalRecord(page, `/api/ai/chat/${sessionId}/pending-proposal`);
  753 |     const gitLog = await liveJson(page, `/api/projects/${projectId}/git/log`);
  754 |     const missionControl = await liveJson(page, "/api/ai/mission-control");
  755 |     const dashboardState = await liveJson(page, "/api/dashboard");
  756 |     const checkpoint = execution.checkpoint && typeof execution.checkpoint === "object"
  757 |       ? execution.checkpoint as Record<string, any>
  758 |       : {};
  759 |     const recentSteps = Array.isArray(checkpoint.recentSteps) ? checkpoint.recentSteps : [];
  760 |     const validation = recentSteps.filter((step) => step?.kind === "validation");
  761 |     const evidenceCount = recentSteps.reduce(
  762 |       (count, step) => count + (Number(step?.acceptedEvidenceCount) || 0),
  763 |       0,
  764 |     );
  765 |     const capture = {
  766 |       projectId,
  767 |       sessionId,
  768 |       operationId: execution.operationId,
  769 |       workspaceRevision: gitLog.commits?.[0]?.shortHash ?? gitLog.commits?.[0]?.hash?.slice(0, 12),
  770 |       terminalState: execution.flightState ?? execution.status,
  771 |       execution: {
  772 |         id: execution.id,
  773 |         projectId: execution.projectId,
  774 |         sessionId: execution.sessionId,
  775 |         operationId: execution.operationId,
  776 |         status: execution.status,
  777 |         flightState: execution.flightState,
  778 |       },
  779 |       messages: messages.map(({ id, sessionId: messageSession, role, executionId: messageExecution, outcome }) => ({
  780 |         id, sessionId: messageSession, role, executionId: messageExecution, outcome,
  781 |       })),
  782 |       sseEvents: sseEvents.map(({ type, executionId: eventExecution, sessionId: eventSession, outcome, code }) => ({
  783 |         type, executionId: eventExecution, sessionId: eventSession, outcome, code,
  784 |       })),
  785 |       checkpoints: [{ sequence: checkpoint.sequence, stage: checkpoint.stage, updatedAt: checkpoint.updatedAt }],
  786 |       evidenceCount,
  787 |       proposals: proposal
  788 |         ? [{ id: proposal.id, revision: proposal.revision, status: proposal.status }]
  789 |         : [],
  790 |       validation: validation.map((step) => ({
  791 |         status: step.validation?.status ?? step.status,
  792 |         profile: step.validation?.profile ?? step.validationProfile,
  793 |       })),
  794 |       events: events.map(({ type, severity, correlationId }) => ({ type, severity, correlationId })),
  795 |       dashboard: missionControl,
  796 |       dashboardState: {
  797 |         projectCount: dashboardState.projectCount,
  798 |         activeTaskCount: dashboardState.activeTaskCount,
  799 |       },
  800 |     };
  801 |     const outputPath = process.env.DASHBOARD_E2E_LIVE_REPORT_PATH
  802 |       ?? "test-results/dashboard-journey/live-mission-correlation.json";
  803 |     await mkdir(dirname(outputPath), { recursive: true });
  804 |     await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  805 |   });
  806 | 
  807 |   test("signs in and traverses the authenticated operational shell", async ({
  808 |     page,
  809 |   }) => {
  810 |     await installApiFixtures(page);
  811 |     await programmaticSignIn(page);
  812 | 
  813 |     await expect(
  814 |       page.getByRole("heading", { name: "System Overview" }),
  815 |     ).toBeVisible();
  816 |     await expect(
  817 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  818 |     ).toBeVisible();
  819 |     await expect(
  820 |       page.getByText("Smoke Project", { exact: true }).first(),
  821 |     ).toBeVisible();
  822 |     await expect(
  823 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  824 |     ).toBeVisible();
  825 | 
  826 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  827 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  828 |     await expect(
```