# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> signs in and traverses the authenticated operational shell
- Location: e2e/dashboard.journey.ts:1352:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "https://5c69b1bb-8c7d-4e7e-96bf-ff6739a5f8ff-00-19h22i63s03z9-gptgfqy1.worf.replit.dev"
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
            - generic [ref=f1e98]: SYSTEM ONLINE
          - region "AI diagnostics retention health" [ref=f1e101]:
            - generic [ref=f1e102]:
              - generic [ref=f1e109]:
                - generic [ref=f1e110]:
                  - heading "AI diagnostics retention" [level=2] [ref=f1e111]
                  - generic [ref=f1e112]: Healthy
                - paragraph [ref=f1e113]: Last completed 8/23/2026, 12:52:04 AM
              - generic [ref=f1e114]:
                - generic [ref=f1e115]: Chat rows
                - generic [ref=f1e116]: 0 scanned / 0 pruned
                - generic [ref=f1e117]: Execution rows
                - generic [ref=f1e118]: 0 scanned / 0 pruned
          - generic [ref=f1e119]:
            - generic [ref=f1e120]:
              - heading "Active Projects" [level=3] [ref=f1e122]
              - generic [ref=f1e129]: "1"
              - generic [ref=f1e130]:
                - generic [ref=f1e131]: "0"
                - text: tasks pending
            - generic [ref=f1e132]:
              - heading "Active Tasks" [level=3] [ref=f1e134]
              - generic [ref=f1e138]: "0"
              - generic [ref=f1e139]:
                - generic [ref=f1e140]: "0"
                - text: currently executing
            - generic [ref=f1e141]:
              - heading "Tasks Completed" [level=3] [ref=f1e143]
              - generic [ref=f1e148]: "2"
              - generic [ref=f1e149]:
                - generic [ref=f1e150]: 100%
                - text: success rate
            - generic [ref=f1e154]:
              - heading "Failed Tasks" [level=3] [ref=f1e156]
              - generic [ref=f1e160]: "0"
              - generic [ref=f1e161]: Require attention
          - generic [ref=f1e162]:
            - generic [ref=f1e163]:
              - generic [ref=f1e164]:
                - heading "Project Health" [level=2] [ref=f1e165]
                - link "View All" [ref=f1e171] [cursor=pointer]:
                  - /url: /dashboard/projects
              - table [ref=f1e173]:
                - rowgroup [ref=f1e174]:
                  - row [ref=f1e175]:
                    - columnheader "Project" [ref=f1e176]
                    - columnheader "Score" [ref=f1e177]
                    - columnheader "Trend" [ref=f1e178]
                    - columnheader "Quality Bar" [ref=f1e179]
                - rowgroup [ref=f1e180]:
                  - row [ref=f1e181]:
                    - cell "Smoke Project" [ref=f1e182]
                    - cell "92 / 100" [ref=f1e183]:
                      - text: "92"
                      - generic [ref=f1e184]: / 100
                    - cell "→ stable" [ref=f1e185]
                    - cell [ref=f1e187]
            - generic [ref=f1e190]:
              - generic [ref=f1e191]:
                - heading "Event Stream" [level=2] [ref=f1e192]
                - link "View All" [ref=f1e196] [cursor=pointer]:
                  - /url: /dashboard/events
              - generic [ref=f1e205]:
                - generic [ref=f1e206]: Dashboard API fixture ready
                - generic [ref=f1e207]: 12:00:00 AM
  - region "Notifications (F8)":
    - list
