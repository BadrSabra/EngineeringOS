# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> exports one redacted live-provider mission correlation report
- Location: e2e/dashboard.journey.ts:707:3

# Error details

```
Error: Live-provider mission failed to start (401).
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
  658 |   const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  659 |   return new URL(path, apiBaseUrl ? apiBaseUrl : page.url()).toString();
  660 | }
  661 | 
  662 | function parseSse(body: string): Array<Record<string, unknown>> {
  663 |   return body
  664 |     .split(/\n\n+/)
  665 |     .flatMap((chunk) => {
  666 |       const data = chunk
  667 |         .split("\n")
  668 |         .find((line) => line.startsWith("data: "))
  669 |         ?.slice("data: ".length);
  670 |       if (!data) return [];
  671 |       try {
  672 |         const value = JSON.parse(data) as unknown;
  673 |         return value && typeof value === "object"
  674 |           ? [value as Record<string, unknown>]
  675 |           : [];
  676 |       } catch {
  677 |         return [];
  678 |       }
  679 |     });
  680 | }
  681 | 
  682 | async function liveJson(page: Page, path: string): Promise<Record<string, any>> {
  683 |   const response = await page.request.get(apiUrl(page, path));
  684 |   if (!response.ok()) throw new Error(`Live correlation request failed: ${path} (${response.status()})`);
  685 |   return (await response.json()) as Record<string, any>;
  686 | }
  687 | 
  688 | async function liveArray(page: Page, path: string): Promise<Array<Record<string, any>>> {
  689 |   const response = await page.request.get(apiUrl(page, path));
  690 |   if (response.status() === 404) return [];
  691 |   if (!response.ok()) throw new Error(`Live correlation request failed: ${path} (${response.status()})`);
  692 |   const value = await response.json();
  693 |   return Array.isArray(value) ? value : [];
  694 | }
  695 | 
  696 | async function liveOptionalRecord(page: Page, path: string): Promise<Record<string, any> | undefined> {
  697 |   const response = await page.request.get(apiUrl(page, path));
  698 |   if (response.status() === 404) return undefined;
  699 |   if (!response.ok()) throw new Error(`Live correlation request failed: ${path} (${response.status()})`);
  700 |   const value = await response.json();
  701 |   return value && typeof value === "object" && !Array.isArray(value)
  702 |     ? value as Record<string, any>
  703 |     : undefined;
  704 | }
  705 | 
  706 | test.describe("EngineeringOS dashboard browser journey", () => {
  707 |   test("exports one redacted live-provider mission correlation report", async ({ page }) => {
  708 |     // The Playwright deadline must leave room for the provider-bound request
  709 |     // and polling loop to consume their complete configured budget.
  710 |     test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
  711 |     test.skip(
  712 |       process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1",
  713 |       "Live-provider release journey is opt-in.",
  714 |     );
  715 |     const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
  716 |     if (!projectId) throw new Error("DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.");
  717 | 
  718 |     await programmaticSignIn(page);
  719 |     const streamResponse = await page.request.post(apiUrl(page, "/api/ai/chat/stream"), {
  720 |       data: {
  721 |         projectId,
  722 |         message: process.env.DASHBOARD_E2E_LIVE_PROMPT
  723 |           ?? "Run one bounded read-only mission and report the verified evidence.",
  724 |         idempotencyKey: `dashboard-live-${Date.now()}`,
  725 |       },
  726 |       timeout: liveTimeoutMs(),
  727 |     });
  728 |     if (!streamResponse.ok()) {
> 729 |       throw new Error(`Live-provider mission failed to start (${streamResponse.status()}).`);
      |             ^ Error: Live-provider mission failed to start (401).
  730 |     }
  731 |     const sseEvents = parseSse(await streamResponse.text());
  732 |     const started = sseEvents.find((event) => event.type === "execution_started");
  733 |     const executionId = typeof started?.executionId === "string" ? started.executionId : undefined;
  734 |     if (!executionId) throw new Error("Live-provider stream did not emit execution_started.");
  735 | 
  736 |     let execution: Record<string, any> = {};
  737 |     const deadline = Date.now() + liveTimeoutMs();
  738 |     while (Date.now() < deadline) {
  739 |       execution = await liveJson(page, `/api/ai/executions/${executionId}`);
  740 |       if (["completed", "failed", "cancelled"].includes(String(execution.status))) break;
  741 |       await new Promise((resolve) => setTimeout(resolve, 750));
  742 |     }
  743 |     if (!["completed", "failed", "cancelled"].includes(String(execution.status))) {
  744 |       throw new Error("Live-provider mission did not reach a terminal state within its bound.");
  745 |     }
  746 | 
  747 |     const sessionId = String(execution.sessionId);
  748 |     const messages = await liveArray(page, `/api/ai/chat/${sessionId}/messages`);
  749 |     const events = await liveArray(
  750 |       page,
  751 |       `/api/events?projectId=${encodeURIComponent(projectId)}&correlationId=${encodeURIComponent(String(execution.operationId ?? ""))}`,
  752 |     );
  753 |     const proposal = await liveOptionalRecord(page, `/api/ai/chat/${sessionId}/pending-proposal`);
  754 |     const gitLog = await liveJson(page, `/api/projects/${projectId}/git/log`);
  755 |     const missionControl = await liveJson(page, "/api/ai/mission-control");
  756 |     const dashboardState = await liveJson(page, "/api/dashboard");
  757 |     const checkpoint = execution.checkpoint && typeof execution.checkpoint === "object"
  758 |       ? execution.checkpoint as Record<string, any>
  759 |       : {};
  760 |     const recentSteps = Array.isArray(checkpoint.recentSteps) ? checkpoint.recentSteps : [];
  761 |     const validation = recentSteps.filter((step) => step?.kind === "validation");
  762 |     const evidenceCount = recentSteps.reduce(
  763 |       (count, step) => count + (Number(step?.acceptedEvidenceCount) || 0),
  764 |       0,
  765 |     );
  766 |     const capture = {
  767 |       projectId,
  768 |       sessionId,
  769 |       operationId: execution.operationId,
  770 |       workspaceRevision: gitLog.commits?.[0]?.shortHash ?? gitLog.commits?.[0]?.hash?.slice(0, 12),
  771 |       terminalState: execution.flightState ?? execution.status,
  772 |       execution: {
  773 |         id: execution.id,
  774 |         projectId: execution.projectId,
  775 |         sessionId: execution.sessionId,
  776 |         operationId: execution.operationId,
  777 |         status: execution.status,
  778 |         flightState: execution.flightState,
  779 |       },
  780 |       messages: messages.map(({ id, sessionId: messageSession, role, executionId: messageExecution, outcome }) => ({
  781 |         id, sessionId: messageSession, role, executionId: messageExecution, outcome,
  782 |       })),
  783 |       sseEvents: sseEvents.map(({ type, executionId: eventExecution, sessionId: eventSession, outcome, code }) => ({
  784 |         type, executionId: eventExecution, sessionId: eventSession, outcome, code,
  785 |       })),
  786 |       checkpoints: [{ sequence: checkpoint.sequence, stage: checkpoint.stage, updatedAt: checkpoint.updatedAt }],
  787 |       evidenceCount,
  788 |       proposals: proposal
  789 |         ? [{ id: proposal.id, revision: proposal.revision, status: proposal.status }]
  790 |         : [],
  791 |       validation: validation.map((step) => ({
  792 |         status: step.validation?.status ?? step.status,
  793 |         profile: step.validation?.profile ?? step.validationProfile,
  794 |       })),
  795 |       events: events.map(({ type, severity, correlationId }) => ({ type, severity, correlationId })),
  796 |       dashboard: missionControl,
  797 |       dashboardState: {
  798 |         projectCount: dashboardState.projectCount,
  799 |         activeTaskCount: dashboardState.activeTaskCount,
  800 |       },
  801 |     };
  802 |     const outputPath = process.env.DASHBOARD_E2E_LIVE_REPORT_PATH
  803 |       ?? "test-results/dashboard-journey/live-mission-correlation.json";
  804 |     await mkdir(dirname(outputPath), { recursive: true });
  805 |     await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  806 |   });
  807 | 
  808 |   test("signs in and traverses the authenticated operational shell", async ({
  809 |     page,
  810 |   }) => {
  811 |     await installApiFixtures(page);
  812 |     await programmaticSignIn(page);
  813 | 
  814 |     await expect(
  815 |       page.getByRole("heading", { name: "System Overview" }),
  816 |     ).toBeVisible();
  817 |     await expect(
  818 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  819 |     ).toBeVisible();
  820 |     await expect(
  821 |       page.getByText("Smoke Project", { exact: true }).first(),
  822 |     ).toBeVisible();
  823 |     await expect(
  824 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  825 |     ).toBeVisible();
  826 | 
  827 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  828 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  829 |     await expect(
```