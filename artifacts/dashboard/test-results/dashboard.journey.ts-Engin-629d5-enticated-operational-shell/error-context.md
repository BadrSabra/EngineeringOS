# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.journey.ts >> EngineeringOS dashboard browser journey >> signs in and traverses the authenticated operational shell
- Location: e2e/dashboard.journey.ts:1371:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Showing 1–1 of 1', { exact: true })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('Showing 1–1 of 1', { exact: true })

```

```yaml
- text: EngineeringOS Core Ops
- link "Dashboard":
  - /url: /dashboard/
- link "Projects":
  - /url: /dashboard/projects
- link "Tasks":
  - /url: /dashboard/tasks
- link "Rules Engine":
  - /url: /dashboard/rules
- link "Workflows":
  - /url: /dashboard/workflows
- link "Event Stream":
  - /url: /dashboard/events
- link "Metrics":
  - /url: /dashboard/metrics
- link "Knowledge Graph":
  - /url: /dashboard/graph
- link "AI Assistant":
  - /url: /dashboard/ai
- link "Flight Deck":
  - /url: /dashboard/flight-deck
- link "Mission Control":
  - /url: /dashboard/mission-control
- text: ED EngineeringOS Dashboard Smoke Connected
- button "Sign out"
- banner:
  - textbox "Search projects, tasks, rules... (Press '/')"
  - text: v1.0.4-stable
  - button
- main:
  - heading "System Overview" [level=1]
  - paragraph: Real-time status of all autonomous engineering operations.
  - text: Updated 7:21:52 PM
  - button "Refresh status"
  - text: SYSTEM ONLINE
  - region "AI diagnostics retention health":
    - heading "AI diagnostics retention" [level=2]
    - text: Healthy
    - paragraph: Last completed 8/23/2026, 7:21:30 PM
    - text: Chat rows 0 scanned / 0 pruned Execution rows 0 scanned / 0 pruned
  - heading "Active Projects" [level=3]
  - text: 1 0 tasks pending
  - heading "Active Tasks" [level=3]
  - text: 0 0 currently executing
  - heading "Tasks Completed" [level=3]
  - text: 2 100% success rate
  - heading "Failed Tasks" [level=3]
  - text: 0 Require attention
  - heading "Project Health" [level=2]
  - link "View All":
    - /url: /dashboard/projects
  - table:
    - rowgroup:
      - row "Project Score Trend Quality Bar":
        - columnheader "Project"
        - columnheader "Score"
        - columnheader "Trend"
        - columnheader "Quality Bar"
    - rowgroup:
      - row "Smoke Project 92 / 100 → stable":
        - cell "Smoke Project"
        - cell "92 / 100"
        - cell "→ stable"
        - cell
  - heading "Event Stream" [level=2]
  - link "View All":
    - /url: /dashboard/events
  - text: Dashboard API fixture ready 12:00:00 AM
- region "Notifications (F8)":
  - list
