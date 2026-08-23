# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> signs in and traverses the authenticated operational shell
- Location: e2e/dashboard.journey.ts:1355:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "https://6aa0d55b-d211-4470-936b-5cd5c56e1e7a-00-wz1myvisw9tr-o3zf0j8b.janeway.replit.dev"
Received: undefined
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
            - generic [ref=f1e98]:
              - generic [ref=f1e99]:
                - generic [ref=f1e100]: Updated 1:06:47 PM
                - button "Refresh status" [ref=f1e101]
              - generic [ref=f1e107]: SYSTEM ONLINE
          - region "AI diagnostics retention health" [ref=f1e109]:
            - generic [ref=f1e110]:
              - generic [ref=f1e117]:
                - generic [ref=f1e118]:
                  - heading "AI diagnostics retention" [level=2] [ref=f1e119]
                  - generic [ref=f1e120]: Healthy
                - paragraph [ref=f1e121]: Last completed 8/23/2026, 1:06:21 PM
              - generic [ref=f1e122]:
                - generic [ref=f1e123]: Chat rows
                - generic [ref=f1e124]: 0 scanned / 0 pruned
                - generic [ref=f1e125]: Execution rows
                - generic [ref=f1e126]: 0 scanned / 0 pruned
          - generic [ref=f1e127]:
            - generic [ref=f1e128]:
              - heading "Active Projects" [level=3] [ref=f1e130]
              - generic [ref=f1e137]: "1"
              - generic [ref=f1e138]:
                - generic [ref=f1e139]: "0"
                - text: tasks pending
            - generic [ref=f1e140]:
              - heading "Active Tasks" [level=3] [ref=f1e142]
              - generic [ref=f1e146]: "0"
              - generic [ref=f1e147]:
                - generic [ref=f1e148]: "0"
                - text: currently executing
            - generic [ref=f1e149]:
              - heading "Tasks Completed" [level=3] [ref=f1e151]
              - generic [ref=f1e156]: "2"
              - generic [ref=f1e157]:
                - generic [ref=f1e158]: 100%
                - text: success rate
            - generic [ref=f1e162]:
              - heading "Failed Tasks" [level=3] [ref=f1e164]
              - generic [ref=f1e168]: "0"
              - generic [ref=f1e169]: Require attention
          - generic [ref=f1e170]:
            - generic [ref=f1e171]:
              - generic [ref=f1e172]:
                - heading "Project Health" [level=2] [ref=f1e173]
                - link "View All" [ref=f1e179] [cursor=pointer]:
                  - /url: /dashboard/projects
              - table [ref=f1e181]:
                - rowgroup [ref=f1e182]:
                  - row [ref=f1e183]:
                    - columnheader "Project" [ref=f1e184]
                    - columnheader "Score" [ref=f1e185]
                    - columnheader "Trend" [ref=f1e186]
                    - columnheader "Quality Bar" [ref=f1e187]
                - rowgroup [ref=f1e188]:
                  - row [ref=f1e189]:
                    - cell "Smoke Project" [ref=f1e190]
                    - cell "92 / 100" [ref=f1e191]:
                      - text: "92"
                      - generic [ref=f1e192]: / 100
                    - cell "→ stable" [ref=f1e193]
                    - cell [ref=f1e195]
            - generic [ref=f1e198]:
              - generic [ref=f1e199]:
                - heading "Event Stream" [level=2] [ref=f1e200]
                - link "View All" [ref=f1e204] [cursor=pointer]:
                  - /url: /dashboard/events
              - generic [ref=f1e213]:
                - generic [ref=f1e214]: Dashboard API fixture ready
                - generic [ref=f1e215]: 12:00:00 AM
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  934  | 
  935  | type OriginDiagnostic = {
  936  |   origin: string;
  937  |   phase: "GET" | "preflight" | "mutation" | "rejection";
  938  |   status?: number;
  939  |   headers?: Record<string, string>;
  940  |   error?: string;
  941  | };
  942  | const recordedOriginDiagnostics: OriginDiagnostic[] = [];
  943  | 
  944  | function originDiagnosticPath(): string | undefined {
  945  |   return process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH;
  946  | }
  947  | 
  948  | function relevantOriginHeaders(
  949  |   headers: Record<string, string>,
  950  | ): Record<string, string> {
  951  |   return Object.fromEntries(
  952  |     ORIGIN_DIAGNOSTIC_HEADERS.flatMap((name) =>
  953  |       headers[name] ? [[name, headers[name]]] : [],
  954  |     ),
  955  |   );
  956  | }
  957  | 
  958  | async function writeOriginDiagnostics() {
  959  |   const outputPath = originDiagnosticPath();
  960  |   if (!outputPath) return;
  961  |   await mkdir(dirname(outputPath), { recursive: true });
  962  |   await writeFile(
  963  |     outputPath,
  964  |     `${JSON.stringify({ diagnostics: recordedOriginDiagnostics }, null, 2)}\n`,
  965  |     "utf8",
  966  |   );
  967  | }
  968  | 
  969  | async function expectOriginCanUseApi(page: Page, origin: string) {
  970  |   const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  971  |   if (!apiBaseUrl) {
  972  |     throw new Error(
  973  |       "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
  974  |     );
  975  |   }
  976  |   const healthUrl = new URL("/api/healthz", apiBaseUrl).toString();
  977  |   const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  978  |   const commonHeaders = { Origin: origin };
  979  | 
  980  |   const diagnostics: OriginDiagnostic[] = [];
  981  |   const check = async (
  982  |     phase: OriginDiagnostic["phase"],
  983  |     request: () => Promise<import("@playwright/test").APIResponse>,
  984  |     assertion: (response: import("@playwright/test").APIResponse) => Promise<void>,
  985  |   ) => {
  986  |     try {
  987  |       const response = await request();
  988  |       diagnostics.push({
  989  |         origin,
  990  |         phase,
  991  |         status: response.status(),
  992  |         headers: relevantOriginHeaders(response.headers()),
  993  |       });
  994  |       recordedOriginDiagnostics.push(diagnostics.at(-1)!);
  995  |       await assertion(response);
  996  |     } catch (error) {
  997  |       const current = diagnostics.at(-1);
  998  |       if (current?.phase !== phase) {
  999  |         diagnostics.push({ origin, phase });
  1000 |       }
  1001 |       diagnostics.at(-1)!.error = "origin check failed";
  1002 |       await writeOriginDiagnostics();
  1003 |       throw error;
  1004 |     }
  1005 |   };
  1006 | 
  1007 |   await check(
  1008 |     "GET",
  1009 |     () => page.request.get(healthUrl, { headers: commonHeaders }),
  1010 |     async (response) => {
  1011 |       expect(response.status(), `${origin} credentialed GET status`).toBe(200);
  1012 |       expect(response.headers()["access-control-allow-origin"]).toBe(origin);
  1013 |       expect(response.headers()["access-control-allow-credentials"]).toBe(
  1014 |         "true",
  1015 |       );
  1016 |     },
  1017 |   );
  1018 |   await check(
  1019 |     "preflight",
  1020 |     () =>
  1021 |       page.request.fetch(mutationUrl, {
  1022 |         method: "OPTIONS",
  1023 |         headers: {
  1024 |           ...commonHeaders,
  1025 |           "Access-Control-Request-Method": "POST",
  1026 |           "Access-Control-Request-Headers": "content-type",
  1027 |         },
  1028 |       }),
  1029 |     async (response) => {
  1030 |       expect(
  1031 |         response.status(),
  1032 |         `${origin} mutation preflight status`,
  1033 |       ).toBe(204);
> 1034 |       expect(response.headers()["access-control-allow-origin"]).toBe(origin);
       |                                                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  1035 |     },
  1036 |   );
  1037 |   await check(
  1038 |     "mutation",
  1039 |     () =>
  1040 |       page.request.post(mutationUrl, {
  1041 |         headers: { ...commonHeaders, "Content-Type": "application/json" },
  1042 |         data: { message: "origin contract" },
  1043 |       }),
  1044 |     async (response) => {
  1045 |       expect(
  1046 |         response.status(),
  1047 |         `${origin} state-changing request must pass origin protection`,
  1048 |       ).not.toBe(403);
  1049 |       expect(response.headers()["access-control-allow-origin"]).toBe(origin);
  1050 |       expect(response.headers()["access-control-allow-credentials"]).toBe(
  1051 |         "true",
  1052 |       );
  1053 |     },
  1054 |   );
  1055 |   await writeOriginDiagnostics();
  1056 | }
  1057 | 
  1058 | async function expectHostileOriginRejected(page: Page) {
  1059 |   const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  1060 |   if (!apiBaseUrl)
  1061 |     throw new Error(
  1062 |       "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
  1063 |     );
  1064 |   const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  1065 |   const diagnostic: OriginDiagnostic = {
  1066 |     origin: HOSTILE_ORIGIN,
  1067 |     phase: "rejection",
  1068 |   };
  1069 |   recordedOriginDiagnostics.push(diagnostic);
  1070 |   try {
  1071 |     const response = await page.request.post(mutationUrl, {
  1072 |       headers: {
  1073 |         Origin: HOSTILE_ORIGIN,
  1074 |         "Content-Type": "application/json",
  1075 |       },
  1076 |       data: { message: "hostile origin contract" },
  1077 |     });
  1078 |     diagnostic.status = response.status();
  1079 |     diagnostic.headers = relevantOriginHeaders(response.headers());
  1080 |     expect(response.status()).toBe(403);
  1081 |     expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  1082 |     expect(
  1083 |       response.headers()["access-control-allow-credentials"],
  1084 |     ).toBeUndefined();
  1085 |   } catch (error) {
  1086 |     diagnostic.error = "origin rejection check failed";
  1087 |     await writeOriginDiagnostics();
  1088 |     throw error;
  1089 |   }
  1090 |   await writeOriginDiagnostics();
  1091 | }
  1092 | 
  1093 | function parseSse(body: string): Array<Record<string, unknown>> {
  1094 |   return body.split(/\n\n+/).flatMap((chunk) => {
  1095 |     const data = chunk
  1096 |       .split("\n")
  1097 |       .find((line) => line.startsWith("data: "))
  1098 |       ?.slice("data: ".length);
  1099 |     if (!data) return [];
  1100 |     try {
  1101 |       const value = JSON.parse(data) as unknown;
  1102 |       return value && typeof value === "object"
  1103 |         ? [value as Record<string, unknown>]
  1104 |         : [];
  1105 |     } catch {
  1106 |       return [];
  1107 |     }
  1108 |   });
  1109 | }
  1110 | 
  1111 | async function liveJson(
  1112 |   page: Page,
  1113 |   path: string,
  1114 | ): Promise<Record<string, any>> {
  1115 |   const response = await liveRequest(page, path);
  1116 |   if (response.status < 200 || response.status >= 300) {
  1117 |     throw new Error(
  1118 |       `Live correlation request failed: ${path} (${response.status})`,
  1119 |     );
  1120 |   }
  1121 |   return JSON.parse(response.body) as Record<string, any>;
  1122 | }
  1123 | 
  1124 | async function liveArray(
  1125 |   page: Page,
  1126 |   path: string,
  1127 | ): Promise<Array<Record<string, any>>> {
  1128 |   const response = await liveRequest(page, path);
  1129 |   if (response.status === 404) return [];
  1130 |   if (response.status < 200 || response.status >= 300) {
  1131 |     throw new Error(
  1132 |       `Live correlation request failed: ${path} (${response.status})`,
  1133 |     );
  1134 |   }
```