```

# Test source

```ts
  931  | 
  932  | type OriginDiagnostic = {
  933  |   origin: string;
  934  |   phase: "GET" | "preflight" | "mutation" | "rejection";
  935  |   status?: number;
  936  |   headers?: Record<string, string>;
  937  |   error?: string;
  938  | };
  939  | const recordedOriginDiagnostics: OriginDiagnostic[] = [];
  940  | 
  941  | function originDiagnosticPath(): string | undefined {
  942  |   return process.env.DASHBOARD_E2E_ORIGIN_DIAGNOSTICS_PATH;
  943  | }
  944  | 
  945  | function relevantOriginHeaders(
  946  |   headers: Record<string, string>,
  947  | ): Record<string, string> {
  948  |   return Object.fromEntries(
  949  |     ORIGIN_DIAGNOSTIC_HEADERS.flatMap((name) =>
  950  |       headers[name] ? [[name, headers[name]]] : [],
  951  |     ),
  952  |   );
  953  | }
  954  | 
  955  | async function writeOriginDiagnostics() {
  956  |   const outputPath = originDiagnosticPath();
  957  |   if (!outputPath) return;
  958  |   await mkdir(dirname(outputPath), { recursive: true });
  959  |   await writeFile(
  960  |     outputPath,
  961  |     `${JSON.stringify({ diagnostics: recordedOriginDiagnostics }, null, 2)}\n`,
  962  |     "utf8",
  963  |   );
  964  | }
  965  | 
  966  | async function expectOriginCanUseApi(page: Page, origin: string) {
  967  |   const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  968  |   if (!apiBaseUrl) {
  969  |     throw new Error(
  970  |       "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
  971  |     );
  972  |   }
  973  |   const healthUrl = new URL("/api/healthz", apiBaseUrl).toString();
  974  |   const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  975  |   const commonHeaders = { Origin: origin };
  976  | 
  977  |   const diagnostics: OriginDiagnostic[] = [];
  978  |   const check = async (
  979  |     phase: OriginDiagnostic["phase"],
  980  |     request: () => Promise<import("@playwright/test").APIResponse>,
  981  |     assertion: (response: import("@playwright/test").APIResponse) => Promise<void>,
  982  |   ) => {
  983  |     try {
  984  |       const response = await request();
  985  |       diagnostics.push({
  986  |         origin,
  987  |         phase,
  988  |         status: response.status(),
  989  |         headers: relevantOriginHeaders(response.headers()),
  990  |       });
  991  |       recordedOriginDiagnostics.push(diagnostics.at(-1)!);
  992  |       await assertion(response);
  993  |     } catch (error) {
  994  |       const current = diagnostics.at(-1);
  995  |       if (current?.phase !== phase) {
  996  |         diagnostics.push({ origin, phase });
  997  |       }
  998  |       diagnostics.at(-1)!.error = "origin check failed";
  999  |       await writeOriginDiagnostics();
  1000 |       throw error;
  1001 |     }
  1002 |   };
  1003 | 
  1004 |   await check(
  1005 |     "GET",
  1006 |     () => page.request.get(healthUrl, { headers: commonHeaders }),
  1007 |     async (response) => {
  1008 |       expect(response.status(), `${origin} credentialed GET status`).toBe(200);
  1009 |       expect(response.headers()["access-control-allow-origin"]).toBe(origin);
  1010 |       expect(response.headers()["access-control-allow-credentials"]).toBe(
  1011 |         "true",
  1012 |       );
  1013 |     },
  1014 |   );
  1015 |   await check(
  1016 |     "preflight",
  1017 |     () =>
  1018 |       page.request.fetch(mutationUrl, {
  1019 |         method: "OPTIONS",
  1020 |         headers: {
  1021 |           ...commonHeaders,
  1022 |           "Access-Control-Request-Method": "POST",
  1023 |           "Access-Control-Request-Headers": "content-type",
  1024 |         },
  1025 |       }),
  1026 |     async (response) => {
  1027 |       expect(
  1028 |         response.status(),
  1029 |         `${origin} mutation preflight status`,
  1030 |       ).toBe(204);
> 1031 |       expect(response.headers()["access-control-allow-origin"]).toBe(origin);
       |                                                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  1032 |     },
  1033 |   );
  1034 |   await check(
  1035 |     "mutation",
  1036 |     () =>
  1037 |       page.request.post(mutationUrl, {
  1038 |         headers: { ...commonHeaders, "Content-Type": "application/json" },
  1039 |         data: { message: "origin contract" },
  1040 |       }),
  1041 |     async (response) => {
  1042 |       expect(
  1043 |         response.status(),
  1044 |         `${origin} state-changing request must pass origin protection`,
  1045 |       ).not.toBe(403);
  1046 |       expect(response.headers()["access-control-allow-origin"]).toBe(origin);
  1047 |       expect(response.headers()["access-control-allow-credentials"]).toBe(
  1048 |         "true",
  1049 |       );
  1050 |     },
  1051 |   );
  1052 |   await writeOriginDiagnostics();
  1053 | }
  1054 | 
  1055 | async function expectHostileOriginRejected(page: Page) {
  1056 |   const apiBaseUrl = process.env.DASHBOARD_E2E_API_BASE_URL;
  1057 |   if (!apiBaseUrl)
  1058 |     throw new Error(
  1059 |       "DASHBOARD_E2E_API_BASE_URL is required for origin checks.",
  1060 |     );
  1061 |   const mutationUrl = new URL("/api/ai/chat", apiBaseUrl).toString();
  1062 |   const diagnostic: OriginDiagnostic = {
  1063 |     origin: HOSTILE_ORIGIN,
  1064 |     phase: "rejection",
  1065 |   };
  1066 |   recordedOriginDiagnostics.push(diagnostic);
  1067 |   try {
  1068 |     const response = await page.request.post(mutationUrl, {
  1069 |       headers: {
  1070 |         Origin: HOSTILE_ORIGIN,
  1071 |         "Content-Type": "application/json",
  1072 |       },
  1073 |       data: { message: "hostile origin contract" },
  1074 |     });
  1075 |     diagnostic.status = response.status();
  1076 |     diagnostic.headers = relevantOriginHeaders(response.headers());
  1077 |     expect(response.status()).toBe(403);
  1078 |     expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  1079 |     expect(
  1080 |       response.headers()["access-control-allow-credentials"],
  1081 |     ).toBeUndefined();
  1082 |   } catch (error) {
  1083 |     diagnostic.error = "origin rejection check failed";
  1084 |     await writeOriginDiagnostics();
  1085 |     throw error;
  1086 |   }
  1087 |   await writeOriginDiagnostics();
  1088 | }
  1089 | 
  1090 | function parseSse(body: string): Array<Record<string, unknown>> {
  1091 |   return body.split(/\n\n+/).flatMap((chunk) => {
  1092 |     const data = chunk
  1093 |       .split("\n")
  1094 |       .find((line) => line.startsWith("data: "))
  1095 |       ?.slice("data: ".length);
  1096 |     if (!data) return [];
  1097 |     try {
  1098 |       const value = JSON.parse(data) as unknown;
  1099 |       return value && typeof value === "object"
  1100 |         ? [value as Record<string, unknown>]
  1101 |         : [];
  1102 |     } catch {
  1103 |       return [];
  1104 |     }
  1105 |   });
  1106 | }
  1107 | 
  1108 | async function liveJson(
  1109 |   page: Page,
  1110 |   path: string,
  1111 | ): Promise<Record<string, any>> {
  1112 |   const response = await liveRequest(page, path);
  1113 |   if (response.status < 200 || response.status >= 300) {
  1114 |     throw new Error(
  1115 |       `Live correlation request failed: ${path} (${response.status})`,
  1116 |     );
  1117 |   }
  1118 |   return JSON.parse(response.body) as Record<string, any>;
  1119 | }
  1120 | 
  1121 | async function liveArray(
  1122 |   page: Page,
  1123 |   path: string,
  1124 | ): Promise<Array<Record<string, any>>> {
  1125 |   const response = await liveRequest(page, path);
  1126 |   if (response.status === 404) return [];
  1127 |   if (response.status < 200 || response.status >= 300) {
  1128 |     throw new Error(
  1129 |       `Live correlation request failed: ${path} (${response.status})`,
  1130 |     );
  1131 |   }
```