```

# Test source

```ts
  1293 |         sessionId: execution.sessionId,
  1294 |         operationId: execution.operationId,
  1295 |         status: execution.status,
  1296 |         flightState: execution.flightState,
  1297 |       },
  1298 |       messages: messages.map(
  1299 |         ({
  1300 |           id,
  1301 |           sessionId: messageSession,
  1302 |           role,
  1303 |           executionId: messageExecution,
  1304 |           outcome,
  1305 |         }) => ({
  1306 |           id,
  1307 |           sessionId: messageSession,
  1308 |           role,
  1309 |           executionId: messageExecution,
  1310 |           outcome,
  1311 |         }),
  1312 |       ),
  1313 |       sseEvents: sseEvents.map(
  1314 |         ({
  1315 |           type,
  1316 |           executionId: eventExecution,
  1317 |           sessionId: eventSession,
  1318 |           outcome,
  1319 |           code,
  1320 |         }) => ({
  1321 |           type,
  1322 |           executionId: eventExecution,
  1323 |           sessionId: eventSession,
  1324 |           outcome,
  1325 |           code,
  1326 |         }),
  1327 |       ),
  1328 |       checkpoints: [
  1329 |         {
  1330 |           sequence: checkpoint.sequence,
  1331 |           stage: checkpoint.stage,
  1332 |           updatedAt: checkpoint.updatedAt,
  1333 |         },
  1334 |       ],
  1335 |       evidenceCount,
  1336 |       proposals: proposal
  1337 |         ? [
  1338 |             {
  1339 |               id: proposal.id,
  1340 |               revision: proposal.revision,
  1341 |               status: proposal.status,
  1342 |             },
  1343 |           ]
  1344 |         : [],
  1345 |       validation: validation.map((step) => ({
  1346 |         status: step.validation?.status ?? step.status,
  1347 |         profile: step.validation?.profile ?? step.validationProfile,
  1348 |       })),
  1349 |       events: events.map(({ type, severity, correlationId }) => ({
  1350 |         type,
  1351 |         severity,
  1352 |         correlationId,
  1353 |       })),
  1354 |       dashboard: missionControl,
  1355 |       dashboardState: {
  1356 |         projectCount: dashboardState.projectCount,
  1357 |         activeTaskCount: dashboardState.activeTaskCount,
  1358 |       },
  1359 |     };
  1360 |     const outputPath =
  1361 |       process.env.DASHBOARD_E2E_LIVE_REPORT_PATH ??
  1362 |       "test-results/dashboard-journey/live-mission-correlation.json";
  1363 |     await mkdir(dirname(outputPath), { recursive: true });
  1364 |     await writeFile(
  1365 |       outputPath,
  1366 |       `${JSON.stringify(capture, null, 2)}\n`,
  1367 |       "utf8",
  1368 |     );
  1369 |   });
  1370 | 
  1371 |   test("signs in and traverses the authenticated operational shell", async ({
  1372 |     page,
  1373 |   }) => {
  1374 |     await installApiFixtures(page);
  1375 |     await programmaticSignIn(page);
  1376 |     for (const origin of approvedDashboardOrigins()) {
  1377 |       await expectOriginCanUseApi(page, origin);
  1378 |     }
  1379 |     await expectHostileOriginRejected(page);
  1380 | 
  1381 |     await expect(
  1382 |       page.getByRole("heading", { name: "System Overview" }),
  1383 |     ).toBeVisible();
  1384 |     await expect(
  1385 |       page.getByText("SYSTEM ONLINE", { exact: true }),
  1386 |     ).toBeVisible();
  1387 |     await expect(
  1388 |       page.getByText("Smoke Project", { exact: true }).first(),
  1389 |     ).toBeVisible();
  1390 |     await expect(
  1391 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1392 |     ).toBeVisible();
> 1393 |     await expect(page.getByText("Showing 1–1 of 1", { exact: true })).toBeVisible();
       |                                                                       ^ Error: expect(locator).toBeVisible() failed
  1394 |     await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();
  1395 | 
  1396 |     await openNavigation(page, "Projects", `${DASHBOARD_PATH}projects`);
  1397 |     await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  1398 |     await expect(
  1399 |       page.getByText("Smoke Project", { exact: true }),
  1400 |     ).toBeVisible();
  1401 | 
  1402 |     await openNavigation(page, "Event Stream", `${DASHBOARD_PATH}events`);
  1403 |     await expect(
  1404 |       page.getByRole("heading", { name: "Event Stream" }),
  1405 |     ).toBeVisible();
  1406 |     await expect(
  1407 |       page.getByText("Dashboard API fixture ready", { exact: true }),
  1408 |     ).toBeVisible();
  1409 | 
  1410 |     await openNavigation(page, "AI Assistant", `${DASHBOARD_PATH}ai`);
  1411 |     await expect(page).not.toHaveURL(/sign-in/);
  1412 |     await expect(
  1413 |       page
  1414 |         .getByText(
  1415 |           /AI provider not configured|No AI key configured|AI Assistant/i,
  1416 |         )
  1417 |         .first(),
  1418 |     ).toBeVisible();
  1419 | 
  1420 |     await openNavigation(
  1421 |       page,
  1422 |       "Mission Control",
  1423 |       `${DASHBOARD_PATH}mission-control`,
  1424 |     );
  1425 |     await expect(
  1426 |       page.getByRole("heading", { name: "No durable runs in the ledger" }),
  1427 |     ).toBeVisible();
  1428 | 
  1429 |     await page.goto(`${DASHBOARD_PATH}flight-deck?executionId=${EXECUTION_ID}`);
  1430 |     await expect(page).toHaveURL(
  1431 |       new RegExp(
  1432 |         `${DASHBOARD_PATH.replaceAll("/", "\\/")}flight-deck\\?executionId=`,
  1433 |       ),
  1434 |     );
  1435 |     await expect(
  1436 |       page.getByRole("heading", { name: "Audit / Chat run" }),
  1437 |     ).toBeVisible();
  1438 |     await expect(
  1439 |       page.getByText("Controlled browser fixture completed.", { exact: true }),
  1440 |     ).toBeVisible();
  1441 |     await expect(
  1442 |       page.getByText("PROVEN", { exact: true }).first(),
  1443 |     ).toBeVisible();
  1444 |   });
  1445 | 
  1446 |   test("pages and reloads the filtered event stream without losing its window", async ({
  1447 |     page,
  1448 |   }) => {
  1449 |     const events = Array.from({ length: 51 }, (_, index) => ({
  1450 |       id: `e2e-event-${index}`,
  1451 |       projectId: "e2e-project",
  1452 |       type: "AuditEvent",
  1453 |       severity: index < 2 ? "success" : "info",
  1454 |       correlationId: index < 2 ? "release-42" : null,
  1455 |       message:
  1456 |         index < 2 ? `Filtered release event ${index}` : `Older event ${index}`,
  1457 |       timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 51 - index)).toISOString(),
  1458 |     }));
  1459 |     const eventRequests: string[] = [];
  1460 |     page.on("request", (request) => {
  1461 |       if (new URL(request.url()).pathname.endsWith("/api/events"))
  1462 |         eventRequests.push(request.url());
  1463 |     });
  1464 |     await installApiFixtures(page, {
  1465 |       events,
  1466 |       projects: [
  1467 |         {
  1468 |           id: "e2e-project",
  1469 |           name: "Smoke Project",
  1470 |           language: "TypeScript",
  1471 |           framework: "React",
  1472 |           status: "active",
  1473 |           rootPath: "/controlled/smoke",
  1474 |           qualityScore: 92,
  1475 |         },
  1476 |       ],
  1477 |     });
  1478 |     await programmaticSignIn(page);
  1479 |     await page.goto(`${DASHBOARD_PATH}events`);
  1480 | 
  1481 |     await expect(page.getByText("Older event 49", { exact: true })).toBeVisible();
  1482 |     await expect(page.getByText("Older event 50", { exact: true })).not.toBeVisible();
  1483 |     const firstRequest = new URL(eventRequests.at(-1)!);
  1484 |     expect(firstRequest.searchParams.get("limit")).toBe("50");
  1485 |     expect(firstRequest.searchParams.get("page")).toBe("1");
  1486 | 
  1487 |     await Promise.all([
  1488 |       page.waitForRequest((request) => {
  1489 |         const url = new URL(request.url());
  1490 |         return (
  1491 |           url.pathname.endsWith("/api/events") &&
  1492 |           url.searchParams.get("page") === "2"
  1493 |         );
```