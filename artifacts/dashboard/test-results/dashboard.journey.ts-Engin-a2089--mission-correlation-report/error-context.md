# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> exports one redacted live-provider mission correlation report
- Location: e2e/dashboard.journey.ts:738:3

# Error details

```
Error: Live-provider mission failed to start (409).
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
      - main [ref=f1e91]:
        - generic [ref=f1e93]:
          - generic [ref=f1e94]:
            - generic [ref=f1e95]:
              - heading "System Overview" [level=1] [ref=f1e96]
              - paragraph [ref=f1e97]: Real-time status of all autonomous engineering operations.
            - generic [ref=f1e98]: SYSTEM ONLINE
          - generic [ref=f1e101]:
            - generic [ref=f1e102]:
              - heading "Active Projects" [level=3] [ref=f1e104]
              - generic [ref=f1e111]: "1"
              - generic [ref=f1e112]:
                - generic [ref=f1e113]: "0"
                - text: tasks pending
            - generic [ref=f1e114]:
              - heading "Active Tasks" [level=3] [ref=f1e116]
              - generic [ref=f1e120]: "0"
              - generic [ref=f1e121]:
                - generic [ref=f1e122]: "0"
                - text: currently executing
            - generic [ref=f1e123]:
              - heading "Tasks Completed" [level=3] [ref=f1e125]
              - generic [ref=f1e130]: "0"
              - generic [ref=f1e131]: No completions yet
            - generic [ref=f1e133]:
              - heading "Failed Tasks" [level=3] [ref=f1e135]
              - generic [ref=f1e139]: "0"
              - generic [ref=f1e140]: Require attention
          - generic [ref=f1e141]:
            - generic [ref=f1e142]:
              - generic [ref=f1e143]:
                - heading "Project Health" [level=2] [ref=f1e144]
                - link "View All" [ref=f1e150] [cursor=pointer]:
                  - /url: /dashboard/projects
              - table [ref=f1e152]:
                - rowgroup [ref=f1e153]:
                  - row [ref=f1e154]:
                    - columnheader "Project" [ref=f1e155]
                    - columnheader "Score" [ref=f1e156]
                    - columnheader "Trend" [ref=f1e157]
                    - columnheader "Quality Bar" [ref=f1e158]
                - rowgroup [ref=f1e159]:
                  - row [ref=f1e160]:
                    - cell "live-provider-disposable" [ref=f1e161]
                    - cell "92 / 100" [ref=f1e162]:
                      - text: "92"
                      - generic [ref=f1e163]: / 100
                    - cell "→ stable" [ref=f1e164]
                    - cell [ref=f1e166]
            - generic [ref=f1e169]:
              - generic [ref=f1e170]:
                - heading "Event Stream" [level=2] [ref=f1e171]
                - link "View All" [ref=f1e175] [cursor=pointer]:
                  - /url: /dashboard/events
              - generic [ref=f1e176]: No recent events.
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  661 | 
  662 | async function liveRequest(
  663 |   page: Page,
  664 |   path: string,
  665 |   options?: { method?: string; body?: unknown; timeout?: number },
  666 | ): Promise<{ status: number; body: string }> {
  667 |   return page.evaluate(
  668 |     async ({ url, method, body, timeout }) => {
  669 |       const response = await fetch(url, {
  670 |         method,
  671 |         credentials: "include",
  672 |         headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  673 |         body: body === undefined ? undefined : JSON.stringify(body),
  674 |         signal: timeout ? AbortSignal.timeout(timeout) : undefined,
  675 |       });
  676 |       return { status: response.status, body: await response.text() };
  677 |     },
  678 |     {
  679 |       url: apiUrl(page, path),
  680 |       method: options?.method ?? "GET",
  681 |       body: options?.body,
  682 |       timeout: options?.timeout,
  683 |     },
  684 |   );
  685 | }
  686 | 
  687 | function parseSse(body: string): Array<Record<string, unknown>> {
  688 |   return body
  689 |     .split(/\n\n+/)
  690 |     .flatMap((chunk) => {
  691 |       const data = chunk
  692 |         .split("\n")
  693 |         .find((line) => line.startsWith("data: "))
  694 |         ?.slice("data: ".length);
  695 |       if (!data) return [];
  696 |       try {
  697 |         const value = JSON.parse(data) as unknown;
  698 |         return value && typeof value === "object"
  699 |           ? [value as Record<string, unknown>]
  700 |           : [];
  701 |       } catch {
  702 |         return [];
  703 |       }
  704 |     });
  705 | }
  706 | 
  707 | async function liveJson(page: Page, path: string): Promise<Record<string, any>> {
  708 |   const response = await liveRequest(page, path);
  709 |   if (response.status < 200 || response.status >= 300) {
  710 |     throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  711 |   }
  712 |   return JSON.parse(response.body) as Record<string, any>;
  713 | }
  714 | 
  715 | async function liveArray(page: Page, path: string): Promise<Array<Record<string, any>>> {
  716 |   const response = await liveRequest(page, path);
  717 |   if (response.status === 404) return [];
  718 |   if (response.status < 200 || response.status >= 300) {
  719 |     throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  720 |   }
  721 |   const value = JSON.parse(response.body);
  722 |   return Array.isArray(value) ? value : [];
  723 | }
  724 | 
  725 | async function liveOptionalRecord(page: Page, path: string): Promise<Record<string, any> | undefined> {
  726 |   const response = await liveRequest(page, path);
  727 |   if (response.status === 404) return undefined;
  728 |   if (response.status < 200 || response.status >= 300) {
  729 |     throw new Error(`Live correlation request failed: ${path} (${response.status})`);
  730 |   }
  731 |   const value = JSON.parse(response.body);
  732 |   return value && typeof value === "object" && !Array.isArray(value)
  733 |     ? value as Record<string, any>
  734 |     : undefined;
  735 | }
  736 | 
  737 | test.describe("EngineeringOS dashboard browser journey", () => {
  738 |   test("exports one redacted live-provider mission correlation report", async ({ page }) => {
  739 |     // The Playwright deadline must leave room for the provider-bound request
  740 |     // and polling loop to consume their complete configured budget.
  741 |     test.setTimeout(liveTimeoutMs() + LIVE_TEST_TIMEOUT_MARGIN_MS);
  742 |     test.skip(
  743 |       process.env.DASHBOARD_E2E_LIVE_PROVIDER !== "1",
  744 |       "Live-provider release journey is opt-in.",
  745 |     );
  746 |     const projectId = process.env.DASHBOARD_E2E_LIVE_PROJECT_ID;
  747 |     if (!projectId) throw new Error("DASHBOARD_E2E_LIVE_PROJECT_ID is required for the live-provider journey.");
  748 | 
  749 |     await programmaticSignIn(page);
  750 |     const streamResponse = await liveRequest(page, "/api/ai/chat/stream", {
  751 |       method: "POST",
  752 |       timeout: liveTimeoutMs(),
  753 |       body: {
  754 |         projectId,
  755 |         message: process.env.DASHBOARD_E2E_LIVE_PROMPT
  756 |           ?? "Run one bounded read-only mission and report the verified evidence.",
  757 |         idempotencyKey: `dashboard-live-${Date.now()}`,
  758 |       },
  759 |     });
  760 |     if (streamResponse.status < 200 || streamResponse.status >= 300) {
> 761 |       throw new Error(`Live-provider mission failed to start (${streamResponse.status}).`);
      |             ^ Error: Live-provider mission failed to start (409).
  762 |     }
  763 |     const sseEvents = parseSse(streamResponse.body);
  764 |     const started = sseEvents.find((event) => event.type === "execution_started");
  765 |     const executionId = typeof started?.executionId === "string" ? started.executionId : undefined;
  766 |     if (!executionId) throw new Error("Live-provider stream did not emit execution_started.");
  767 | 
  768 |     let execution: Record<string, any> = {};
  769 |     const deadline = Date.now() + liveTimeoutMs();
  770 |     while (Date.now() < deadline) {
  771 |       execution = await liveJson(page, `/api/ai/executions/${executionId}`);
  772 |       if (["completed", "failed", "cancelled"].includes(String(execution.status))) break;
  773 |       await new Promise((resolve) => setTimeout(resolve, 750));
  774 |     }
  775 |     if (!["completed", "failed", "cancelled"].includes(String(execution.status))) {
  776 |       throw new Error("Live-provider mission did not reach a terminal state within its bound.");
  777 |     }
  778 | 
  779 |     const sessionId = String(execution.sessionId);
  780 |     const messages = await liveArray(page, `/api/ai/chat/${sessionId}/messages`);
  781 |     const events = await liveArray(
  782 |       page,
  783 |       `/api/events?projectId=${encodeURIComponent(projectId)}&correlationId=${encodeURIComponent(String(execution.operationId ?? ""))}`,
  784 |     );
  785 |     const proposal = await liveOptionalRecord(page, `/api/ai/chat/${sessionId}/pending-proposal`);
  786 |     const gitLog = await liveJson(page, `/api/projects/${projectId}/git/log`);
  787 |     const missionControl = await liveJson(page, "/api/ai/mission-control");
  788 |     const dashboardState = await liveJson(page, "/api/dashboard");
  789 |     const checkpoint = execution.checkpoint && typeof execution.checkpoint === "object"
  790 |       ? execution.checkpoint as Record<string, any>
  791 |       : {};
  792 |     const recentSteps = Array.isArray(checkpoint.recentSteps) ? checkpoint.recentSteps : [];
  793 |     const validation = recentSteps.filter((step) => step?.kind === "validation");
  794 |     const evidenceCount = recentSteps.reduce(
  795 |       (count, step) => count + (Number(step?.acceptedEvidenceCount) || 0),
  796 |       0,
  797 |     );
  798 |     const capture = {
  799 |       projectId,
  800 |       sessionId,
  801 |       operationId: execution.operationId,
  802 |       workspaceRevision: gitLog.commits?.[0]?.shortHash ?? gitLog.commits?.[0]?.hash?.slice(0, 12),
  803 |       terminalState: execution.flightState ?? execution.status,
  804 |       execution: {
  805 |         id: execution.id,
  806 |         projectId: execution.projectId,
  807 |         sessionId: execution.sessionId,
  808 |         operationId: execution.operationId,
  809 |         status: execution.status,
  810 |         flightState: execution.flightState,
  811 |       },
  812 |       messages: messages.map(({ id, sessionId: messageSession, role, executionId: messageExecution, outcome }) => ({
  813 |         id, sessionId: messageSession, role, executionId: messageExecution, outcome,
  814 |       })),
  815 |       sseEvents: sseEvents.map(({ type, executionId: eventExecution, sessionId: eventSession, outcome, code }) => ({
  816 |         type, executionId: eventExecution, sessionId: eventSession, outcome, code,
  817 |       })),
  818 |       checkpoints: [{ sequence: checkpoint.sequence, stage: checkpoint.stage, updatedAt: checkpoint.updatedAt }],
  819 |       evidenceCount,
  820 |       proposals: proposal
  821 |         ? [{ id: proposal.id, revision: proposal.revision, status: proposal.status }]
  822 |         : [],
  823 |       validation: validation.map((step) => ({
  824 |         status: step.validation?.status ?? step.status,
  825 |         profile: step.validation?.profile ?? step.validationProfile,
  826 |       })),
  827 |       events: events.map(({ type, severity, correlationId }) => ({ type, severity, correlationId })),
  828 |       dashboard: missionControl,
  829 |       dashboardState: {
  830 |         projectCount: dashboardState.projectCount,
  831 |         activeTaskCount: dashboardState.activeTaskCount,
  832 |       },
  833 |     };
  834 |     const outputPath = process.env.DASHBOARD_E2E_LIVE_REPORT_PATH
  835 |       ?? "test-results/dashboard-journey/live-mission-correlation.json";
  836 |     await mkdir(dirname(outputPath), { recursive: true });
  837 |     await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");
  838 |   });
  839 | 
  840 |   test("signs in and traverses the authenticated operational shell", async ({
  841 |     page,
  842 |   }) => {
  843 |     await installApiFixtures(page);
  844 |     await programmaticSignIn(page);
  845 | 
  846 |     await expect(
  847 |       page.getByRole("heading", { name: "System Overview" }),
  848 |     ).toBeVisible();
  849 |     await expect(
  850 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  851 |     ).toBeVisible();
  852 |     await expect(
  853 |       page.getByText("Smoke Project", { exact: true }).first(),
  854 |     ).toBeVisible();
  855 |     await expect(
  856 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  857 |     ).toBeVisible();
  858 | 
  859 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  860 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  861 |     await expect(
```