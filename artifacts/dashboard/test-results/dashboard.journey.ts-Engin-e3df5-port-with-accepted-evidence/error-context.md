# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> keeps the AI session drawer overlaid on a phone viewport with accepted evidence
- Location: e2e/dashboard.journey.ts:1563:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('link', { name: 'Sign In', exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByRole('link', { name: 'Sign In', exact: true })

```

```yaml
- region "Notifications (F8)":
  - list
- text: "[plugin:runtime-error-plugin] Clerk: Failed to load Clerk JS, failed to load script: https://clerk.127.0.0.1/npm/@clerk/clerk-js@6/dist/clerk.browser.js (code=\"failed_to_load_clerk_js\") Click outside, press Esc key, or fix the code to dismiss. You can also disable this overlay by setting"
- code: server.hmr.overlay
- text: to
- code: "false"
- text: in
- code: vite.config.ts
- text: .
```

# Test source

```ts
  769 |         resumable: true,
  770 |         resumeToken: initialToken,
  771 |       }),
  772 |       sse({ type: "stage", stage: "calling-model" }),
  773 |       sse({ type: "delta", delta: partialAnswer }),
  774 |     ].join(""),
  775 |     message,
  776 |   };
  777 |   return {
  778 |     fixture,
  779 |     initialToken,
  780 |     recoveredToken,
  781 |     resumedStreamBody: [
  782 |       sse({ type: "session_started", sessionId }),
  783 |       sse({
  784 |         type: "execution_started",
  785 |         executionId,
  786 |         status: "running",
  787 |         resumable: true,
  788 |         resumeToken: recoveredToken,
  789 |       }),
  790 |       sse({ type: "stage", stage: "resuming-checkpoint" }),
  791 |       sse({ type: "delta", delta: answer }),
  792 |       sse({ type: "done", sessionId, executionId, message, pendingChanges: [] }),
  793 |     ].join(""),
  794 |     execution: {
  795 |       id: executionId,
  796 |       projectId: "e2e-project",
  797 |       operationId: "e2e-interrupted-resume-operation",
  798 |       sessionId,
  799 |       status: "paused",
  800 |       flightState: "PAUSED",
  801 |       resumable: true,
  802 |       checkpointVersion: 1,
  803 |       checkpoint: {
  804 |         stage: "calling-model",
  805 |         detail: "The browser transport disconnected after the execution started.",
  806 |       },
  807 |       objective: { objective: question },
  808 |       startedAt: "2026-01-01T00:01:00.000Z",
  809 |       createdAt: "2026-01-01T00:01:00.000Z",
  810 |       updatedAt: "2026-01-01T00:02:00.000Z",
  811 |     },
  812 |   };
  813 | }
  814 | 
  815 | async function createReleaseSignInUrl(page: Page) {
  816 |   const secretKey = process.env.CLERK_SECRET_KEY;
  817 |   if (!secretKey) {
  818 |     throw new Error(
  819 |       "CLERK_SECRET_KEY is required for the release-only programmatic Clerk handoff.",
  820 |     );
  821 |   }
  822 | 
  823 |   const headers = {
  824 |     Authorization: `Bearer ${secretKey}`,
  825 |     "Content-Type": "application/json",
  826 |   };
  827 |   const userResponse = await page.request.get(
  828 |     `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TEST_USER.email)}`,
  829 |     { headers },
  830 |   );
  831 |   let userId = parseClerkUserLookupResponse(await userResponse.json());
  832 | 
  833 |   if (!userId) {
  834 |     const createdResponse = await page.request.post(
  835 |       "https://api.clerk.com/v1/users",
  836 |       {
  837 |         headers,
  838 |         data: {
  839 |           email_address: [TEST_USER.email],
  840 |           first_name: TEST_USER.firstName,
  841 |           last_name: TEST_USER.lastName,
  842 |           skip_password_checks: true,
  843 |           skip_password_requirement: true,
  844 |         },
  845 |       },
  846 |     );
  847 |     userId = parseCreatedClerkUserResponse(await createdResponse.json());
  848 |   }
  849 | 
  850 |   if (!userId) {
  851 |     throw new Error(
  852 |       "The isolated Clerk release user could not be provisioned.",
  853 |     );
  854 |   }
  855 | 
  856 |   const tokenResponse = await page.request.post(
  857 |     "https://api.clerk.com/v1/sign_in_tokens",
  858 |     { headers, data: { user_id: userId } },
  859 |   );
  860 |   const token = parseClerkSignInTokenResponse(await tokenResponse.json());
  861 | 
  862 |   return `${new URL(DASHBOARD_PATH, page.url()).toString()}sign-in?__clerk_ticket=${encodeURIComponent(token)}`;
  863 | }
  864 | 
  865 | async function programmaticSignIn(page: Page) {
  866 |   await page.goto(DASHBOARD_PATH);
  867 |   await expect(
  868 |     page.getByRole("link", { name: "Sign In", exact: true }),
> 869 |   ).toBeVisible();
      |     ^ Error: expect(locator).toBeVisible() failed
  870 | 
  871 |   const helper =
  872 |     globalThis.signInClerkUser ??
  873 |     globalThis.__ENGINEERINGOS_SIGN_IN_CLERK_USER__;
  874 |   if (!helper) {
  875 |     if (process.env.RUN_CONTROLLED_RELEASE_VALIDATION !== "1") {
  876 |       throw new Error(
  877 |         "Clerk browser helper is unavailable. Run this journey in the Replit browser runner, which injects signInClerkUser.",
  878 |       );
  879 |     }
  880 |     await page.goto(await createReleaseSignInUrl(page));
  881 |     await expect(page).toHaveURL(
  882 |       new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  883 |     );
  884 |     return;
  885 |   }
  886 |   const signInUrl = await helper({
  887 |     ...TEST_USER,
  888 |     ttl: 900,
  889 |     basePath: DASHBOARD_PATH,
  890 |   });
  891 |   await page.goto(signInUrl);
  892 |   await expect(page).toHaveURL(
  893 |     new RegExp(`${DASHBOARD_PATH.replaceAll("/", "\\/")}$`),
  894 |   );
  895 | }
  896 | 
  897 | async function openNavigation(page: Page, label: string, path: string) {
  898 |   await page.getByRole("link", { name: label, exact: true }).click();
  899 |   await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
  900 | }
  901 | 
  902 | function apiUrl(page: Page, path: string): string {
  903 |   const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  904 |   return new URL(path, apiBaseUrl ? apiBaseUrl : page.url()).toString();
  905 | }
  906 | 
  907 | async function liveRequest(
  908 |   page: Page,
  909 |   path: string,
  910 |   options?: { method?: string; body?: unknown; timeout?: number },
  911 | ): Promise<{ status: number; body: string }> {
  912 |   return page.evaluate(
  913 |     async ({ url, method, body, timeout }) => {
  914 |       const response = await fetch(url, {
  915 |         method,
  916 |         credentials: "include",
  917 |         headers:
  918 |           body === undefined
  919 |             ? undefined
  920 |             : { "Content-Type": "application/json" },
  921 |         body: body === undefined ? undefined : JSON.stringify(body),
  922 |         signal: timeout ? AbortSignal.timeout(timeout) : undefined,
  923 |       });
  924 |       return { status: response.status, body: await response.text() };
  925 |     },
  926 |     {
  927 |       url: apiUrl(page, path),
  928 |       method: options?.method ?? "GET",
  929 |       body: options?.body,
  930 |       timeout: options?.timeout,
  931 |     },
  932 |   );
  933 | }
  934 | 
  935 | type OriginDiagnostic = {
  936 |   origin: string;
  937 |   phase: "GET" | "preflight" | "mutation" | "rejection";
  938 |   status?: number;
  939 |   headers?: Record<string, string>;
  940 |   error?: string;
  941 | };
  942 | const recordedOriginDiagnostics: OriginDiagnostic[] = [];
  943 | 
  944 | function originDiagnosticPath(): string | undefined {
  945 |   return process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH;
  946 | }
  947 | 
  948 | function relevantOriginHeaders(
  949 |   headers: Record<string, string>,
  950 | ): Record<string, string> {
  951 |   return Object.fromEntries(
  952 |     ORIGIN_DIAGNOSTIC_HEADERS.flatMap((name) =>
  953 |       headers[name] ? [[name, headers[name]]] : [],
  954 |     ),
  955 |   );
  956 | }
  957 | 
  958 | async function writeOriginDiagnostics() {
  959 |   const outputPath = originDiagnosticPath();
  960 |   if (!outputPath) return;
  961 |   await mkdir(dirname(outputPath), { recursive: true });
  962 |   await writeFile(
  963 |     outputPath,
  964 |     `${JSON.stringify({ diagnostics: recordedOriginDiagnostics }, null, 2)}\n`,
  965 |     "utf8",
  966 |   );
  967 | }
  968 | 
  969 | async function expectOriginCanUseApi(page: Page, origin: string) {
```